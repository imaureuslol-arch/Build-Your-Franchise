-- Seasonal hard-cap enforcement and commissioner waivers. All times are Athens.
create or replace function byf_cap_clock() returns timestamptz language sql volatile as $$
  select clock_timestamp()
$$;
-- statement
create or replace function byf_cap_in_season(at_time timestamptz) returns boolean language sql immutable as $$
  select to_char(at_time at time zone 'Europe/Athens', 'MMDD') >= '1015'
      or to_char(at_time at time zone 'Europe/Athens', 'MMDD') <= '0330'
$$;
-- statement
create or replace function byf_cap_season(at_time timestamptz) returns int language sql immutable as $$
  select extract(year from at_time at time zone 'Europe/Athens')::int
    + case when extract(month from at_time at time zone 'Europe/Athens') >= 4 then 1 else 0 end
$$;
-- statement
create table if not exists team_cap_status (
  team_id int primary key references teams(id) on delete cascade,
  season int not null,
  payroll bigint not null,
  checked_at timestamptz not null,
  over_since timestamptz,
  deadline timestamptz,
  check ((over_since is null) = (deadline is null))
);
-- statement
create table if not exists player_waivers (
  id bigserial primary key,
  player_id int not null references players(id),
  from_team int not null references teams(id),
  contract_version int not null,
  season int not null,
  salary bigint not null,
  dead_cap bigint not null,
  reason text not null check (reason in ('commissioner', 'hard_cap', 'sleeper')),
  sleeper_pending boolean not null default true,
  created_at timestamptz not null
);
-- statement
create index if not exists player_waivers_player_idx on player_waivers(player_id);
-- statement
create or replace function byf_team_payroll(team int, salary_season int) returns bigint language sql stable as $$
  select (coalesce((select sum(c.amount) from contracts c join players p on p.id=c.player_id
    where p.team_id=team and c.season=salary_season),0)
    + coalesce((select sum(d.amount) from dead_cap d where d.team_id=team and d.season=salary_season),0))::bigint
$$;
-- statement
create or replace function byf_refresh_cap_status() returns void language plpgsql set search_path from current as $$
declare
  stamp timestamptz := byf_cap_clock();
  salary_season int := byf_cap_season(stamp);
  hard bigint := round(240000000+greatest(0,salary_season-2027)*(25000000::numeric/3));
  season_start timestamptz := make_timestamptz(salary_season-1,10,15,0,0,0,'Europe/Athens');
  active boolean := byf_cap_in_season(stamp);
  t record; prior team_cap_status%rowtype; total bigint; started timestamptz;
begin
  perform pg_advisory_xact_lock(733016);
  for t in select id from teams order by id loop
    total := byf_team_payroll(t.id,salary_season);
    select * into prior from team_cap_status where team_id=t.id;
    started := null;
    if active and total>hard then
      if prior.season=salary_season and prior.over_since is not null then
        started := prior.over_since;
      elsif prior.season=salary_season and prior.checked_at<season_start and prior.payroll>hard then
        -- Already red in the offseason: the ten days begin on October 15.
        started := season_start;
      else
        started := stamp;
      end if;
    end if;
    insert into team_cap_status(team_id,season,payroll,checked_at,over_since,deadline)
      values(t.id,salary_season,total,stamp,started,started+interval '240 hours')
      on conflict(team_id) do update set season=excluded.season,payroll=excluded.payroll,
        checked_at=excluded.checked_at,over_since=excluded.over_since,deadline=excluded.deadline
      where (team_cap_status.season,team_cap_status.payroll,team_cap_status.over_since)
        is distinct from (excluded.season,excluded.payroll,excluded.over_since);
  end loop;
end $$;
-- statement
create or replace function byf_waive_player(body jsonb, actor uuid, actor_team int, why text default 'commissioner')
returns jsonb language plpgsql set search_path from current as $$
declare
  stamp timestamptz := byf_cap_clock();
  salary_season int := byf_cap_season(stamp);
  p players%rowtype; before_state jsonb; salary bigint; penalty bigint; waiver_id bigint; result jsonb;
  current_round int; fa_before jsonb;
begin
  perform pg_advisory_xact_lock(733016);
  if why not in ('commissioner','hard_cap','sleeper') then raise exception 'Invalid waiver reason'; end if;
  select * into p from players where id=(body->>'playerId')::int for update;
  if not found or p.team_id is null then raise exception 'This player is no longer on a team. Reload.'; end if;
  select jsonb_build_object('teamId',p.team_id,'contractVersion',p.contract_version,'contracts',coalesce(jsonb_object_agg(season::text,amount),'{}'))
    into before_state from contracts where player_id=p.id and season>=salary_season;
  if before_state is distinct from body->'expected' then raise exception 'This contract changed. Reload before waiving.'; end if;
  salary := coalesce((before_state->'contracts'->>salary_season::text)::bigint,0);
  penalty := case when why<>'hard_cap' and byf_cap_in_season(stamp) then round(salary::numeric/2)::bigint else 0 end;
  if why='commissioner' and ((body->>'expectedSeason')::int is distinct from salary_season
    or (body->>'expectedDeadCap')::bigint is distinct from penalty) then
    raise exception 'The waiver charge changed. Reload before confirming.';
  end if;
  insert into player_waivers(player_id,from_team,contract_version,season,salary,dead_cap,reason,created_at)
    values(p.id,p.team_id,p.contract_version,salary_season,salary,penalty,why,stamp) returning id into waiver_id;
  if penalty>0 then
    insert into dead_cap(team_id,label,season,amount)
      values(p.team_id,'Waived: '||p.name,salary_season,penalty);
  end if;
  delete from contracts where player_id=p.id and season>=salary_season;
  delete from restricted_free_agents where player_id=p.id;
  delete from extension_negotiations where player_id=p.id;
  -- Reopen this player's auction even if they signed earlier in the same
  -- round. Preserve the completed auction in the waiver audit trail.
  select max(id) into current_round from fa_rounds;
  select jsonb_build_object(
    'roundId',current_round,
    'award',(select to_jsonb(a) from fa_awards a where a.round_id=current_round and a.player_id=p.id),
    'auction',(select to_jsonb(a) from fa_player_auctions a where a.round_id=current_round and a.player_id=p.id),
    'offers',coalesce((select jsonb_agg(o) from free_agent_offers o where o.round_id=current_round and o.player_id=p.id),'[]'))
    into fa_before;
  delete from fa_awards where round_id=current_round and player_id=p.id;
  delete from fa_player_auctions where round_id=current_round and player_id=p.id;
  delete from free_agent_offers where round_id=current_round and player_id=p.id;
  update players set team_id=null where id=p.id;
  -- An offer containing this player can no longer be accepted as written.
  with cancelled as (
    update trades tr set status='cancelled',decided_at=stamp
    where tr.status in ('proposed','accepted') and exists(
      select 1 from trade_items i where i.trade_id=tr.id and i.player_id=p.id)
    returning tr.id
  ) insert into audit_log(session_id,team_id,action,detail)
    select actor,actor_team,'trade_cancelled_by_waiver',jsonb_build_object('tradeId',id,'playerId',p.id) from cancelled;
  result := jsonb_build_object('ok',true,'waiverId',waiver_id,'playerId',p.id,'player',p.name,
    'fromTeam',p.team_id,'season',salary_season,'deadCap',penalty,'reason',why,
    'payroll',byf_team_payroll(p.team_id,salary_season),'sleeperPending',true);
  insert into audit_log(session_id,team_id,action,detail)
    values(actor,actor_team,'player_waived',jsonb_build_object('before',before_state,'after',result,'freeAgencyBefore',fa_before));
  return result;
end $$;
-- statement
create or replace function byf_enforce_hard_cap() returns jsonb language plpgsql set search_path from current as $$
declare
  stamp timestamptz := byf_cap_clock();
  salary_season int := byf_cap_season(stamp);
  hard bigint := round(240000000+greatest(0,salary_season-2027)*(25000000::numeric/3));
  t record; p record; expected jsonb; result jsonb; waived jsonb := '[]'; unresolved jsonb := '[]';
begin
  perform pg_advisory_xact_lock(733016);
  perform byf_refresh_cap_status();
  if not byf_cap_in_season(stamp) then return jsonb_build_object('waived',waived,'unresolved',unresolved); end if;
  for t in select * from team_cap_status where deadline<=stamp order by team_id loop
    while byf_team_payroll(t.team_id,salary_season)>hard loop
      -- The site's displayed fair value, not salary or hidden extension demand.
      select id,team_id,contract_version into p from players where team_id=t.team_id
        order by coalesce(fair_value,0),id limit 1 for update;
      if not found then
        unresolved := unresolved||jsonb_build_array(jsonb_build_object('teamId',t.team_id,
          'payroll',byf_team_payroll(t.team_id,salary_season),'reason','Remaining dead cap exceeds the hard cap'));
        exit;
      end if;
      select jsonb_build_object('teamId',p.team_id,'contractVersion',p.contract_version,'contracts',coalesce(jsonb_object_agg(season::text,amount),'{}'))
        into expected from contracts where player_id=p.id and season>=salary_season;
      result := byf_waive_player(jsonb_build_object('playerId',p.id,'expected',expected),null,null,'hard_cap');
      waived := waived||jsonb_build_array(result);
    end loop;
  end loop;
  perform byf_refresh_cap_status();
  return jsonb_build_object('waived',waived,'unresolved',unresolved);
end $$;
-- statement
-- Track the final transaction state, so temporarily moving salary while
-- executing a trade does not falsely reset a deadline.
create or replace function byf_cap_changed() returns trigger language plpgsql set search_path from current as $$
begin
  if tg_table_name='players' then
    if tg_op='UPDATE' then
      if new.team_id is not distinct from old.team_id then return null; end if;
    end if;
  end if;
  perform byf_refresh_cap_status();
  return null;
end $$;
-- statement
drop trigger if exists byf_players_cap_changed on players;
-- statement
create constraint trigger byf_players_cap_changed after insert or update or delete on players
  deferrable initially deferred for each row execute function byf_cap_changed();
-- statement
drop trigger if exists byf_contracts_cap_changed on contracts;
-- statement
create constraint trigger byf_contracts_cap_changed after insert or update or delete on contracts
  deferrable initially deferred for each row execute function byf_cap_changed();
-- statement
drop trigger if exists byf_dead_cap_changed on dead_cap;
-- statement
create constraint trigger byf_dead_cap_changed after insert or update or delete on dead_cap
  deferrable initially deferred for each row execute function byf_cap_changed();
-- statement
select byf_refresh_cap_status();
-- statement
create or replace function byf_cap_release_preview(team int, salary_season int) returns jsonb language plpgsql stable set search_path from current as $$
declare
  total bigint := byf_team_payroll(team,salary_season);
  hard bigint := round(240000000+greatest(0,salary_season-2027)*(25000000::numeric/3));
  p record; result jsonb := '[]';
begin
  for p in select player.id,player.name,coalesce(player.fair_value,0) as value,
      coalesce(c.amount,0) as salary from players player
    left join contracts c on c.player_id=player.id and c.season=salary_season
    where player.team_id=team order by coalesce(player.fair_value,0),player.id loop
    exit when total<=hard;
    result := result||jsonb_build_array(jsonb_build_object('id',p.id,'name',p.name,'salary',p.salary,'fairValue',p.value));
    total := total-p.salary;
  end loop;
  return result;
end $$;
-- statement
create table if not exists cap_notifications (
  id uuid primary key default gen_random_uuid(),
  team_id int not null references teams(id) on delete cascade,
  deadline timestamptz not null,
  days_left int not null check (days_left in (8,3,1)),
  status text not null default 'attempted' check (status in ('attempted','sent','unconfirmed')),
  attempted_at timestamptz not null,
  sent_at timestamptz,
  unique(team_id,deadline,days_left)
);
-- statement
create or replace function byf_claim_cap_notifications() returns jsonb language plpgsql set search_path from current as $$
declare
  stamp timestamptz := byf_cap_clock();
  t record; reminder int; notification uuid; result jsonb := '[]';
begin
  perform pg_advisory_xact_lock(733016);
  if not byf_cap_in_season(stamp) then return result; end if;
  for t in select c.*,team.name,team.sleeper_user_id from team_cap_status c join teams team on team.id=c.team_id
    where c.deadline>stamp and c.deadline<=stamp+interval '192 hours' and team.sleeper_user_id ~ '^[0-9]+$'
      and c.payroll>round(240000000+greatest(0,c.season-2027)*(25000000::numeric/3))
    order by c.deadline,c.team_id loop
    -- If a run was missed, send the current warning, not a burst of old ones.
    reminder := case when t.deadline<=stamp+interval '24 hours' then 1
      when t.deadline<=stamp+interval '72 hours' then 3 else 8 end;
    notification := null;
    insert into cap_notifications(team_id,deadline,days_left,attempted_at)
      values(t.team_id,t.deadline,reminder,stamp) on conflict do nothing returning id into notification;
    if notification is not null then
      result := result||jsonb_build_array(jsonb_build_object('id',notification,'teamId',t.team_id,'team',t.name,
        'recipient',t.sleeper_user_id,'deadline',t.deadline,'daysLeft',reminder,'season',t.season,
        'players',byf_cap_release_preview(t.team_id,t.season)));
      return result;
    end if;
  end loop;
  return result;
end $$;

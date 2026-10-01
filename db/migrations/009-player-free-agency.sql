-- Player-specific auctions. The first offer sets the deadline; every later
-- offer adds twelve hours to that same deadline. Awards remain manual.
create table if not exists restricted_free_agents (
  player_id int primary key references players(id) on delete cascade,
  owner_key text not null,
  team_id int not null references teams(id),
  expires_season int not null
);
-- statement
create table if not exists fa_player_auctions (
  round_id int not null references fa_rounds(id),
  player_id int not null references players(id) on delete cascade,
  first_bid_at timestamptz not null,
  accepts_at timestamptz not null,
  fair_value bigint not null,
  rfa_owner_key text,
  matched_offer_id uuid references free_agent_offers(id),
  matched_team_id int references teams(id),
  matched_at timestamptz,
  primary key(round_id,player_id)
);
-- statement
create or replace function byf_fa_days(weighted numeric, fair numeric)
returns numeric language sql immutable as $$
  select case when fair <= 0 then 3
    when weighted >= greatest(2 * fair, fair + 10000000) then 3
    when weighted <= 0.5 * fair then 30
    when weighted < 0.8 * fair then 30 - 16 * (weighted / fair - 0.5) / 0.3
    else 14 - 11 * (weighted - 0.8 * fair) / (greatest(2 * fair, fair + 10000000) - 0.8 * fair) end
$$;
-- statement
-- Existing bids keep their already advertised cutoff; no active auction is
-- silently restarted when this migration is deployed.
insert into fa_player_auctions(round_id,player_id,first_bid_at,accepts_at,fair_value)
  select o.round_id,o.player_id,min(o.created_at),
    coalesce(r.closes_at,min(o.created_at)+byf_fa_days(max(byf_bid_value(o.years,o.amounts)),(coalesce(p.fair_value,0)*1000000)::numeric)::double precision*interval '1 day'),
    round(coalesce(p.fair_value,0)*1000000)::bigint
  from free_agent_offers o join fa_rounds r on r.id=o.round_id join players p on p.id=o.player_id
  group by o.round_id,o.player_id,r.closes_at,p.fair_value on conflict do nothing;
-- statement
create or replace function byf_refresh_rfas(current_season int)
returns void language plpgsql set search_path from current as $$
declare p record;
begin
  perform pg_advisory_xact_lock(733016);
  for p in select player.id,player.team_id,coalesce('sleeper:' || t.sleeper_user_id,'team:' || t.id) as owner_key,(select max(y) from unnest(e.years) y) as expires_season
    from players player join teams t on t.id=player.team_id
    join lateral (select ext.* from extensions ext where ext.player_id=player.id and ext.accepted
      and ext.contract_version=player.contract_version
      order by ext.created_at desc limit 1) e on true
    where (select max(y) from unnest(e.years) y)<current_season
      and not exists(select 1 from contracts c where c.player_id=player.id and c.season>=current_season)
    for update of player loop
    insert into restricted_free_agents(player_id,owner_key,team_id,expires_season)
      values(p.id,p.owner_key,p.team_id,p.expires_season)
      on conflict(player_id) do update set owner_key=excluded.owner_key,team_id=excluded.team_id,expires_season=excluded.expires_season;
    update players set team_id=null where id=p.id;
    insert into audit_log(action,detail) values('rfa_contract_expired',jsonb_build_object('playerId',p.id,'ownerKey',p.owner_key));
  end loop;
end $$;
-- statement
create or replace function byf_fa_action(body jsonb, actor uuid, actor_team int, current_season int)
returns jsonb language plpgsql set search_path from current as $$
declare
  r fa_rounds%rowtype;
  auction fa_player_auctions%rowtype;
  bid free_agent_offers%rowtype;
  p players%rowtype;
  chosen_years int[];
  chosen_amounts jsonb;
  year_index int;
  prev_amount bigint;
  amount bigint;
  cap numeric;
  hard_cap bigint := round(240000000 + greatest(0,current_season-2027)*(25000000::numeric/3));
  result jsonb;
  fair bigint;
  owner_key text;
  awarded_team int;
begin
  perform pg_advisory_xact_lock(733016);
  perform byf_refresh_rfas(current_season);
  select * into r from fa_rounds order by id desc limit 1 for update;
  if (body->>'roundId')::int is distinct from r.id then raise exception 'The free-agency round changed. Refresh the page.'; end if;
  if body->>'action'='new_round' then
    if exists(select 1 from free_agent_offers o where o.round_id=r.id
      and not exists(select 1 from fa_awards a where a.round_id=r.id and a.player_id=o.player_id)) then
      raise exception 'Award or dismiss every player with bids before starting another round';
    end if;
    insert into fa_rounds(closes_at) values(null) returning * into r;
    result:=jsonb_build_object('roundId',r.id);
  elsif body->>'action'='deadline' then
    raise exception 'Each player now has a separate deadline set by the first bid';
  else
    select * into p from players where id=(body->>'playerId')::int for update;
    if not found then raise exception 'Player not found'; end if;
    select * into auction from fa_player_auctions where round_id=r.id and player_id=p.id for update;
    if exists(select 1 from fa_awards where round_id=r.id and player_id=p.id) then
      if body->>'action' in ('award','dismiss') then return jsonb_build_object('ok',true,'alreadyProcessed',true); end if;
      raise exception 'This auction has already been processed';
    end if;
    if body->>'action' in ('bid','clear') then
      if auction.accepts_at <= clock_timestamp() then raise exception 'Bidding is closed for this player'; end if;
      if body->>'action'='clear' then
        delete from free_agent_offers where round_id=r.id and player_id=p.id;
        -- Deliberately preserve the deadline even if all bids are cleared.
        result:=jsonb_build_object('ok',true);
      else
        if actor_team is null then raise exception 'Log in with your team link to bid'; end if;
        if p.team_id is not null then raise exception 'That player is not a free agent'; end if;
        fair:=round(p.fair_value*1000000)::bigint;
        if fair is null or fair<=0 then raise exception 'This player needs a fair value before bidding. Contact the commissioner.'; end if;
        chosen_amounts:=body->'amounts';
        select array_agg(value::int order by value::int) into chosen_years from jsonb_array_elements_text(body->'years');
        if chosen_years is null or cardinality(chosen_years)>4 or chosen_years[1]<>current_season
          or chosen_years[cardinality(chosen_years)]>current_season+3 then
          raise exception 'Select consecutive seasons starting with the current season';
        end if;
        if jsonb_typeof(chosen_amounts) is distinct from 'object' then raise exception 'Invalid bid amounts'; end if;
        for year_index in 1..cardinality(chosen_years) loop
          if chosen_years[year_index]<>current_season+year_index-1 then raise exception 'Select consecutive seasons'; end if;
          if jsonb_typeof(chosen_amounts->chosen_years[year_index]::text) is distinct from 'number'
            or (chosen_amounts->>chosen_years[year_index]::text)::numeric<>trunc((chosen_amounts->>chosen_years[year_index]::text)::numeric) then
            raise exception 'Bid amounts must be whole dollars';
          end if;
          amount:=(chosen_amounts->>chosen_years[year_index]::text)::bigint;
          if amount<byf_vet_min(chosen_years[year_index]) or amount>1000000000000 then
            raise exception 'Each season must be at least the veteran minimum (%)',byf_vet_min(chosen_years[year_index]);
          end if;
          if prev_amount is not null and abs(amount-prev_amount)>prev_amount*0.10 then raise exception 'Each salary must be within 10%% of the previous season'; end if;
          prev_amount:=amount;
        end loop;
        select coalesce((select sum(c.amount) from contracts c join players roster_player on roster_player.id=c.player_id
          where roster_player.team_id=actor_team and c.season=current_season),0)
          +coalesce((select sum(d.amount) from dead_cap d where d.team_id=actor_team and d.season=current_season),0) into cap;
        if cap>hard_cap and exists(select 1 from unnest(chosen_years) y where (chosen_amounts->>y::text)::bigint<>byf_vet_min(y)) then
          raise exception 'Teams over the hard cap may only offer the veteran minimum each season';
        end if;
        select jsonb_object_agg(y::text,chosen_amounts->y::text) into chosen_amounts from unnest(chosen_years) y;
        insert into free_agent_offers(round_id,player_id,team_id,years,amounts,total_value)
          values(r.id,p.id,actor_team,chosen_years,chosen_amounts,(select sum(value::text::bigint) from jsonb_each(chosen_amounts))) returning * into bid;
        if auction.player_id is null then
          insert into fa_player_auctions(round_id,player_id,first_bid_at,accepts_at,fair_value,rfa_owner_key)
            values(r.id,p.id,clock_timestamp(),clock_timestamp()+byf_fa_days(byf_bid_value(bid.years,bid.amounts),fair)::double precision*interval '1 day',fair,
              (select rf.owner_key from restricted_free_agents rf where rf.player_id=p.id));
        else
          update fa_player_auctions set accepts_at=accepts_at+interval '12 hours' where round_id=r.id and player_id=p.id;
        end if;
        result:=jsonb_build_object('offer',to_jsonb(bid));
      end if;
    elsif body->>'action' in ('award','dismiss','match') then
      if auction.player_id is null or auction.accepts_at>clock_timestamp() then raise exception 'Wait until bidding closes for this player'; end if;
      if body->>'action'='dismiss' then
        if length(trim(body->>'note')) not between 1 and 500 then raise exception 'Enter a reason for dismissing these bids'; end if;
        if not exists(select 1 from free_agent_offers where round_id=r.id and player_id=p.id) then raise exception 'No bids for this player'; end if;
        insert into fa_awards(round_id,player_id,note) values(r.id,p.id,trim(body->>'note'));
      else
        select * into bid from free_agent_offers where id=(body->>'offerId')::uuid and round_id=r.id and player_id=p.id;
        if not found then raise exception 'Bid not found in this round'; end if;
        if byf_bid_value(bid.years,bid.amounts) is distinct from
          (select max(byf_bid_value(years,amounts)) from free_agent_offers where round_id=r.id and player_id=p.id) then
          raise exception 'Only a highest-ranked bid can be awarded or matched';
        end if;
        if p.team_id is not null then raise exception 'This player is already rostered. Correct the contract or dismiss these bids.'; end if;
        if exists(select 1 from contracts where player_id=p.id and season>=current_season) then raise exception 'This player already has a contract. Correct it before awarding.'; end if;
        if bid.years[1]<>current_season or bid.years[cardinality(bid.years)]>current_season+3 then raise exception 'This bid is for an outdated season. Dismiss it and open a new round.'; end if;
        awarded_team:=bid.team_id;
        if body->>'action'='match' then
          select coalesce('sleeper:' || t.sleeper_user_id,'team:' || t.id) into owner_key from teams t where t.id=actor_team;
          if auction.rfa_owner_key is null or auction.rfa_owner_key is distinct from owner_key then raise exception 'Only the previous owner can match this contract'; end if;
          if auction.accepts_at+interval '7 days'<=clock_timestamp() then raise exception 'The seven-day matching window has closed'; end if;
          if auction.matched_offer_id is not null then return jsonb_build_object('ok',true,'alreadyProcessed',true); end if;
          awarded_team:=actor_team;
        elsif auction.matched_offer_id is not null then
          if bid.id<>auction.matched_offer_id then raise exception 'Apply the bid that the previous owner matched'; end if;
          awarded_team:=auction.matched_team_id;
        elsif auction.rfa_owner_key is not null and auction.accepts_at+interval '7 days'>clock_timestamp()
          and not exists(select 1 from teams t where t.id=bid.team_id
            and coalesce('sleeper:' || t.sleeper_user_id,'team:' || t.id)=auction.rfa_owner_key) then
          raise exception 'Wait for the previous owner to match or for the seven-day window to close';
        end if;
        perform 1 from teams where id=awarded_team for update;
        select coalesce((select sum(c.amount) from contracts c join players roster_player on roster_player.id=c.player_id
          where roster_player.team_id=awarded_team and c.season=current_season),0)
          +coalesce((select sum(d.amount) from dead_cap d where d.team_id=awarded_team and d.season=current_season),0) into cap;
        if cap>hard_cap and exists(select 1 from unnest(bid.years) y where (bid.amounts->>y::text)::bigint<>byf_vet_min(y)) then
          raise exception 'This team is now over the hard cap. Resolve its cap or dismiss these bids.';
        end if;
        if body->>'action'='match' then
          update fa_player_auctions set matched_offer_id=bid.id,matched_team_id=actor_team,matched_at=clock_timestamp()
            where round_id=r.id and player_id=p.id;
        else
          update players set team_id=awarded_team,contract_version=contract_version+1 where id=p.id;
          insert into contracts(player_id,season,amount) select p.id,y,(bid.amounts->>y::text)::bigint from unnest(bid.years) y;
          insert into fa_awards(round_id,player_id,offer_id,team_id,years,amounts) values(r.id,p.id,bid.id,awarded_team,bid.years,bid.amounts);
          delete from restricted_free_agents where player_id=p.id;
        end if;
      end if;
      result:=jsonb_build_object('ok',true);
    else raise exception 'Unknown free-agency action';
    end if;
  end if;
  insert into audit_log(session_id,team_id,action,detail) values(actor,actor_team,'fa_'||(body->>'action'),body||result);
  return result;
end $$;

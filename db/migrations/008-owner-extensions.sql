alter table players add column if not exists nba_experience int check (nba_experience >= 0);
-- statement
alter table players add column if not exists contract_version int not null default 1;
-- statement
alter table extensions add column if not exists contract_version int not null default 1;
-- statement
alter table extension_negotiations add column if not exists contract_version int not null default 1;
-- statement
update players p set contract_version=1+(select count(*)::int from fa_awards a where a.player_id=p.id and a.offer_id is not null);
-- statement
update extensions e set contract_version=1+(select count(*)::int from fa_awards a
  where a.player_id=e.player_id and a.offer_id is not null and a.awarded_at<e.created_at);
-- statement
update extension_negotiations e set contract_version=p.contract_version from players p where p.id=e.player_id;
-- statement
alter table extensions add column if not exists owner_key text;
-- statement
update extensions e set owner_key = coalesce('sleeper:' || t.sleeper_user_id, 'team:' || t.id)
 from teams t where e.team_id = t.id and e.owner_key is null;
-- statement
alter table extensions alter column owner_key set not null;
-- statement
drop index if exists extensions_one_per_player;
-- statement
create unique index if not exists extensions_one_per_owner_contract on extensions(player_id, contract_version, owner_key);
-- statement
create unique index if not exists extensions_one_per_contract on extensions(player_id, contract_version) where accepted;
-- statement
alter table extension_negotiations add column if not exists owner_key text;
-- statement
update extension_negotiations e set owner_key = coalesce('sleeper:' || t.sleeper_user_id, 'team:' || t.id)
 from teams t where e.team_id = t.id and e.owner_key is null;
-- statement
alter table extension_negotiations alter column owner_key set not null;
-- statement
alter table extension_negotiations drop constraint if exists extension_negotiations_pkey;
-- statement
alter table extension_negotiations add primary key (player_id, contract_version, owner_key);
-- statement
create or replace function byf_extension_finish(player int, actor_team int, actor_owner text, expected_contract int, years int[], amounts jsonb, accepted boolean, expected_used int)
returns void language plpgsql set search_path from current as $$
declare p players%rowtype; actual_owner text; used int;
begin
  select * into p from players where id = player for update;
  if not found or p.team_id is distinct from actor_team then raise exception 'This player is no longer on your team'; end if;
  select coalesce('sleeper:' || t.sleeper_user_id, 'team:' || t.id) into actual_owner from teams t where t.id = actor_team;
  if actual_owner is distinct from actor_owner then raise exception 'Team ownership changed. Refresh.'; end if;
  if p.contract_version<>expected_contract then raise exception 'This player has a new contract. Refresh the negotiation.'; end if;
  if p.nba_experience is null then raise exception 'NBA experience has not been synced for this player'; end if;
  if p.nba_experience = 0 then raise exception 'Rookies cannot sign extensions'; end if;
  if exists(select 1 from extensions e where e.player_id = player and e.contract_version=p.contract_version and (e.accepted or e.owner_key=actor_owner)) then
    raise exception 'This contract has already been extended or your negotiation is closed';
  end if;
  select e.offers_used into used from extension_negotiations e where e.player_id = player and e.owner_key = actor_owner and e.contract_version=p.contract_version;
  if coalesce(used,0) <> expected_used then raise exception 'This negotiation changed in another tab. Reload it.'; end if;
  insert into extensions(player_id,team_id,owner_key,contract_version,years,amounts,total_value,accepted)
    values(player,actor_team,actor_owner,p.contract_version,years,amounts,(select coalesce(sum((amounts->>y::text)::bigint),0) from unnest(years) y),accepted);
  if accepted then
    insert into contracts(player_id,season,amount) select player,y,(amounts->>y::text)::bigint from unnest(years) y
      on conflict (player_id,season) do update set amount = excluded.amount;
  end if;
  delete from extension_negotiations e where e.player_id = player and e.owner_key = actor_owner and e.contract_version=p.contract_version;
end $$;

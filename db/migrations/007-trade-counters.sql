-- Atomic counters and replies: a counter replaces the pending proposal,
-- resets consent, and checks the version that the manager actually viewed.
alter table trades add column if not exists revision int not null default 0;
-- statement
create or replace function byf_trade_reply(trade_id uuid, actor_team int, expected_revision int, action text, counter jsonb default null)
returns jsonb language plpgsql set search_path from current as $$
declare
  proposal trades%rowtype;
  participant trade_teams%rowtype;
  entry jsonb;
begin
  select * into proposal from trades where id = trade_id for update;
  if not found then raise exception 'Trade not found'; end if;
  if proposal.revision <> expected_revision then raise exception 'This trade changed. Refresh before responding.'; end if;
  select * into participant from trade_teams tt where tt.trade_id = proposal.id and tt.team_id = actor_team;
  if not found then raise exception 'You are not a team in this trade'; end if;
  if action in ('accept', 'decline', 'counter') then
    if proposal.status <> 'proposed' or participant.accepted_at is not null then
      raise exception 'This proposal is no longer waiting for your response';
    end if;
  end if;
  if action = 'counter' then
    if (select array_agg(tt.team_id order by tt.team_id) from trade_teams tt where tt.trade_id = proposal.id)
       is distinct from (select array_agg((value->>'teamId')::int order by (value->>'teamId')::int) from jsonb_array_elements(counter->'teams')) then
      raise exception 'A counter must include the same teams';
    end if;
    delete from trade_items ti where ti.trade_id = proposal.id;
    for entry in select value from jsonb_array_elements(counter->'teams') loop
      update trade_teams tt set retained = (entry->>'retained')::bigint,
        accepted_at = case when tt.team_id = actor_team then clock_timestamp() else null end
        where tt.trade_id = proposal.id and tt.team_id = (entry->>'teamId')::int;
    end loop;
    for entry in select value from jsonb_array_elements(counter->'items') loop
      insert into trade_items(trade_id, player_id, from_team, to_team, kind, pick_season, pick_round, pick_original)
        values(proposal.id, (entry->>'playerId')::int, (entry->>'fromTeam')::int, (entry->>'toTeam')::int,
          entry->>'kind', (entry->>'pickSeason')::int, (entry->>'pickRound')::int, (entry->>'pickOriginal')::int);
    end loop;
    update trades set proposed_by = actor_team, revision = revision + 1, created_at = clock_timestamp() where id = proposal.id;
  elsif action = 'accept' then
    update trade_teams tt set accepted_at = clock_timestamp() where tt.trade_id = proposal.id and tt.team_id = actor_team;
    update trades set status = 'accepted' where id = proposal.id
      and not exists(select 1 from trade_teams tt where tt.trade_id = proposal.id and tt.accepted_at is null);
  elsif action = 'decline' then
    update trades set status = 'declined', decided_at = clock_timestamp() where id = proposal.id;
  elsif action = 'cancel' then
    if proposal.status not in ('proposed','accepted') or proposal.proposed_by is distinct from actor_team then
      raise exception 'Only the proposer can withdraw an open trade';
    end if;
    update trades set status = 'cancelled', decided_at = clock_timestamp() where id = proposal.id;
  else raise exception 'Unknown trade response';
  end if;
  return jsonb_build_object('ok',true,'revision',proposal.revision + case when action = 'counter' then 1 else 0 end);
end $$;

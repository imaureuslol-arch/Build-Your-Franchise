-- Free-agency bids: the minimum is the season's veteran minimum, not a flat $4M.
-- Run with: node scripts/migrate.mjs 003-fa-vet-minimum.sql

-- Veteran minimum for a season (matches getVetMin in src/lib/types.ts):
-- $4,166,667 in 2026-27, rising $166,667 a season.
create or replace function byf_vet_min(season int) returns bigint language sql immutable as $$
  select round((25000000 + greatest(0, season - 2027) * 1000000)::numeric / 6)::bigint
$$;
-- statement
create or replace function byf_fa_action(body jsonb, actor uuid, actor_team int, current_season int)
returns jsonb language plpgsql set search_path from current as $$
declare
  r fa_rounds%rowtype;
  bid free_agent_offers%rowtype;
  p players%rowtype;
  chosen_years int[];
  chosen_amounts jsonb;
  year_index int;
  prev_amount bigint;
  amount bigint;
  cap numeric;
  hard_cap bigint := round(240000000 + greatest(0, current_season - 2027) * (25000000::numeric / 3));
  deadline timestamptz;
  result jsonb;
begin
  -- Serialize deadline edits, submissions, clearing and awards. Check the
  -- database clock AFTER acquiring the lock, including queued requests.
  perform pg_advisory_xact_lock(733016);
  select * into r from fa_rounds order by id desc limit 1 for update;
  if (body ->> 'roundId')::int is distinct from r.id then raise exception 'The free-agency round changed. Refresh the page.'; end if;

  if body ->> 'action' in ('deadline', 'new_round') then
    deadline := (body ->> 'closesAt')::timestamptz;
    if deadline is null or deadline <= clock_timestamp() then raise exception 'Choose a future deadline'; end if;
    if body ->> 'action' = 'deadline' then
      if r.closes_at <= clock_timestamp() then raise exception 'Bidding has closed. Finish this round before starting another.'; end if;
      update fa_rounds set closes_at = deadline where id = r.id;
    else
      if r.closes_at is null or r.closes_at > clock_timestamp() then raise exception 'The current round is still open'; end if;
      if exists(select 1 from free_agent_offers o where o.round_id = r.id
        and not exists(select 1 from fa_awards a where a.round_id = r.id and a.player_id = o.player_id)) then
        raise exception 'Award or dismiss every player with bids before starting another round';
      end if;
      insert into fa_rounds(closes_at) values(deadline) returning * into r;
    end if;
    result := jsonb_build_object('roundId', r.id);

  elsif body ->> 'action' in ('bid', 'clear') then
    if r.closes_at is null then raise exception 'The commissioner has not set a free-agency deadline yet'; end if;
    if r.closes_at <= clock_timestamp() then raise exception 'Bidding is closed'; end if;
    select * into p from players where id = (body ->> 'playerId')::int for update;
    if not found then raise exception 'Player not found'; end if;
    if body ->> 'action' = 'clear' then
      delete from free_agent_offers where round_id = r.id and player_id = p.id;
      result := jsonb_build_object('ok', true);
    else
      if actor_team is null then raise exception 'Log in with your team link to bid'; end if;
      if p.team_id is not null then raise exception 'That player is not a free agent'; end if;
      chosen_amounts := body -> 'amounts';
      select array_agg(value::int order by value::int) into chosen_years from jsonb_array_elements_text(body -> 'years');
      if chosen_years is null or cardinality(chosen_years) > 4
        or chosen_years[1] <> current_season or chosen_years[cardinality(chosen_years)] > current_season + 3 then
        raise exception 'Select consecutive seasons starting with the current season';
      end if;
      if jsonb_typeof(chosen_amounts) is distinct from 'object' then raise exception 'Invalid bid amounts'; end if;
      for year_index in 1..cardinality(chosen_years) loop
        if chosen_years[year_index] <> current_season + year_index - 1 then raise exception 'Select consecutive seasons'; end if;
        if jsonb_typeof(chosen_amounts -> chosen_years[year_index]::text) is distinct from 'number'
          or (chosen_amounts ->> chosen_years[year_index]::text)::numeric <> trunc((chosen_amounts ->> chosen_years[year_index]::text)::numeric) then
          raise exception 'Bid amounts must be whole dollars';
        end if;
        amount := (chosen_amounts ->> chosen_years[year_index]::text)::bigint;
        if amount < byf_vet_min(chosen_years[year_index]) or amount > 1000000000000 then
          raise exception 'Each season must be at least the veteran minimum (%)', byf_vet_min(chosen_years[year_index]);
        end if;
        if prev_amount is not null and abs(amount - prev_amount) > prev_amount * 0.10 then
          raise exception 'Each salary must be within 10%% of the previous season';
        end if;
        prev_amount := amount;
      end loop;
      select coalesce((select sum(c.amount) from contracts c join players roster_player on roster_player.id = c.player_id
        where roster_player.team_id = actor_team and c.season = current_season), 0)
        + coalesce((select sum(d.amount) from dead_cap d where d.team_id = actor_team and d.season = current_season), 0) into cap;
      if cap > hard_cap and exists(select 1 from unnest(chosen_years) y where (chosen_amounts ->> y::text)::bigint <> byf_vet_min(y)) then
        raise exception 'Teams over the hard cap may only offer the veteran minimum each season';
      end if;
      select jsonb_object_agg(y::text, chosen_amounts -> y::text) into chosen_amounts from unnest(chosen_years) y;
      insert into free_agent_offers(round_id, player_id, team_id, years, amounts, total_value)
        values(r.id, p.id, actor_team, chosen_years, chosen_amounts,
          (select sum(value::text::bigint) from jsonb_each(chosen_amounts))) returning * into bid;
      result := jsonb_build_object('offer', to_jsonb(bid));
    end if;

  elsif body ->> 'action' in ('award', 'dismiss') then
    if r.closes_at is null or r.closes_at > clock_timestamp() then raise exception 'Wait until bidding closes'; end if;
    select * into p from players where id = (body ->> 'playerId')::int for update;
    if not found then raise exception 'Player not found'; end if;
    if exists(select 1 from fa_awards where round_id = r.id and player_id = p.id) then
      return jsonb_build_object('ok', true, 'alreadyProcessed', true);
    end if;
    if body ->> 'action' = 'dismiss' then
      if length(trim(body ->> 'note')) not between 1 and 500 then raise exception 'Enter a reason for dismissing these bids'; end if;
      if not exists(select 1 from free_agent_offers where round_id = r.id and player_id = p.id) then raise exception 'No bids for this player'; end if;
      insert into fa_awards(round_id, player_id, note) values(r.id, p.id, trim(body ->> 'note'));
    else
      select * into bid from free_agent_offers where id = (body ->> 'offerId')::uuid and round_id = r.id and player_id = p.id;
      if not found then raise exception 'Bid not found in this round'; end if;
      if byf_bid_value(bid.years, bid.amounts) is distinct from
        (select max(byf_bid_value(years, amounts)) from free_agent_offers where round_id = r.id and player_id = p.id) then
        raise exception 'Only a highest-ranked bid can be awarded';
      end if;
      if p.team_id is not null then raise exception 'This player is already rostered. Correct the contract or dismiss these bids.'; end if;
      if exists(select 1 from contracts where player_id = p.id and season >= current_season) then raise exception 'This player already has a contract. Correct it before awarding.'; end if;
      if bid.years[1] <> current_season or bid.years[cardinality(bid.years)] > current_season + 3 then raise exception 'This bid is for an outdated season. Dismiss it and open a new round.'; end if;
      -- Lock the winning team as well as the player before applying its salary.
      perform 1 from teams where id = bid.team_id for update;
      select coalesce((select sum(c.amount) from contracts c join players roster_player on roster_player.id = c.player_id
        where roster_player.team_id = bid.team_id and c.season = current_season), 0)
        + coalesce((select sum(d.amount) from dead_cap d where d.team_id = bid.team_id and d.season = current_season), 0) into cap;
      if cap > hard_cap and exists(select 1 from unnest(bid.years) y where (bid.amounts ->> y::text)::bigint <> byf_vet_min(y)) then
        raise exception 'The winning team is now over the hard cap. Resolve its cap or dismiss these bids.';
      end if;
      update players set team_id = bid.team_id where id = p.id;
      insert into contracts(player_id, season, amount)
        select p.id, y, (bid.amounts ->> y::text)::bigint from unnest(bid.years) y;
      insert into fa_awards(round_id, player_id, offer_id, team_id, years, amounts)
        values(r.id, p.id, bid.id, bid.team_id, bid.years, bid.amounts);
    end if;
    result := jsonb_build_object('ok', true);
  else
    raise exception 'Unknown free-agency action';
  end if;
  insert into audit_log(session_id, team_id, action, detail)
    values(actor, actor_team, 'fa_' || (body ->> 'action'), body || result);
  return result;
end $$;

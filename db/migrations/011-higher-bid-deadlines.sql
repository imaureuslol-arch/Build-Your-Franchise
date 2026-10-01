-- Better bids shorten the running player clock. A different manager's bid adds
-- twelve hours; consecutive bids from the same manager add no time.
select pg_advisory_xact_lock(733016);
-- statement
alter table fa_player_auctions add column if not exists acceptance_days numeric;
-- statement
alter table fa_player_auctions add column if not exists last_bid_team_id int references teams(id);
-- statement
-- Recover the original duration even when a commissioner cleared earlier bids.
-- Audit records preserve those offers; deduplicate them against the offer log.
with history as (
  select id,round_id,player_id,team_id,created_at,byf_bid_value(years,amounts) as weighted from free_agent_offers
  union
  select (detail->'offer'->>'id')::uuid,(detail->'offer'->>'round_id')::int,
    (detail->'offer'->>'player_id')::int,(detail->'offer'->>'team_id')::int,(detail->'offer'->>'created_at')::timestamptz,
    byf_bid_value(array(select jsonb_array_elements_text(detail->'offer'->'years')::int),detail->'offer'->'amounts')
  from audit_log where action='fa_bid' and detail->'offer'->>'id' is not null
), ordered as (
  select *,lag(team_id) over(partition by round_id,player_id order by created_at,id) as previous_team from history
), original as (
  select round_id,player_id,(array_agg(weighted order by created_at,id))[1] as first_value,
    (array_agg(team_id order by created_at desc,id desc))[1] as last_team,
    count(*) filter(where previous_team=team_id) as self_rebids,
    max(created_at) filter(where previous_team is not null and previous_team<>team_id) as last_competing_at
  from ordered group by round_id,player_id
), best as (
  select round_id,player_id,max(byf_bid_value(years,amounts)) as weighted
  from free_agent_offers group by round_id,player_id
), baseline as (
  select a.*,o.last_team,coalesce(o.self_rebids,0) as self_rebids,o.last_competing_at,
    coalesce(byf_fa_days(o.first_value,a.fair_value),
      least(30,greatest(3,extract(epoch from a.accepts_at-a.first_bid_at)/86400))) as original_days,
    byf_fa_days(b.weighted,a.fair_value) as best_days,
    a.accepts_at>clock_timestamp() and a.matched_offer_id is null
      and not exists(select 1 from fa_awards award where award.round_id=a.round_id and award.player_id=a.player_id) as open
  from fa_player_auctions a left join original o using(round_id,player_id) left join best b using(round_id,player_id)
  where a.acceptance_days is null
), repaired as (
  update fa_player_auctions a set
    accepts_at=case when b.open then greatest(coalesce(b.last_competing_at+interval '12 hours',a.first_bid_at),
      a.accepts_at-(b.original_days-least(b.original_days,b.best_days))::double precision*interval '1 day'
        -b.self_rebids*interval '12 hours') else a.accepts_at end,
    acceptance_days=case when b.open then least(b.original_days,b.best_days) else b.original_days end,
    last_bid_team_id=b.last_team
  from baseline b where a.round_id=b.round_id and a.player_id=b.player_id
  returning a.round_id,a.player_id,a.accepts_at,a.acceptance_days,b.accepts_at as old_accepts_at
)
insert into audit_log(action,detail)
  select 'fa_player_deadline_shortened',to_jsonb(repaired) from repaired where accepts_at is distinct from old_accepts_at;
-- statement
alter table fa_player_auctions alter column acceptance_days set not null;
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
  bid_days numeric;
  rebid_delay interval;
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
    insert into fa_rounds(closes_at) values(coalesce((body->>'closesAt')::timestamptz,r.closes_at)) returning * into r;
    result:=jsonb_build_object('roundId',r.id);
  elsif body->>'action'='deadline' then
    if body->>'closesAt' is null or (body->>'closesAt')::timestamptz<=clock_timestamp() then
      raise exception 'Choose a future date and time';
    end if;
    update fa_rounds set closes_at=(body->>'closesAt')::timestamptz where id=r.id returning * into r;
    result:=jsonb_build_object('roundId',r.id);
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
          bid_days:=byf_fa_days(byf_bid_value(bid.years,bid.amounts),fair);
          insert into fa_player_auctions(round_id,player_id,first_bid_at,accepts_at,fair_value,rfa_owner_key,acceptance_days,last_bid_team_id)
            values(r.id,p.id,clock_timestamp(),clock_timestamp()+bid_days::double precision*interval '1 day',fair,
              (select rf.owner_key from restricted_free_agents rf where rf.player_id=p.id),bid_days,actor_team);
        else
          -- Shorten the original running clock by the improvement in bid quality.
          -- Lower bids and cleared bids cannot restore a longer base duration.
          bid_days:=least(auction.acceptance_days,byf_fa_days(byf_bid_value(bid.years,bid.amounts),auction.fair_value));
          rebid_delay:=case when auction.last_bid_team_id=actor_team then interval '0 hours' else interval '12 hours' end;
          update fa_player_auctions set
            accepts_at=greatest(clock_timestamp()+rebid_delay,
              auction.accepts_at-(auction.acceptance_days-bid_days)::double precision*interval '1 day'+rebid_delay),
            acceptance_days=bid_days,last_bid_team_id=actor_team
            where round_id=r.id and player_id=p.id;
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

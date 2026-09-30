-- Draft picks, owned as in Sleeper, and tradeable on the site.
-- Run with: node scripts/migrate.mjs 006-draft-picks.sql

-- One row per pick in an upcoming draft. season is the draft year as
-- Sleeper labels it (the 2027 draft happens before the 2027-28 season).
create table if not exists draft_picks (
  season        int not null,
  round         int not null,
  original_team int not null references teams(id) on delete cascade,
  owner_team    int not null references teams(id) on delete cascade,
  primary key (season, round, original_team)
);
-- statement
-- What a trade item moves: a player, a team's dead cap, or a draft pick.
alter table trade_items add column if not exists kind text not null default 'player'
  check (kind in ('player', 'dead_cap', 'pick'));
-- statement
update trade_items set kind = 'dead_cap' where player_id is null and kind = 'player';
-- statement
alter table trade_items add column if not exists pick_season int;
-- statement
alter table trade_items add column if not exists pick_round int;
-- statement
alter table trade_items add column if not exists pick_original int references teams(id) on delete cascade;
-- statement
-- sync_issues can now point at a pick instead of a player.
alter table sync_issues drop constraint if exists sync_issues_kind_player_id_key;

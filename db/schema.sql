-- Build Your Franchise V2 schema (Neon Postgres).
-- Run once on an empty database: psql "$DATABASE_URL" -f db/schema.sql
-- or paste into the Neon SQL editor.

-- One row per Sleeper roster. Sleeper is the authority on who owns what;
-- the sync job keeps owner/name current.
create table teams (
  id              serial primary key,
  sleeper_roster  int unique,
  name            text not null unique,
  owner_name      text,           -- Sleeper display name
  sleeper_user_id text,
  conference      text
);

-- Every NBA player we know about. team_id null = free agent.
create table players (
  id          serial primary key,
  sleeper_id  text unique,
  name        text not null,
  team_id     int references teams(id) on delete set null,
  nba_team    text,
  birthdate   date,
  ppg         real,               -- fantasy points per game
  avg_gp      real,               -- avg games played, last 3 seasons
  active      boolean not null default true
);
create index players_team_idx on players(team_id);

-- One row per player per season. Season = the year the season ends
-- (2026-27 is 2027), matching SALARY_YEARS in src/lib/types.ts.
create table contracts (
  player_id int not null references players(id) on delete cascade,
  season    int not null,
  amount    bigint not null,
  primary key (player_id, season)
);

-- Salary a team still pays for someone no longer on its roster
-- (retained salary in trades, waived players).
create table dead_cap (
  id      serial primary key,
  team_id int not null references teams(id) on delete cascade,
  label   text not null,
  season  int not null,
  amount  bigint not null
);

create table extensions (
  id          uuid primary key default gen_random_uuid(),
  player_id   int not null references players(id) on delete cascade,
  team_id     int not null references teams(id),
  years       int[] not null,
  amounts     jsonb not null,
  total_value bigint not null,
  accepted    boolean not null,
  created_at  timestamptz not null default now()
);
create unique index extensions_one_per_player on extensions(player_id);

create table free_agent_offers (
  id          uuid primary key default gen_random_uuid(),
  player_id   int not null references players(id) on delete cascade,
  team_id     int not null references teams(id),
  years       int[] not null,
  amounts     jsonb not null,
  total_value bigint not null,
  created_at  timestamptz not null default now()
);

-- Login links. The link token is shown once and only its SHA-256 is kept.
-- kind 'team'   : the owner's permanent link, replaced when regenerated
-- kind 'device' : one-time link an owner makes to add another device
-- A link with a role grants commissioner powers on top of (or without) a team.
create table login_links (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique,
  team_id     int references teams(id) on delete cascade,
  role        text check (role in ('commish', 'subcommish')),
  kind        text not null check (kind in ('team', 'device')),
  expires_at  timestamptz,
  used_at     timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table sessions (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique,
  team_id     int references teams(id) on delete cascade,
  role        text check (role in ('commish', 'subcommish')),
  link_id     uuid references login_links(id) on delete set null,
  user_agent  text,
  country     text,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  revoked_at  timestamptz
);
create index sessions_team_idx on sessions(team_id);

-- Who did what, from which session.
create table audit_log (
  id          bigserial primary key,
  session_id  uuid references sessions(id) on delete set null,
  team_id     int references teams(id) on delete set null,
  action      text not null,
  detail      jsonb,
  created_at  timestamptz not null default now()
);

-- Roster differences between Sleeper and the contract book, written by the
-- Sleeper sync and cleared when resolved.
create table sync_issues (
  id          serial primary key,
  kind        text not null,        -- no_contract | not_on_sleeper_roster | wrong_team
  player_id   int references players(id) on delete cascade,
  team_id     int references teams(id) on delete cascade,
  detail      text,
  created_at  timestamptz not null default now(),
  unique (kind, player_id)
);

-- Trades. Proposed by one team, accepted by every other team, approved by a
-- commissioner, then executed: players move and retained salary is booked
-- as dead cap (a positive row for the team that keeps it, a negative row -
-- a credit - for the team that receives the player).
create table trades (
  id           uuid primary key default gen_random_uuid(),
  status       text not null check (status in ('proposed', 'accepted', 'approved', 'declined', 'rejected', 'cancelled')),
  proposed_by  int references teams(id) on delete set null,
  season       int not null,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz,
  note         text
);

create table trade_teams (
  trade_id     uuid not null references trades(id) on delete cascade,
  team_id      int not null references teams(id) on delete cascade,
  retained     bigint not null default 0,
  accepted_at  timestamptz,
  primary key (trade_id, team_id)
);

-- player_id null = the team's dead cap changing hands.
create table trade_items (
  id           serial primary key,
  trade_id     uuid not null references trades(id) on delete cascade,
  player_id    int references players(id) on delete cascade,
  from_team    int not null references teams(id) on delete cascade,
  to_team      int not null references teams(id) on delete cascade
);
create index trade_items_trade_idx on trade_items(trade_id);

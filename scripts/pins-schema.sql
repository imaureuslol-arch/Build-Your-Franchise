-- PIN-gated team login.
-- Run once in the Supabase SQL editor, then seed PINs with:
--   node scripts/set-pins.mjs
--
-- This script does NOT touch any existing table's RLS settings — players,
-- team_owners, extensions, free_agent_offers, ip_team_mappings and the rest
-- stay exactly as they are, so the Excel sheet keeps writing to them.
--
-- The two NEW tables below are the exception: they have RLS on with no
-- policies, so only the service-role key can read them. That is not optional
-- housekeeping, it's what makes the PINs work at all:
--
--   * team_pins    — a 4-digit PIN has only 10,000 possible values. Anyone who
--                    can read the hash+salt cracks it offline in seconds, and
--                    the anon key is sitting in the client-side JS bundle. The
--                    hash has to be unreadable or the PIN is decorative.
--   * pin_attempts — this is the lockout counter. If it were writable with the
--                    anon key, an attacker would just delete their own failed
--                    rows and brute-force all 10,000 PINs online.
--
-- Nothing else reads these tables — they're brand new, so the Excel sheet has
-- never touched them and can't be affected.
--
-- team_pins is also deliberately NOT a column on team_owners: the browser
-- reads team_owners with the anon key (`select *` in src/lib/hooks.ts), so
-- anything stored there is public by definition.

-- on update cascade: renaming a team in team_owners carries its PIN across
-- rather than dropping it. on delete cascade: a team that leaves the league
-- takes its PIN with it.
create table if not exists team_pins (
  team_name  text primary key references team_owners(team_name)
               on delete cascade on update cascade,
  pin_hash   text not null,
  -- Bumped by the commissioner's "Log out" action. Session cookies carry the
  -- epoch they were issued at, so bumping it invalidates every cookie for that
  -- team — deleting IP rows alone would not, since the cookie outlives them.
  session_epoch integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table team_pins enable row level security;
-- (no policies => anon/authenticated get nothing; service role bypasses RLS)

-- Append-only log of PIN entries, used for rate limiting and for the
-- commissioner's login history view.
create table if not exists pin_attempts (
  id         bigserial primary key,
  ip         text not null,
  -- team name, or '__commish__' / '__subcommish__' for the elevated logins
  scope      text not null,
  success    boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists pin_attempts_ip_created_idx
  on pin_attempts (ip, created_at desc);

alter table pin_attempts enable row level security;

-- Distinguish successful logins from failed guesses in the existing history view.
alter table ip_login_history
  add column if not exists success boolean not null default true;

-- Optional housekeeping: drop attempt rows older than 30 days.
-- delete from pin_attempts where created_at < now() - interval '30 days';

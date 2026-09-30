-- Sleeper is the authority on rosters: "Sync now" moves players to match it,
-- which can undo a trade approved on the site.
-- Run with: node scripts/migrate.mjs 005-sleeper-authoritative.sql
alter table trades drop constraint if exists trades_status_check;
-- statement
alter table trades add constraint trades_status_check
  check (status in ('proposed', 'accepted', 'approved', 'declined', 'rejected', 'cancelled', 'undone'));
-- statement
-- Retained salary booked by a trade, so undoing the trade removes it too.
alter table dead_cap add column if not exists trade_id uuid references trades(id) on delete set null;

-- Fair value computed nightly from projections, history, age, health and the
-- dynasty market (src/lib/valuation.ts), plus a commissioner health override.
-- Run with: node scripts/migrate.mjs 004-fair-value.sql
alter table players add column if not exists proj_fppg real;
-- statement
alter table players add column if not exists adp_dynasty real;
-- statement
alter table players add column if not exists fair_value real;
-- statement
-- Games per season the commissioner expects, replacing avg_gp in fair value
-- (e.g. a star returning from a one-off injury). Null = use avg_gp.
alter table players add column if not exists gp_override real;

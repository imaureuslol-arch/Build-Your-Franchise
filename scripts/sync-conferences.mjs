// Refresh conference labels only. No roster moves, salary edits or pick transfers.
// node scripts/sync-conferences.mjs          (review)
// node scripts/sync-conferences.mjs --apply  (update stored fallback)
process.loadEnvFile(".env.local");
const { neon } = await import("@neondatabase/serverless");
const { loadSleeperConferences } = await import("../src/lib/sleeper-conferences.ts");
const leagueId = process.env.SLEEPER_LEAGUE_ID;
if (!leagueId || !process.env.DATABASE_URL) throw new Error("League/database configuration missing");
const sql = neon(process.env.DATABASE_URL);
const [teams, conferences] = await Promise.all([
  sql`select id, name, sleeper_roster, conference from teams order by name`,
  loadSleeperConferences(leagueId),
]);
const target = teams.map((team) => ({ ...team, target: conferences.get(team.sleeper_roster) }));
if (target.some((team) => !team.target)) throw new Error("Sleeper conference assignment missing; no teams updated");
const changes = target.filter((team) => team.conference !== team.target);
const split = {};
for (const team of target) split[team.target] = (split[team.target] ?? 0) + 1;
console.log(JSON.stringify({ teams: teams.length, changes: changes.length, split }, null, 2));
if (process.argv.includes("--apply")) {
  const rows = await sql`
    update teams t set conference = x.conference
    from unnest(${target.map((t) => t.id)}::int[], ${target.map((t) => t.target)}::text[]) as x(id, conference)
    where t.id = x.id and t.conference is distinct from x.conference
    returning t.id`;
  const after = await sql`select id, conference from teams`;
  if (after.length !== teams.length || after.some((team) => team.conference !== target.find((t) => t.id === team.id)?.target)) {
    throw new Error("Stored assignments do not match Sleeper");
  }
  console.log(`Updated ${rows.length} conference assignments; all ${after.length} match Sleeper.`);
}

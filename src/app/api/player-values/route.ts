import { sql } from "@/lib/db";

/**
 * GET /api/player-values
 * Returns { values: Record<number, { fairValue, age, gpOverride }>, scoring }
 * for every player with a fair value (computed nightly, see
 * src/lib/valuation.ts), plus the league's Sleeper scoring settings.
 */
export async function GET() {
  const [rows, league] = await Promise.all([
    sql`select id, fair_value, gp_override, date_part('year', age(birthdate))::int as age
        from players where fair_value is not null and birthdate is not null`,
    fetch(`https://api.sleeper.app/v1/league/${process.env.SLEEPER_LEAGUE_ID}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);

  const values: Record<number, { fairValue: number; age: number; gpOverride: number | null }> = {};
  for (const row of rows) values[row.id] = { fairValue: row.fair_value, age: row.age, gpOverride: row.gp_override };
  return Response.json({ values, scoring: league?.scoring_settings ?? null });
}

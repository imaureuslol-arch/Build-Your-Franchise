import { sql } from "@/lib/db";
import { calcFairValue, ageFromBirthdate } from "@/lib/fair-value";

/**
 * GET /api/player-values
 * Returns { values: Record<number, { fairValue, age }> } for every player
 * that has ppg, avg_gp, and birthdate.
 */
export async function GET() {
  const rows = await sql`
    select id, ppg, avg_gp, birthdate::text as birthdate from players
    where ppg is not null and avg_gp is not null and birthdate is not null`;

  const values: Record<number, { fairValue: number; age: number }> = {};
  for (const row of rows) {
    const age = ageFromBirthdate(row.birthdate);
    if (age == null) continue;
    const fv = calcFairValue(age, row.ppg, row.avg_gp);
    values[row.id] = { fairValue: Math.round(fv * 10) / 10, age };
  }

  return Response.json({ values });
}

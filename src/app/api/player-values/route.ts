import { createClient } from "@supabase/supabase-js";
import { calcFairValue, ageFromBirthdate } from "@/lib/fair-value";

function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * GET /api/player-values
 * Returns { values: Record<number, { fairValue, age }> } for all rostered players
 * that have ppg, avg_gp, and birthdate.
 */
export async function GET() {
  const supabase = getSupabaseServer();

  const { data, error } = await supabase
    .from("players")
    .select("id, name, ppg, avg_gp, birthdate")
    .not("ppg", "is", null)
    .not("avg_gp", "is", null)
    .not("birthdate", "is", null);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const values: Record<number, { fairValue: number; age: number }> = {};

  for (const row of data) {
    if (row.name === "Dead Cap") continue;
    const age = ageFromBirthdate(row.birthdate);
    if (age == null) continue;

    const fv = calcFairValue(age, row.ppg, row.avg_gp);
    values[row.id] = {
      fairValue: Math.round(fv * 10) / 10,
      age,
    };
  }

  return Response.json({ values });
}

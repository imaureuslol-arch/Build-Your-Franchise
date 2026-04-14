import { createClient } from "@supabase/supabase-js";

export const runtime = "edge";

function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function ageFromBirthdate(birthdate: string): number | null {
  const dob = new Date(birthdate);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

function calcFairValue(age: number, ppg: number, avgGamesPlayed: number): number {
  const ppgTerm =
    1 +
    54 / (1 + Math.exp(-0.3 * (ppg - 19.3))) +
    3 * Math.exp(-((ppg - 13.5) ** 2) / (2 * 16));

  const ppgFactor =
    (1 + 0.1484058 * ((ppg / 40) ** 2 - 0.19140625)) *
    (0.2 + 0.8 * (1 - Math.exp(-0.15 * ppg))) *
    1.061616;

  const gamesFactor =
    (0.5 + 0.5 * (avgGamesPlayed / 82) ** 0.7) *
    (0.4 + 0.6 * (1 - Math.exp(-0.12 * avgGamesPlayed)));

  const ageBase =
    1 +
    0.8 / (1 + Math.exp(0.25 * (age - 27))) +
    0.05 * Math.exp(-0.12 * (age - 35));
  const ageFactor = ageBase ** 1.1;

  const ageDecline = age > 31 ? 0.9 ** (age - 31) : 1;

  const bonusTerm = 1 + 0.25 / (0.4 + Math.exp(-1 * (ppg - 30)));

  const raw =
    ppgTerm * ppgFactor * gamesFactor * ageFactor * ageDecline * bonusTerm * 0.6;
  return Math.min(80, raw);
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

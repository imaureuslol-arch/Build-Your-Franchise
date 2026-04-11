import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Age in whole years from an ISO date string (YYYY-MM-DD). */
function ageFromBirthdate(birthdate: string): number | null {
  const dob = new Date(birthdate);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) {
    age--;
  }
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
    ppgTerm * ppgFactor * gamesFactor * ageFactor * ageDecline * bonusTerm * 0.5;
  return Math.min(65, raw); // millions
}

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name");
  if (!name) return Response.json({ error: "name required" }, { status: 400 });

  const supabase = getSupabaseServer();
  const { data: dbPlayer, error: dbError } = await supabase
    .from("players")
    .select("ppg, avg_gp, birthdate")
    .eq("name", name)
    .maybeSingle();

  if (dbError) {
    return Response.json(
      { error: `Database error: ${dbError.message}` },
      { status: 500 }
    );
  }

  const ppg: number | null = dbPlayer?.ppg ?? null;
  const avgGamesPlayed: number | null = dbPlayer?.avg_gp ?? null;
  const birthdate: string | null = dbPlayer?.birthdate ?? null;

  if (ppg == null || avgGamesPlayed == null) {
    return Response.json(
      { error: "Stats missing for this player — contact the commissioner to update." },
      { status: 404 }
    );
  }

  if (!birthdate) {
    return Response.json(
      { error: "Birthdate missing for this player — contact the commissioner to update." },
      { status: 404 }
    );
  }

  const age = ageFromBirthdate(birthdate);
  if (age == null) {
    return Response.json(
      { error: "Invalid birthdate stored for this player — contact the commissioner." },
      { status: 500 }
    );
  }

  const fairValueMillions = calcFairValue(age, ppg, avgGamesPlayed);

  return Response.json({
    fairValue: Math.round(fairValueMillions * 10) / 10,
    age,
    ppg: Math.round(ppg * 10) / 10,
    avgGamesPlayed: Math.round(avgGamesPlayed),
  });
}

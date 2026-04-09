import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BDL_BASE = "https://api.balldontlie.io/v1";

function bdlHeaders() {
  return { Authorization: process.env.BDL_API_KEY! };
}

function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

const SUFFIXES = /\s+(jr\.?|sr\.?|ii|iii|iv)$/i;

/** Split "LeBron James Jr." → { first: "LeBron", last: "James" } */
function splitName(fullName: string): { first: string; last: string } {
  const cleaned = fullName.replace(SUFFIXES, "").trim();
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function ageFromDraftYear(draftYear: number | null): number | null {
  if (!draftYear) return null;
  // Most players enter the league around age 20
  return 2026 - draftYear + 20;
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

  // ── 1. Read PPG + avg_gp from Supabase ──
  const supabase = getSupabaseServer();
  const { data: dbPlayer, error: dbError } = await supabase
    .from("players")
    .select("ppg, avg_gp")
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

  if (ppg == null || avgGamesPlayed == null) {
    return Response.json(
      { error: "Stats missing for this player — contact the commissioner to update." },
      { status: 404 }
    );
  }

  // ── 2. Look up age via BDL ──
  let age: number | null = null;
  try {
    const { first, last } = splitName(name);

    // Use first_name + last_name params (multi-word ?search= returns empty)
    const params = new URLSearchParams({ per_page: "5" });
    if (first) params.set("first_name", first);
    if (last) params.set("last_name", last);

    const searchRes = await fetch(`${BDL_BASE}/players?${params}`, {
      headers: bdlHeaders(),
    });

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const player = searchData.data?.[0];
      if (player) {
        age = ageFromDraftYear(player.draft_year);
      }
    }
  } catch {
    // BDL down — age stays null
  }

  if (age == null) {
    return Response.json(
      { error: "Could not determine player age — contact the commissioner." },
      { status: 404 }
    );
  }

  // ── 3. Calculate fair value ──
  const fairValueMillions = calcFairValue(age, ppg, avgGamesPlayed);

  return Response.json({
    fairValue: Math.round(fairValueMillions * 10) / 10,
    age,
    ppg: Math.round(ppg * 10) / 10,
    avgGamesPlayed: Math.round(avgGamesPlayed),
  });
}

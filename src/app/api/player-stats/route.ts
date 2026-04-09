import { NextRequest } from "next/server";

const BDL_BASE = "https://api.balldontlie.io/v1";
const SEASONS = [2022, 2023, 2024];

function bdlHeaders() {
  return { Authorization: process.env.BDL_API_KEY! };
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

  const raw = ppgTerm * ppgFactor * gamesFactor * ageFactor * ageDecline * bonusTerm * 0.5;
  return Math.min(65, raw); // millions
}

function ageFromBirthDate(birthDate: string): number {
  const bd = new Date(birthDate);
  const today = new Date("2026-04-09");
  const age =
    today.getFullYear() -
    bd.getFullYear() -
    (today < new Date(today.getFullYear(), bd.getMonth(), bd.getDate()) ? 1 : 0);
  return age;
}

function ageFromDraftYear(draftYear: number | null): number {
  // Most players enter the league at ~20; rough but reasonable fallback
  return draftYear ? 2026 - draftYear + 20 : 27;
}

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name");
  if (!name) return Response.json({ error: "name required" }, { status: 400 });

  try {
    // 1. Search for the player
    const searchRes = await fetch(
      `${BDL_BASE}/players?search=${encodeURIComponent(name)}&per_page=5`,
      { headers: bdlHeaders() }
    );
    const searchData = await searchRes.json();
    const player = searchData.data?.[0];

    if (!player) {
      return Response.json({ error: "player not found" }, { status: 404 });
    }

    // 2. Determine age — try birth_date, fall back to draft_year
    let age = 27;
    try {
      const detailRes = await fetch(`${BDL_BASE}/players/${player.id}`, {
        headers: bdlHeaders(),
      });
      const detail = await detailRes.json();
      if (detail.birth_date) {
        age = ageFromBirthDate(detail.birth_date);
      } else {
        age = ageFromDraftYear(detail.draft_year ?? player.draft_year);
      }
    } catch {
      age = ageFromDraftYear(player.draft_year);
    }

    // 3. Fetch season averages for last 3 seasons in parallel
    const seasonResults = await Promise.all(
      SEASONS.map((season) =>
        fetch(
          `${BDL_BASE}/season_averages?season=${season}&player_ids[]=${player.id}`,
          { headers: bdlHeaders() }
        )
          .then((r) => r.json())
          .then((d) => d.data?.[0] ?? null)
          .catch(() => null)
      )
    );

    const validSeasons = seasonResults.filter(Boolean);

    if (validSeasons.length === 0) {
      return Response.json({ error: "no stats found" }, { status: 404 });
    }

    // PPG from most recent season with data
    const mostRecent = validSeasons[validSeasons.length - 1];
    const ppg: number = mostRecent.pts ?? 0;

    // Avg games played over available seasons
    const avgGamesPlayed =
      validSeasons.reduce((sum: number, s) => sum + (s.games_played ?? 0), 0) /
      validSeasons.length;

    const fairValueMillions = calcFairValue(age, ppg, avgGamesPlayed);

    return Response.json({
      fairValue: Math.round(fairValueMillions * 10) / 10, // 1 decimal place, in millions
      age,
      ppg: Math.round(ppg * 10) / 10,
      avgGamesPlayed: Math.round(avgGamesPlayed),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "fetch failed" },
      { status: 500 }
    );
  }
}

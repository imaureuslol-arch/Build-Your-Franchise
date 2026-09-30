/**
 * Fantasy stats from Sleeper, scored with the league's own settings.
 *
 *   ppg     fantasy points per game in the last completed season
 *   avg_gp  games played, averaged over the last three seasons he played
 *
 * Sleeper keys a season by the year it starts (2025 = 2025-26), while this
 * site keys it by the year it ends (2026 = 2025-26). Players with no games
 * in the last completed season keep whatever they had.
 */

import { sql } from "./db";
import { getCurrentSeasonYear } from "./types";

const API = "https://api.sleeper.app/v1";

type StatLine = Record<string, number>;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`Sleeper ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export function fantasyPoints(stats: StatLine, scoring: Record<string, number>): number {
  let total = 0;
  for (const [stat, weight] of Object.entries(scoring)) total += (stats[stat] ?? 0) * weight;
  return total;
}

export async function syncStats(leagueId: string): Promise<{ updated: number; season: string }> {
  // Current season 2026-27 is 2027 here; the last completed one starts in 2025.
  const lastStart = getCurrentSeasonYear() - 2;
  const starts = [lastStart, lastStart - 1, lastStart - 2];

  const [league, ...seasons] = await Promise.all([
    get<{ scoring_settings: Record<string, number> }>(`/league/${leagueId}`),
    ...starts.map((y) => get<Record<string, StatLine>>(`/stats/nba/regular/${y}`)),
  ]);
  const scoring = league.scoring_settings;

  const players = await sql`select id, sleeper_id from players where sleeper_id is not null`;
  const ids: number[] = [];
  const ppgs: number[] = [];
  const gps: number[] = [];
  for (const p of players) {
    const last = seasons[0][p.sleeper_id];
    if (!last?.gp) continue;
    const played = seasons.map((s) => s[p.sleeper_id]?.gp ?? 0).filter((gp) => gp > 0);
    ids.push(p.id);
    ppgs.push(Math.round((fantasyPoints(last, scoring) / last.gp) * 10) / 10);
    gps.push(Math.round(played.reduce((a, b) => a + b, 0) / played.length));
  }

  await sql`
    update players p set ppg = s.ppg, avg_gp = s.gp
    from unnest(${ids}::int[], ${ppgs}::real[], ${gps}::real[]) as s(id, ppg, gp)
    where p.id = s.id`;

  return { updated: ids.length, season: `${lastStart}-${String(lastStart + 1).slice(2)}` };
}

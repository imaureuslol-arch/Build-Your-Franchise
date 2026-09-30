/**
 * Fantasy stats from Sleeper, scored with the league's own settings.
 *
 *   ppg     fantasy points per game in the most recent completed season he
 *           played (of the last three)
 *   avg_gp  games played, averaged over the last three seasons he played
 *
 * A player with no games in those three seasons (a rookie) takes both from
 * the season in progress once he has MIN_CURRENT_GAMES games; until then he
 * keeps whatever he had.
 *
 * Sleeper keys a season by the year it starts (2025 = 2025-26), while this
 * site keys it by the year it ends (2026 = 2025-26).
 */

import { sql } from "./db";
import { getCurrentSeasonYear } from "./types";

const API = "https://api.sleeper.app/v1";
const MIN_CURRENT_GAMES = 10;

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
  // Current season 2026-27 is 2027 here and starts in 2026 for Sleeper.
  const currentStart = getCurrentSeasonYear() - 1;
  const completedStarts = [currentStart - 1, currentStart - 2, currentStart - 3];

  const [league, current, ...completed] = await Promise.all([
    get<{ scoring_settings: Record<string, number> }>(`/league/${leagueId}`),
    get<Record<string, StatLine>>(`/stats/nba/regular/${currentStart}`).catch(() => ({}) as Record<string, StatLine>),
    ...completedStarts.map((y) => get<Record<string, StatLine>>(`/stats/nba/regular/${y}`)),
  ]);
  const scoring = league.scoring_settings;
  const perGame = (line: StatLine) => Math.round((fantasyPoints(line, scoring) / line.gp) * 10) / 10;

  const players = await sql`select id, sleeper_id from players where sleeper_id is not null`;
  const ids: number[] = [];
  const ppgs: number[] = [];
  const gps: number[] = [];
  for (const p of players) {
    const lines = completed.map((s) => s[p.sleeper_id]).filter((l): l is StatLine => !!l?.gp);
    if (lines.length > 0) {
      ids.push(p.id);
      ppgs.push(perGame(lines[0]));
      gps.push(Math.round(lines.reduce((a, l) => a + l.gp, 0) / lines.length));
      continue;
    }
    const now = current[p.sleeper_id];
    if (now?.gp >= MIN_CURRENT_GAMES) {
      ids.push(p.id);
      ppgs.push(perGame(now));
      gps.push(now.gp);
    }
  }

  await sql`
    update players p set ppg = s.ppg, avg_gp = s.gp
    from unnest(${ids}::int[], ${ppgs}::real[], ${gps}::real[]) as s(id, ppg, gp)
    where p.id = s.id`;

  const last = completedStarts[0];
  return { updated: ids.length, season: `${last}-${String(last + 1).slice(2)}` };
}

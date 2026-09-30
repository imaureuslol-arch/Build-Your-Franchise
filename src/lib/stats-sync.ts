/**
 * Fantasy stats from Sleeper, scored with the league's own settings.
 *
 *   ppg     fantasy points per game: the last two completed seasons, the
 *           latest weighted 4x the one before
 *   avg_gp  games played: the last three completed seasons, the latest
 *           weighted 2x each of the other two
 *
 * Short seasons are discounted so a few games can't swing a player's value:
 * each season's weight in the FPPG blend is multiplied by (games / 25)^2,
 * capped at 1. A 3-game season keeps ~1% of its weight, 12 games ~23%,
 * 25+ games all of it. For availability a missed season counts as 0 games
 * (that is the point of the number), but seasons before a player entered the
 * league are left out. Sleeper lists nearly every player in every season,
 * so "entered the league" comes from his years of experience (or from having
 * played that season at all).
 *
 * A player with no completed NBA season (a rookie) takes both numbers from
 * the season in progress once he has MIN_CURRENT_GAMES games, with games
 * projected to a full-season pace. A player with no data at all is set to
 * blank, unless the commissioner entered his stats by hand.
 *
 * Sleeper keys a season by the year it starts (2025 = 2025-26), while this
 * site keys it by the year it ends (2026 = 2025-26).
 */

import { sql } from "./db";
import { getCurrentSeasonYear } from "./types";

const API = "https://api.sleeper.app/v1";
const PPG_WEIGHTS = [4, 1];
const GP_WEIGHTS = [2, 1, 1];
const FULL_SAMPLE_GAMES = 25;
const MIN_CURRENT_GAMES = 10;
const SEASON_GAMES = 82;

type StatLine = Record<string, number>;
type Season = Record<string, StatLine>;

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

/** How much of its weight a season keeps, from its games played. */
export function sampleReliability(gp: number): number {
  return Math.min(1, gp / FULL_SAMPLE_GAMES) ** 2;
}

/**
 * Blend per-game fantasy points over seasons, newest first. Seasons with no
 * games are skipped. Returns null if no season has games.
 */
export function blendPpg(perGame: { fppg: number; gp: number }[]): number | null {
  let num = 0;
  let den = 0;
  perGame.slice(0, PPG_WEIGHTS.length).forEach((s, i) => {
    if (s.gp <= 0) return;
    const w = PPG_WEIGHTS[i] * sampleReliability(s.gp);
    num += w * s.fppg;
    den += w;
  });
  return den > 0 ? num / den : null;
}

/** Weighted games played over seasons he was in the league, newest first. */
export function blendGamesPlayed(gps: (number | null)[]): number | null {
  let num = 0;
  let den = 0;
  gps.slice(0, GP_WEIGHTS.length).forEach((gp, i) => {
    if (gp == null) return; // not in the league that season
    num += GP_WEIGHTS[i] * gp;
    den += GP_WEIGHTS[i];
  });
  return den > 0 ? num / den : null;
}

export async function syncStats(leagueId: string): Promise<{ updated: number; cleared: number; season: string }> {
  // Current season 2026-27 is 2027 here and starts in 2026 for Sleeper.
  const currentStart = getCurrentSeasonYear() - 1;
  const completedStarts = [currentStart - 1, currentStart - 2, currentStart - 3];

  const [league, catalogue, current, ...completed] = await Promise.all([
    get<{ scoring_settings: Record<string, number> }>(`/league/${leagueId}`),
    get<Record<string, { years_exp?: number | null }>>(`/players/nba`),
    get<Season>(`/stats/nba/regular/${currentStart}`).catch(() => ({}) as Season),
    ...completedStarts.map((y) => get<Season>(`/stats/nba/regular/${y}`)),
  ]);
  const scoring = league.scoring_settings;
  const fppg = (line: StatLine) => fantasyPoints(line, scoring) / line.gp;
  // Games teams have played so far this season, to project rookies' pace.
  const currentTeamGames = Math.max(0, ...Object.values(current).map((l) => l?.gp ?? 0));

  const players = await sql`select id, sleeper_id, stats_manual from players where sleeper_id is not null`;
  const ids: number[] = [];
  const ppgs: (number | null)[] = [];
  const gps: (number | null)[] = [];
  let cleared = 0;

  for (const p of players) {
    // Sleeper season he entered the league; a season before that is left out
    // of availability unless he somehow played in it.
    const exp = catalogue[p.sleeper_id]?.years_exp;
    const firstSeason = exp == null ? Infinity : currentStart - exp;
    const lines = completed.map((s, i) => {
      const line = s[p.sleeper_id];
      return line?.gp || completedStarts[i] >= firstSeason ? (line ?? {}) : null;
    });
    const ppg = blendPpg(
      lines.map((l) => (l?.gp ? { fppg: fppg(l), gp: l.gp } : { fppg: 0, gp: 0 }))
    );
    const gp = blendGamesPlayed(lines.map((l) => (l ? (l.gp ?? 0) : null)));

    if (ppg != null && gp != null) {
      ids.push(p.id);
      ppgs.push(Math.round(ppg * 10) / 10);
      gps.push(Math.round(gp));
      continue;
    }

    const now = current[p.sleeper_id];
    if (now?.gp >= MIN_CURRENT_GAMES && currentTeamGames > 0) {
      ids.push(p.id);
      ppgs.push(Math.round(fppg(now) * 10) / 10);
      gps.push(Math.round(Math.min(SEASON_GAMES, (now.gp / currentTeamGames) * SEASON_GAMES)));
      continue;
    }

    if (!p.stats_manual) {
      ids.push(p.id);
      ppgs.push(null);
      gps.push(null);
      cleared++;
    }
  }

  await sql`
    update players p set ppg = s.ppg, avg_gp = s.gp
    from unnest(${ids}::int[], ${ppgs}::real[], ${gps}::real[]) as s(id, ppg, gp)
    where p.id = s.id`;

  const last = completedStarts[0];
  return { updated: ids.length - cleared, cleared, season: `${last}-${String(last + 1).slice(2)}` };
}

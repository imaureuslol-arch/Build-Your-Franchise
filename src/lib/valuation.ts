/**
 * Fair value: what a player is worth over the next four seasons (the
 * contract window), in millions per season.
 *
 *  1. Starting level (FPPG): 70% Sleeper's projection for the coming season,
 *     30% our blended history, both scored with the league's settings.
 *  2. Each later season grows or shrinks by age (AGE_GROWTH).
 *  3. Each season's FPPG is turned into dollars on a curve that keeps rising
 *     (PRODUCTION), and the four seasons are averaged with later ones
 *     counting less (SEASON_WEIGHTS).
 *  4. Times availability: the games-played factor, from the commissioner's
 *     health override if set, else average games played.
 *  5. Market check: 60% that model value, 40% the model value found at the
 *     player's dynasty-ADP rank (what the market thinks, priced on our scale).
 *  6. Rescaled so the rostered players together are worth LEAGUE_VALUE_SHARE
 *     of all teams' hard caps, so changing the scoring doesn't inflate prices.
 *
 * Age-tier maximums and the league minimum are not applied here; they belong
 * to the extension asking price.
 */

import { sql } from "./db";
import { getHardCap } from "./types";

const PROJECTION_SHARE = 0.7;
const SEASON_WEIGHTS = [1, 0.85, 0.72, 0.6];
const MODEL_SHARE = 0.6;
const LEAGUE_VALUE_SHARE = 1.1;
const UNKNOWN_HEALTH_GP = 60; // rookies with no NBA games yet

/** Change in production from one season to the next, by the age he'll be. */
export function ageGrowth(age: number): number {
  if (age <= 20) return 0.08;
  if (age <= 22) return 0.06;
  if (age <= 24) return 0.04;
  if (age <= 26) return 0.02;
  if (age <= 29) return 0;
  if (age <= 31) return -0.03;
  if (age <= 33) return -0.06;
  return -0.1;
}

/** Unscaled value of one season at a given FPPG. */
function production(fppg: number): number {
  return Math.max(0, fppg - 8) ** 1.7;
}

/** Share of value kept for a given average of games played (softened 10%). */
export function availability(gp: number): number {
  const curve = 1 / (1 + Math.exp(-0.15 * (gp - 45)));
  return 1 - 0.9 * (1 - curve);
}

export interface ValuationInput {
  id: number;
  age: number;
  projectedFppg: number | null;
  historicalFppg: number | null;
  gamesPlayed: number | null;
  adpDynasty: number | null;
  rostered: boolean;
}

/** Fair values in $M per season, keyed by player id. Players with no production data are left out. */
export function valuePlayers(players: ValuationInput[], season: number, teams: number): Map<number, number> {
  const weightSum = SEASON_WEIGHTS.reduce((a, b) => a + b, 0);
  const modeled = players.flatMap((p) => {
    const { projectedFppg: pr, historicalFppg: h } = p;
    const start = pr != null && h != null ? PROJECTION_SHARE * pr + (1 - PROJECTION_SHARE) * h : (pr ?? h);
    if (start == null) return [];
    let fppg = start;
    let total = 0;
    SEASON_WEIGHTS.forEach((w, t) => {
      if (t > 0) fppg *= 1 + ageGrowth(p.age + t);
      total += w * production(fppg);
    });
    const model = (total / weightSum) * availability(p.gamesPlayed ?? UNKNOWN_HEALTH_GP);
    return [{ ...p, model }];
  });

  // The market's view: each player takes the model value at his ADP rank.
  const byModel = [...modeled].sort((a, b) => b.model - a.model);
  const byAdp = [...modeled].sort((a, b) => (a.adpDynasty ?? Infinity) - (b.adpDynasty ?? Infinity));
  const market = new Map(byAdp.map((p, i) => [p.id, byModel[i].model]));
  const blended = modeled.map((p) => ({ ...p, value: MODEL_SHARE * p.model + (1 - MODEL_SHARE) * market.get(p.id)! }));

  const rosteredTotal = blended.filter((p) => p.rostered).reduce((s, p) => s + p.value, 0);
  const target = (LEAGUE_VALUE_SHARE * teams * getHardCap(season)) / 1_000_000;
  const scale = rosteredTotal > 0 ? target / rosteredTotal : 0;
  return new Map(blended.map((p) => [p.id, Math.round(p.value * scale * 10) / 10]));
}

/**
 * Recompute and store every player's fair value. Needs the projection and
 * ADP columns filled by the stats sync; runs after it, and after a
 * commissioner edits a player's health.
 */
export async function refreshFairValues(season: number): Promise<number> {
  const [rows, [{ teams }]] = await Promise.all([
    sql`select id, team_id, ppg, proj_fppg, adp_dynasty,
               coalesce(gp_override, avg_gp) as gp,
               date_part('year', age(birthdate))::int as age
        from players where birthdate is not null`,
    sql`select count(*)::int as teams from teams`,
  ]);
  const values = valuePlayers(
    rows.map((r) => ({
      id: r.id,
      age: r.age,
      projectedFppg: r.proj_fppg,
      historicalFppg: r.ppg,
      gamesPlayed: r.gp,
      adpDynasty: r.adp_dynasty,
      rostered: r.team_id != null,
    })),
    season,
    teams
  );
  const ids = [...values.keys()];
  await sql.transaction([
    sql`update players set fair_value = null where fair_value is not null`,
    sql`update players p set fair_value = v.fv
        from unnest(${ids}::int[], ${ids.map((i) => values.get(i)!)}::real[]) as v(id, fv)
        where p.id = v.id`,
  ]);
  return ids.length;
}


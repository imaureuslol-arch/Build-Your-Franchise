/**
 * What a draft pick is worth, in the same $M-per-season fair value as a
 * player.
 *
 * 1. Slot curve, from history. Every NBA draft 2014-2022: each pick's first
 *    four seasons (the rookie deal), scored with this league's settings and
 *    priced on the fair-value scale. Busts and stashes count as $0. Fitted to
 *    V(slot) = A e^(-k (slot-1)): #1 $27.5M, #3 $23M, #8 $14.6M, #16 $7.1M,
 *    #24 $3.5M, 2nd round $2M down to ~$0. (Rebuilt by
 *    scripts/pick-slot-history.mts.)
 * 2. Projected slot. Teams are ordered by current power rating, weakest
 *    first (no lottery); round 2 continues at slot teams+1.
 * 3. Uncertainty. The nearer draft leans on its projected slot; later ones
 *    regress toward the round's average slot value (CERTAINTY).
 * 4. Time. 10% off per year until the pick is made.
 *
 * Salary for the trade meter is the league's rookie scale at the projected
 * slot.
 */

import { decodePickId, type Player } from "./types";

export const HISTORICAL_CURVE = { A: 27.5, k: 0.09 };
/** Weight on the projected slot, by drafts from now (0 = next draft). */
const CERTAINTY = [0.7, 0.4, 0.2];
const YEARLY_DISCOUNT = 0.9;
/** Rookie scale by overall pick ($M), from the league sheet; 2nd round $2M. */
const ROOKIE_SCALE = [16, 15, 14, 13, 12, 12, 11, 11, 10, 10, 9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3];
const SECOND_ROUND_SCALE = 2;

export function rookieScale(slot: number): number {
  return (ROOKIE_SCALE[slot - 1] ?? SECOND_ROUND_SCALE) * 1_000_000;
}

/** Fit A·e^(-k(slot-1)) to (slot, value) points by least squares over a grid. */
export function fitCurve(points: [number, number][]): { A: number; k: number } {
  let best = { ...HISTORICAL_CURVE, err: Infinity };
  for (let A = 5; A <= 120; A += 0.5) {
    for (let k = 0.02; k <= 0.5; k += 0.005) {
      let err = 0;
      for (const [n, v] of points) err += (A * Math.exp(-k * (n - 1)) - v) ** 2;
      if (err < best.err) best = { A, k, err };
    }
  }
  return { A: best.A, k: best.k };
}

export interface PickValue {
  /** Fair value, $M per season. */
  fairValue: number;
  /** Rookie-scale salary at the projected slot, dollars. */
  salary: number;
  /** Projected overall slot. */
  slot: number;
}

/**
 * Value every pick. `power` is the team power rating by name; `teamIds` maps
 * team id to name (pick ids carry the original team's id).
 */
export function valuePicks(
  picks: Player[],
  power: Record<string, number>,
  teamIds: Map<number, string>,
  nextDraft: number,
  curve: { A: number; k: number } = HISTORICAL_CURVE
): Record<number, PickValue> {
  const teams = Object.keys(power).length || 1;
  const V = (slot: number) => curve.A * Math.exp(-curve.k * (slot - 1));
  // Weakest team picks first.
  const order = Object.entries(power).sort((a, b) => a[1] - b[1]).map(([name]) => name);
  const out: Record<number, PickValue> = {};
  for (const p of picks) {
    const { season, round, originalTeamId } = decodePickId(p.id);
    const rank = order.indexOf(teamIds.get(originalTeamId) ?? "") + 1 || Math.ceil(teams / 2);
    const slot = (round - 1) * teams + rank;
    const roundSlots = Array.from({ length: teams }, (_, i) => (round - 1) * teams + i + 1);
    const roundAverage = roundSlots.reduce((s, n) => s + V(n), 0) / teams;
    const ahead = Math.max(0, season - nextDraft);
    const certainty = CERTAINTY[Math.min(ahead, CERTAINTY.length - 1)];
    const value = (certainty * V(slot) + (1 - certainty) * roundAverage) * YEARLY_DISCOUNT ** ahead;
    out[p.id] = { fairValue: Math.round(value * 10) / 10, salary: rookieScale(slot), slot };
  }
  return out;
}

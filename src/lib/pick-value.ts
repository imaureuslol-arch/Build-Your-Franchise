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
 * 2. Projected slot. Teams are ordered by power projected for THAT draft
 *    year, including development, aging and retirement risk, weakest first
 *    (no lottery); round 2 continues at slot teams+1.
 * 3. Uncertainty. The nearer draft leans on its projected slot; later ones
 *    regress toward the round's average slot value (CERTAINTY).
 * 4. Time. 20% off per year beyond the next draft. A worsening team's better
 *    projected slot can outweigh this discount; it is not a price ceiling.
 *
 * Salary for the trade meter is the league's rookie scale at the projected
 * slot.
 */

import { decodePickId, type Player } from "./types";

export const HISTORICAL_CURVE = { A: 27.5, k: 0.09 };
/** Weight on the projected slot, by drafts from now (0 = next draft). */
const CERTAINTY = [0.7, 0.4, 0.2];
export const YEARLY_DISCOUNT = 0.8;
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
  /** Original team's forecast PWR in the pick's year, 1-100. */
  power: number | null;
  /** Original team's PWR and slot in the next draft, for comparison. */
  currentPower: number | null;
  currentSlot: number;
  yearsAway: number;
  /** Share kept after the distance discount (1, .8, .64, ...). */
  discount: number;
  /** Weight on the projected slot; the rest uses the round's average value. */
  certainty: number;
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
  curve: { A: number; k: number } = HISTORICAL_CURVE,
  projectedPower: Record<number, Record<string, number>> = {},
): Record<number, PickValue> {
  const teams = Object.keys(power).length || 1;
  const V = (slot: number) => curve.A * Math.exp(-curve.k * (slot - 1));
  // Weakest team picks first.
  const ordered = (ratings: Record<string, number>) => Object.keys(power)
    .sort((a, b) => (ratings[a] ?? power[a]) - (ratings[b] ?? power[b]) || a.localeCompare(b));
  const order = ordered(power);
  const out: Record<number, PickValue> = {};
  for (const p of picks) {
    const { season, round, originalTeamId } = decodePickId(p.id);
    const originalTeam = teamIds.get(originalTeamId) ?? "";
    const ratings = projectedPower[season] ?? power;
    const futureOrder = ordered(ratings);
    const rank = futureOrder.indexOf(originalTeam) + 1 || Math.ceil(teams / 2);
    const slot = (round - 1) * teams + rank;
    const roundSlots = Array.from({ length: teams }, (_, i) => (round - 1) * teams + i + 1);
    const roundAverage = roundSlots.reduce((s, n) => s + V(n), 0) / teams;
    const ahead = Math.max(0, season - nextDraft);
    const certainty = CERTAINTY[Math.min(ahead, CERTAINTY.length - 1)] * .65 ** Math.max(0, ahead - 2);
    const discount = YEARLY_DISCOUNT ** ahead;
    const value = (certainty * V(slot) + (1 - certainty) * roundAverage) * discount;
    const currentRank = order.indexOf(originalTeam) + 1 || Math.ceil(teams / 2);
    out[p.id] = {
      fairValue: Math.round(value * 10) / 10, salary: rookieScale(slot), slot,
      power: ratings[originalTeam] ?? power[originalTeam] ?? null,
      currentPower: power[originalTeam] ?? null, currentSlot: (round - 1) * teams + currentRank,
      yearsAway: ahead, discount, certainty,
    };
  }
  return out;
}

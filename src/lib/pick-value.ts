/**
 * What a draft pick is worth, in the same $M-per-season fair value as a
 * player.
 *
 * 1. Slot curve. Every completed draft in this league is looked up: who went
 *    at each slot and what that player's fair value is today. A smooth curve
 *    V(slot) = A * e^(-k (slot - 1)) is fitted through them (2026 alone:
 *    A ≈ 55, k ≈ 0.13 -> #1 $55M, #8 $22M, #24 $3M, 2nd round ~$0-1M). It
 *    refits as more drafts happen.
 * 2. Projected slot. Teams are ordered by current power rating, weakest
 *    first (no lottery); round 2 continues at slot teams+1.
 * 3. Uncertainty. The nearer draft leans on its projected slot; later ones
 *    regress toward the round's average slot value (CERTAINTY).
 * 4. Time. 10% off per year until the pick is made.
 *
 * Salary for the trade meter is the league's rookie scale at the projected
 * slot.
 */

import { sql } from "./db";
import { decodePickId, type Player } from "./types";

const API = "https://api.sleeper.app/v1";
const DEFAULT_CURVE = { A: 55, k: 0.13 };
/** Weight on the projected slot, by drafts from now (0 = next draft). */
const CERTAINTY = [0.7, 0.4, 0.2];
const YEARLY_DISCOUNT = 0.9;
/** Rookie scale by overall pick ($M), from the league sheet; 2nd round $2M. */
const ROOKIE_SCALE = [16, 15, 14, 13, 12, 12, 11, 11, 10, 10, 9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3];
const SECOND_ROUND_SCALE = 2;

export function rookieScale(slot: number): number {
  return (ROOKIE_SCALE[slot - 1] ?? SECOND_ROUND_SCALE) * 1_000_000;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`Sleeper ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

/** Fit A·e^(-k(slot-1)) to (slot, value) points by least squares over a grid. */
export function fitCurve(points: [number, number][]): { A: number; k: number } {
  if (points.length < 10) return DEFAULT_CURVE;
  let best = { ...DEFAULT_CURVE, err: Infinity };
  for (let A = 10; A <= 120; A += 0.5) {
    for (let k = 0.02; k <= 0.5; k += 0.005) {
      let err = 0;
      for (const [n, v] of points) err += (A * Math.exp(-k * (n - 1)) - v) ** 2;
      if (err < best.err) best = { A, k, err };
    }
  }
  return { A: best.A, k: best.k };
}

/** The slot curve from this league's completed drafts. */
export async function slotCurve(leagueId: string): Promise<{ A: number; k: number }> {
  try {
    const drafts = await get<{ draft_id: string; status: string }[]>(`/league/${leagueId}/drafts`);
    const done = drafts.filter((d) => d.status === "complete");
    const picks = (await Promise.all(done.map((d) => get<{ pick_no: number; player_id: string }[]>(`/draft/${d.draft_id}/picks`)))).flat();
    if (picks.length === 0) return DEFAULT_CURVE;
    const rows = await sql`select sleeper_id, fair_value from players where sleeper_id = any(${picks.map((p) => p.player_id)})`;
    const fv = new Map(rows.map((r) => [r.sleeper_id as string, (r.fair_value as number | null) ?? 0]));
    // A drafted player with no value yet (unsigned, overseas) counts as 0: that's what the pick produced.
    return fitCurve(picks.map((p) => [p.pick_no, fv.get(p.player_id) ?? 0]));
  } catch {
    return DEFAULT_CURVE;
  }
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
  curve: { A: number; k: number },
  nextDraft: number
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

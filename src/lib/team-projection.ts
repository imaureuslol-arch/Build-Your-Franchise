import { ageGrowth } from "./aging";

export const STARTERS = 8;
export const DEPTH = 2;
export interface RosterProjection { team: string; fppg: number; age: number | null }

/** Scale relative strength within that year's league: best 100, worst 1. */
export function toRating(scores: Map<string, number>): Map<string, number> {
  if (!scores.size) return new Map();
  const values = [...scores.values()];
  const lo = Math.min(...values), hi = Math.max(...values);
  return new Map([...scores].map(([team, score]) => [team, hi > lo ? 1 + 99 * (score - lo) / (hi - lo) : 50]));
}

/**
 * Annual share expected to remain active at the age reached next season.
 * Planning assumptions, NOT fitted retirement probabilities or an assertion
 * that any particular player will retire. Condition on being active now.
 * Increasing retirement risk is separate from declining on-court production.
 */
export function activeShare(age: number): number {
  if (age <= 32) return 1;
  if (age <= 34) return .98;
  const shares = [.95, .92, .88, .82, .75, .65, .55, .45, .35, .25];
  return shares[age - 35] ?? .15;
}

export function projectFppg(player: RosterProjection, ahead: number): number {
  let expected = Math.max(0, player.fppg);
  if (player.age === null) return expected; // Unknown age never means a made-up young player.
  for (let year = 1; year <= ahead; year++) {
    const age = player.age + year;
    expected *= (1 + ageGrowth(age)) * activeShare(age);
  }
  return expected;
}

/**
 * Forecast the CURRENT roster for each draft year, re-ranking its best eight
 * players and two half-weight depth players after development/aging/retirement.
 * No invented future signings, trades or draft prospects. Contracts ending
 * do not automatically remove players: keeping/re-signing them is unknown.
 * Current PWR keeps its existing blend of standings and Sleeper projections;
 * later years use age-adjusted Sleeper production because future standings
 * do not exist. Pick valuation separately regresses uncertain slots to average.
 */
export function futureTeamPower(
  players: RosterProjection[], currentPower: Record<string, number>, nextDraft: number, seasons: number[],
): Record<number, Record<string, number>> {
  const teams = Object.keys(currentPower);
  const rosters = new Map(teams.map((team) => [team, players.filter((p) => p.team === team)]));
  const forecasts: Record<number, Record<string, number>> = {};
  for (const season of new Set(seasons)) {
    const ahead = Math.max(0, season - nextDraft);
    if (ahead === 0) { forecasts[season] = { ...currentPower }; continue; }
    const scores = new Map(teams.map((team) => {
      const ranked = rosters.get(team)!.map((p) => projectFppg(p, ahead)).sort((a, b) => b - a).slice(0, STARTERS + DEPTH);
      return [team, ranked.reduce((sum, f, i) => sum + f * (i < STARTERS ? 1 : .5), 0)];
    }));
    forecasts[season] = Object.fromEntries([...toRating(scores)].map(([team, power]) => [team, Math.round(power)]));
  }
  return forecasts;
}

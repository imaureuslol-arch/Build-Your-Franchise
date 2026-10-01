/**
 * Extension negotiation rules. The server runs them (src/app/api/extensions/
 * negotiate) so an owner can't skip the negotiation or reset it by
 * reloading; the page only shows what the server answers.
 */

import { getFairValueForYear, getVetMin } from "./types";
import { dialogueLine, finalDemandLine, type ExtensionTier } from "./extension-dialogue";

export const MAX_OFFERS = 3;
export const YOUNG_MAX_SALARY = 60_000_000; // 23 and under
export const MAX_SALARY = 80_000_000;
export const MAX_YEAR_TO_YEAR_CHANGE = 0.1;
const INSULT_RATIO = 0.4;

export function maxSalaryForAge(age: number): number {
  return age <= 23 ? YOUNG_MAX_SALARY : MAX_SALARY;
}

export interface Ask {
  /** What the player wants each season, in dollars. */
  perYear: Record<number, number>;
  /** Average of perYear. */
  average: number;
  /** Every offered season reaches his age-tier max. */
  snapped: boolean;
  max: number;
}

/** Negotiation target: seasonal fair value, with the league's salary bounds. */
export function fairValuePrice(fairValueMillions: number | null, age: number, years: number[]): Ask {
  const max = maxSalaryForAge(age);
  const fv = Math.max(0, fairValueMillions ?? 0);
  const perYear: Record<number, number> = {};
  for (const y of years) {
    const grown = getFairValueForYear(fv, y) * 1_000_000;
    perYear[y] = Math.round(Math.min(max, Math.max(getVetMin(y), grown)));
  }
  const average = years.reduce((s, y) => s + perYear[y], 0) / Math.max(1, years.length);
  return { perYear, average, max, snapped: years.length > 0 && years.every((y) => perYear[y] === max) };
}

/**
 * The player's asking price for the given seasons: fair value grown 5% a
 * season, then increased by 30% or $5M, whichever is higher. Never above
 * his age-tier max and never below that season's vet minimum.
 */
export function askingPrice(fairValueMillions: number | null, age: number, years: number[]): Ask {
  const max = maxSalaryForAge(age);
  const fv = Math.max(0, fairValueMillions ?? 0);
  const perYear: Record<number, number> = {};
  for (const y of years) {
    const grown = getFairValueForYear(fv, y) * 1_000_000;
    const wanted = Math.max(grown * 1.3, grown + 5_000_000);
    perYear[y] = Math.round(Math.min(max, Math.max(getVetMin(y), wanted)));
  }
  const average = years.reduce((s, y) => s + perYear[y], 0) / Math.max(1, years.length);
  const snapped = years.length > 0 && years.every((y) => perYear[y] === max);
  return { perYear, average, snapped, max };
}

/** Problems with an offer's shape, or null if it's well-formed. */
export function offerProblem(years: number[], amounts: Record<number, number>, allowed: number[]): string | null {
  if (years.length === 0) return "Pick at least one season.";
  const sorted = [...years].sort((a, b) => a - b);
  if (sorted.some((y, i) => y !== allowed[i])) {
    return "Seasons must be consecutive, starting with the first season after his current deal.";
  }
  for (const y of sorted) {
    const a = amounts[y];
    if (!Number.isSafeInteger(a) || a < 0) return "Enter a whole-dollar amount for every season.";
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = amounts[sorted[i - 1]];
    if (Math.abs(amounts[sorted[i]] - prev) > prev * MAX_YEAR_TO_YEAR_CHANGE) {
      return `Salary variance too high: ${sorted[i]} must be within 10% of ${sorted[i - 1]}.`;
    }
  }
  return null;
}

export function isInsulting(ratio: number): boolean {
  return ratio < INSULT_RATIO;
}

/** The player's reply to an offer worth `ratio` of his seasonal fair value. */
export function respond(ratio: number, offersUsed: number, snapped: boolean, tier: ExtensionTier = snapped ? "max" : "star", seed = 0): { accepted: boolean; reply: string } {
  const remaining = Math.max(0, MAX_OFFERS - offersUsed);
  const left = remaining === 1 ? "This is your last chance." : `${remaining} offers remaining`;

  const acceptAt = 0.95;
  if (!snapped && ratio >= 1.3) return { accepted: true, reply: dialogueLine(tier, "overpaid", seed) };
  if (ratio >= acceptAt) {
    return {
      accepted: true,
      reply: dialogueLine(tier, "accepted", seed),
    };
  }
  const kind = ratio >= 0.8 ? "close" : ratio >= INSULT_RATIO ? "low" : "insult";
  const text = dialogueLine(tier, kind, seed);
  return { accepted: false, reply: `${text} (${left})` };
}

/** Flat per-season demand once the offers run out. */
export function ultimatum(ask: Ask, bestRatio: number, seasons: number, tier: ExtensionTier = ask.snapped ? "max" : "star", seed = 0) {
  const close = bestRatio >= 0.8;
  const amount = Math.round(Math.min(ask.average * (close ? 1.1 : 1.5), ask.max));
  const reply = finalDemandLine(tier, amount, seasons, seed);
  return { amount, reply };
}

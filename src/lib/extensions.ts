/**
 * Extension negotiation rules. The server runs them (src/app/api/extensions/
 * negotiate) so an owner can't skip the negotiation or reset it by
 * reloading; the page only shows what the server answers.
 */

import { formatSalary, getFairValueForYear, getVetMin } from "./types";

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
  /** Average of perYear: offers are judged against this. */
  average: number;
  /** His value is above his age-tier max, so he demands exactly the max. */
  snapped: boolean;
  max: number;
}

/**
 * The player's asking price for the given seasons: fair value grown 5% a
 * season, never above his age-tier max and never below that season's vet
 * minimum.
 */
export function askingPrice(fairValueMillions: number | null, age: number, years: number[]): Ask {
  const max = maxSalaryForAge(age);
  const fv = Math.max(0, fairValueMillions ?? 0);
  const snapped = fv * 1_000_000 > max;
  const perYear: Record<number, number> = {};
  for (const y of years) {
    const grown = getFairValueForYear(Math.min(fv, max / 1_000_000), y) * 1_000_000;
    perYear[y] = Math.round(Math.min(max, Math.max(getVetMin(y), grown)));
  }
  const average = years.reduce((s, y) => s + perYear[y], 0) / Math.max(1, years.length);
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

/** The player's reply to an offer worth `ratio` of his ask. */
export function respond(ratio: number, offersUsed: number, snapped: boolean): { accepted: boolean; reply: string } {
  const remaining = Math.max(0, MAX_OFFERS - offersUsed);
  const left = remaining === 1 ? "This is your last chance." : `${remaining} offers remaining`;

  // Snapped players demand exactly the max; 0.999 absorbs rounding across seasons.
  const acceptAt = snapped ? 0.999 : 0.95;
  if (!snapped && ratio >= 1.3) return { accepted: true, reply: "YOU SERIOUS?! Hell yeah! You got a deal!" };
  if (ratio >= acceptAt) {
    return {
      accepted: true,
      reply: snapped
        ? "I appreciate you putting your faith in me. You're not gonna regret it."
        : "Alright, that's a fair deal. Let's do it.",
    };
  }
  if (snapped) {
    return { accepted: false, reply: `You're not actually trying to negotiate right? Put down the max and let's get to work. (${left})` };
  }
  const bands: [number, string][] = [
    [0.9, "This is pretty fair. Give me a small bump and you've got a deal."],
    [0.85, "I love the city, but business is business. I’m gonna need a little more."],
    [0.8, "This is a bit too low, but we're close."],
    [0.7, "I like playing here but I'm gonna need more."],
    [0.6, "This is a low-ball offer, I know what I'm worth."],
    [0.5, "You're crazy man. Let me tell you, this is disrespectful."],
    [0.45, "Try again with a real offer. Or don't, I'll go somewhere I'm respected."],
    [0.4, "Is this a joke? I feel like I'm being pranked right now. Check the stats and try again."],
  ];
  const text =
    bands.find(([min]) => ratio >= min)?.[1] ??
    "Is this a joke? Man, stop wasting my time or I'll walk out of here RIGHT NOW.";
  return { accepted: false, reply: `${text} (${left})` };
}

/** Flat per-season demand once the offers run out. */
export function ultimatum(ask: Ask, bestRatio: number, lastWasInsulting: boolean, seasons: number) {
  const close = bestRatio >= 0.8;
  const amount = Math.round(Math.min(ask.average * (close ? 1.1 : 1.5), ask.max));
  const label = seasons === 1 ? "year" : "years";
  const reply = lastWasInsulting
    ? `That offer is a slap in the face. You're wasting my time. My final demand is ${formatSalary(amount)} per year for ${seasons} ${label}. Take it or I'm hitting the market.`
    : close
      ? `Look, your last offer was close, and I'd like to stay here. Give me ${formatSalary(amount)} per year for ${seasons} ${label} and I'll sign right now.`
      : `Alright. I'm done playing games. Pay me what I'm worth or I'm leaving. My final demand is ${formatSalary(amount)} per year for ${seasons} ${label}.`;
  return { amount, reply };
}

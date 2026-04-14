/**
 * Shared fair-value math. Both /api/player-values and /api/player-stats
 * call into this so the formula can only live in one place.
 *
 * Age-tier salary caps (60M ≤23, 80M otherwise) are NOT applied here —
 * they belong to the extensions negotiation UI, not the raw value.
 */
export function calcFairValue(
  age: number,
  ppg: number,
  avgGamesPlayed: number
): number {
  const ppgTerm =
    1 +
    54 / (1 + Math.exp(-0.3 * (ppg - 19.3))) +
    3 * Math.exp(-((ppg - 13.5) ** 2) / (2 * 16));

  const ppgFactor =
    (1 + 0.1484058 * ((ppg / 40) ** 2 - 0.19140625)) *
    (0.2 + 0.8 * (1 - Math.exp(-0.15 * ppg))) *
    1.061616;

  const gamesFactor = 1 / (1 + Math.exp(-0.15 * (avgGamesPlayed - 45)));

  const ageBase =
    1 +
    0.8 / (1 + Math.exp(0.25 * (age - 27))) +
    0.05 * Math.exp(-0.12 * (age - 35));
  const ageFactor = ageBase ** 1.1;

  const ageDecline = age > 31 ? 0.9 ** (age - 31) : 1;

  const bonusTerm = 1 + 0.25 / (0.4 + Math.exp(-1 * (ppg - 30)));

  return (
    ppgTerm * ppgFactor * gamesFactor * ageFactor * ageDecline * bonusTerm * 0.6
  );
}

/** Age in whole years from an ISO date string (YYYY-MM-DD). */
export function ageFromBirthdate(birthdate: string): number | null {
  const dob = new Date(birthdate);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

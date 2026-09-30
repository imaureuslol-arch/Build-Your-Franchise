/**
 * Shared fair-value math. Both /api/player-values and /api/player-stats
 * call into this so the formula can only live in one place.
 *
 * Age-tier salary caps (60M ≤23, 80M otherwise) and the league minimum are
 * NOT applied here — they belong to the extension asking price.
 */

// Softening applied 2026-09-30: the star bonus and the games-played penalty
// are each 10% smaller than the original curve.
const STAR_BONUS_SCALE = 0.9;
const GAMES_PENALTY_SCALE = 0.9;

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

  const gamesCurve = 1 / (1 + Math.exp(-0.15 * (avgGamesPlayed - 45)));
  // Keep the curve's shape but take 10% off how much it can cost a player.
  const gamesFactor = 1 - GAMES_PENALTY_SCALE * (1 - gamesCurve);

  const ageBase =
    1 +
    0.8 / (1 + Math.exp(0.25 * (age - 27))) +
    0.05 * Math.exp(-0.12 * (age - 35));
  const ageFactor = ageBase ** 1.1;

  const ageDecline = age > 31 ? 0.9 ** (age - 31) : 1;

  const bonusTerm = 1 + (STAR_BONUS_SCALE * 0.25) / (0.4 + Math.exp(-1 * (ppg - 30)));

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

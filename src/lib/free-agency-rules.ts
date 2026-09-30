export const MIN_OFFER_PER_YEAR = 4_000_000;
/** Existing ranking: discount later years by 25%, round to $1M. */
export function getWeightedValue(offer: { years: number[]; amounts: Record<string, number> }): number {
  const value = [...offer.years].sort((a, b) => a - b).reduce(
    (sum, year, index) => sum + Number(offer.amounts[year] ?? 0) / 1.25 ** index, 0
  );
  return Math.round(value / 1_000_000) * 1_000_000;
}
export interface FreeAgencyRound { id: number; closes_at: string | null }
export interface FreeAgencyAward {
  round_id: number; player_id: number; offer_id: string | null; team_id: number | null;
  player_name: string; team_name: string | null; years: number[];
  amounts: Record<string, number>; note: string | null; awarded_at: string;
}
export function countdown(deadline: string, now: number): string {
  const seconds = Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
  const d = Math.floor(seconds / 86400), h = Math.floor(seconds % 86400 / 3600);
  const m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
  return d + 'd ' + String(h).padStart(2, '0') + 'h ' + String(m).padStart(2, '0') + 'm ' + String(s).padStart(2, '0') + 's';
}

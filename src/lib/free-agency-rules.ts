import { getVetMin } from "./types";

/** Smallest bid for a season: that season's veteran minimum. */
export function minOffer(season: number): number {
  return getVetMin(season);
}
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

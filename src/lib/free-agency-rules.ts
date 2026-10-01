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
export interface PlayerAuction {
  round_id: number; player_id: number; first_bid_at: string; accepts_at: string;
  fair_value: number; rfa_owner_key: string | null; rfa_team_name: string | null;
  matched_offer_id: string | null; matched_team_id: number | null; matched_team_name: string | null;
  matched_at: string | null;
}
/** Underbid gap exceeds both the bid itself and $10M. All inputs are dollars. */
export function isSevereUnderbid(weightedBid: number, fairValue: number): boolean {
  return fairValue - weightedBid > Math.max(weightedBid, 10_000_000);
}
export function acceptanceDays(weightedBid: number, fairValue: number): number {
  const premium = Math.max(2 * fairValue, fairValue + 10_000_000);
  if (fairValue <= 0 || weightedBid >= premium) return 3;
  if (weightedBid <= fairValue * 0.5) return 30;
  if (weightedBid < fairValue * 0.8) return 30 - 16 * (weightedBid / fairValue - 0.5) / 0.3;
  return 14 - 11 * (weightedBid - fairValue * 0.8) / (premium - fairValue * 0.8);
}
export interface FreeAgencyAward {
  round_id: number; player_id: number; offer_id: string | null; team_id: number | null;
  player_name: string; team_name: string | null; years: number[];
  amounts: Record<string, number>; note: string | null; awarded_at: string;
}

"use client";

export const dynamic = "force-dynamic";

import { useMemo, useState, useEffect, useCallback } from "react";
import { usePlayers, useTeamOwners } from "@/lib/hooks";
import { useUserTeam } from "@/lib/user-context";
import { getSupabase } from "@/lib/supabase";
import {
  Player,
  FREE_AGENCY_TEAM,
  formatSalary,
  getHardCap,
  SALARY_YEARS,
  getCurrentSeasonYear,
  getCurrentSalary,
} from "@/lib/types";

const MIN_OFFER_PER_YEAR = 4_000_000;
const MAX_VARIANCE = 0.10; // 10%

interface FAOffer {
  id: string;
  playerId: string;
  playerName: string;
  userName: string;
  teamName: string;
  years: number[];
  amounts: { [year: number]: number };
  totalValue: number;
  timestamp: number;
}

interface FAOfferRow {
  id: string;
  player_id: string;
  player_name: string;
  user_name: string;
  team_name: string;
  years: number[];
  amounts: Record<string, number>;
  total_value: number;
  created_at: string;
}

function rowToOffer(row: FAOfferRow): FAOffer {
  const amounts: { [year: number]: number } = {};
  for (const [k, v] of Object.entries(row.amounts)) {
    amounts[Number(k)] = Number(v);
  }
  return {
    id: row.id,
    playerId: row.player_id,
    playerName: row.player_name,
    userName: row.user_name,
    teamName: row.team_name,
    years: row.years,
    amounts,
    totalValue: Number(row.total_value),
    timestamp: new Date(row.created_at).getTime(),
  };
}

export default function FreeAgencyPage() {
  const { players, loading: pLoading } = usePlayers();
  const { owners, loading: oLoading } = useTeamOwners();
  const { owner: myOwner, isLoading: teamLoading } = useUserTeam();
  const loading = pLoading || oLoading || teamLoading;

  const [searchQuery, setSearchQuery] = useState("");
  // selectedUser is derived from the IP-locked identity — not freely choosable
  const selectedUser = myOwner?.user_name ?? "";
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [offerYears, setOfferYears] = useState<number[]>([]);
  const [yearAmounts, setYearAmounts] = useState<{ [year: number]: number }>({});
  const [showCopyPopup, setShowCopyPopup] = useState(false);
  const [copiedOffer, setCopiedOffer] = useState<FAOffer | null>(null);
  const [offerHistory, setOfferHistory] = useState<FAOffer[]>([]);
  const [offersLoading, setOffersLoading] = useState(true);
  const [viewingPlayerId, setViewingPlayerId] = useState<string | null>(null);

  // --- Password Protection State ---
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [playerToClear, setPlayerToClear] = useState<string | null>(null);
  const ADMIN_PASSWORD = "stoplookinginthefilesasshole"; // Change your password here

  const refreshOffers = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from("free_agent_offers")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Failed to load free-agent offers:", error);
      setOffersLoading(false);
      return;
    }
    setOfferHistory((data as FAOfferRow[]).map(rowToOffer));
    setOffersLoading(false);
  }, []);

  useEffect(() => {
    refreshOffers();

    // Realtime: refresh the list whenever any user inserts or deletes an offer
    const channel = getSupabase()
      .channel("free_agent_offers_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "free_agent_offers" },
        () => {
          refreshOffers();
        }
      )
      .subscribe();

    return () => {
      getSupabase().removeChannel(channel);
    };
  }, [refreshOffers]);

  const myTeamCap = useMemo(() => {
    if (!myOwner) return 0;
    return players
      .filter((p) => p.team === myOwner.team_name)
      .reduce((sum, p) => sum + (getCurrentSalary(p) ?? 0), 0);
  }, [players, myOwner]);

  const isOverHardCap = myTeamCap > getHardCap();

  const freeAgents = useMemo(
    () => players
      .filter((p) => p.team === FREE_AGENCY_TEAM && p.name !== "Dead Cap")
      .sort((a, b) => (b.ppg ?? -1) - (a.ppg ?? -1)),
    [players]
  );

  const userList = useMemo(() => {
    return Array.from(owners.values())
      .map((o) => ({ userName: o.user_name, teamName: o.team_name }))
      .sort((a, b) => a.userName.localeCompare(b.userName));
  }, [owners]);

  const filteredFreeAgents = searchQuery
    ? freeAgents.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : freeAgents;

  const availableYears = (SALARY_YEARS as readonly number[]).filter((y) => y >= getCurrentSeasonYear());

  const offersByPlayer = useMemo(() => {
    const map = new Map<string, FAOffer[]>();
    for (const offer of offerHistory) {
      if (!map.has(offer.playerId)) map.set(offer.playerId, []);
      map.get(offer.playerId)!.push(offer);
    }
    for (const [, offers] of map) {
      offers.sort((a, b) => b.totalValue - a.totalValue);
    }
    return map;
  }, [offerHistory]);

  const playerIdsWithOffers = useMemo(() => {
    return [...offersByPlayer.keys()];
  }, [offersByPlayer]);

  function selectPlayer(player: Player) {
    setSelectedPlayer(player);
    setOfferYears([]);
    setYearAmounts(Object.fromEntries(availableYears.map((y) => [y, 10_000_000])));
  }

  function toggleYear(year: number) {
    setOfferYears((prev) => {
      const isSelected = prev.includes(year);
      if (isSelected) {
        return prev.filter((y) => y < year);
      } else {
        const idx = availableYears.indexOf(year);
        if (idx > 0 && !prev.includes(availableYears[idx - 1])) return prev;
        return [...prev, year].sort((a, b) => a - b);
      }
    });
  }

  function getOfferErrors(): string[] {
    const errors: string[] = [];
    if (!selectedUser) errors.push("Select your name");
    if (!selectedPlayer) errors.push("Select a player");
    if (offerYears.length === 0) errors.push("Select at least one year");

    const sorted = [...offerYears].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      const yr = sorted[i];
      const amt = yearAmounts[yr];

      if (amt < MIN_OFFER_PER_YEAR) {
        errors.push(`${yr} must be at least ${formatSalary(MIN_OFFER_PER_YEAR)}`);
      }

      if (i > 0) {
        const prevAmt = yearAmounts[sorted[i - 1]];
        const diff = Math.abs(amt - prevAmt);
        if (diff > prevAmt * MAX_VARIANCE) {
          errors.push(`${yr} salary must be within 10% of ${sorted[i - 1]}`);
        }
      }
    }
    return errors;
  }

  async function handleSubmit() {
    const currentErrors = getOfferErrors();
    if (currentErrors.length > 0 || !selectedPlayer) return;

    const ownerEntry = userList.find((u) => u.userName === selectedUser);
    const amounts: { [year: number]: number } = {};
    for (const y of offerYears) amounts[y] = isOverHardCap ? MIN_OFFER_PER_YEAR : yearAmounts[y];
    const totalValue = offerYears.reduce((s, y) => s + amounts[y], 0);

    const { data, error } = await getSupabase()
      .from("free_agent_offers")
      .insert({
        player_id: String(selectedPlayer.id),
        player_name: selectedPlayer.name,
        user_name: selectedUser,
        team_name: ownerEntry?.teamName || "",
        years: [...offerYears],
        amounts,
        total_value: totalValue,
      })
      .select()
      .single();

    if (error || !data) {
      console.error("Failed to submit offer:", error);
      alert("Failed to submit offer. Please try again.");
      return;
    }

    const offer = rowToOffer(data as FAOfferRow);
    // Optimistic update; realtime subscription will also fire
    setOfferHistory((prev) =>
      prev.some((o) => o.id === offer.id) ? prev : [offer, ...prev]
    );
    setCopiedOffer(offer);
    setShowCopyPopup(true);

    setOfferYears([]);
    setSelectedPlayer(null);
  }

  // --- Password Logic ---
  function handleRequestClear(playerId: string) {
    setPlayerToClear(playerId);
    setShowPasswordModal(true);
  }

  async function handleConfirmClear() {
    if (passwordInput !== ADMIN_PASSWORD || !playerToClear) {
      alert("Incorrect Password");
      return;
    }

    const { error } = await getSupabase()
      .from("free_agent_offers")
      .delete()
      .eq("player_id", playerToClear);

    if (error) {
      console.error("Failed to clear offers:", error);
      alert("Failed to clear offers. Please try again.");
      return;
    }

    setOfferHistory((prev) => prev.filter((o) => o.playerId !== playerToClear));
    if (viewingPlayerId === playerToClear) setViewingPlayerId(null);
    setShowPasswordModal(false);
    setPasswordInput("");
    setPlayerToClear(null);
  }

  function getOfferCopyText(offer: FAOffer): string {
    const yearDetails = offer.years.sort().map((y) => `  ${y}: ${formatSalary(offer.amounts[y])}`).join("\n");
    return `Free Agent Offer\nFrom: ${offer.userName} (${offer.teamName})\nPlayer: ${offer.playerName}\nYears:\n${yearDetails}\nTotal Value: ${formatSalary(offer.totalValue)}`;
  }

  const errors = getOfferErrors();

  if (loading || offersLoading) return <div className="flex items-center justify-center h-96 text-text-muted">Loading data...</div>;

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-6 sm:py-8">
      <h1 className="text-2xl font-bold mb-6">Free Agency Tracker</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {/* Player List */}
        <div className="lg:col-span-1">
          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border">
              <input
                type="text"
                placeholder="Search players..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-surface-light border border-border rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-primary outline-none"
              />
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              {filteredFreeAgents.map((player) => {
                const playerOffers = offersByPlayer.get(String(player.id));
                return (
                  <button
                    key={player.id}
                    onClick={() => selectPlayer(player)}
                    className={`w-full text-left px-4 py-3 border-b border-border/50 hover:bg-surface-light transition-colors ${
                      selectedPlayer?.id === player.id ? "bg-primary/10 border-l-2 border-l-primary" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <span className="font-medium text-sm truncate">{player.name}</span>
                        {player.ppg != null && (
                          <span className="text-[10px] text-text-dim font-mono shrink-0">{player.ppg.toFixed(1)}</span>
                        )}
                      </div>
                      {playerOffers && (
                        <span className="bg-primary/20 text-primary text-[10px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ml-2">
                          {playerOffers.length} BIDS
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bid Builder */}
        <div className="md:col-span-1 lg:col-span-2">
          {!selectedPlayer ? (
            <div className="bg-surface rounded-xl border border-border flex items-center justify-center h-96 text-text-dim">
              Select a player to build a bid
            </div>
          ) : (
            <div className="bg-surface rounded-xl border border-border p-6">
              <h2 className="font-bold text-xl mb-4">{selectedPlayer.name}</h2>
              
              <div className="mb-6">
                <label className="text-xs font-bold text-text-muted uppercase mb-2 block">Your Identity</label>
                <div className="bg-surface-light border border-border rounded-lg px-3 py-2 w-full text-sm text-text">
                  {myOwner ? `${myOwner.user_name} (${myOwner.team_name})` : "Not identified"}
                </div>
              </div>

              <div className="mb-6">
                <label className="text-xs font-bold text-text-muted uppercase mb-2 block">Contract Duration</label>
                <div className="flex gap-2">
                  {availableYears.map((year, idx) => {
                    const isSelected = offerYears.includes(year);
                    const isDisabled = idx > 0 && !offerYears.includes(availableYears[idx - 1]) && !isSelected;
                    return (
                      <button
                        key={year}
                        disabled={isDisabled}
                        onClick={() => toggleYear(year)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          isSelected ? "bg-primary text-white" : "bg-surface-light border border-border text-text-muted"
                        } ${isDisabled ? "opacity-30 cursor-not-allowed" : ""}`}
                      >
                        {year}
                      </button>
                    );
                  })}
                </div>
              </div>

              {isOverHardCap && (
                <div className="bg-cap-over/10 border border-cap-over/30 rounded-lg p-3 mb-4 text-xs text-cap-over">
                  Your team is over the hard cap — offers are locked to the minimum ({formatSalary(MIN_OFFER_PER_YEAR)}/yr).
                </div>
              )}

              {offerYears.length > 0 && (
                <div className="space-y-4 mb-6">
                  {offerYears.sort().map((year) => (
                    <div key={year}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-text-muted">{year}</span>
                        <span className="font-mono font-bold">
                          {formatSalary(isOverHardCap ? MIN_OFFER_PER_YEAR : yearAmounts[year])}
                        </span>
                      </div>
                      <input
                        type="range" min={1_000_000} max={80_000_000} step={500_000}
                        value={isOverHardCap ? MIN_OFFER_PER_YEAR : yearAmounts[year]}
                        disabled={isOverHardCap}
                        onChange={(e) => setYearAmounts(prev => ({ ...prev, [year]: parseInt(e.target.value) }))}
                        className="w-full accent-primary disabled:opacity-40"
                      />
                    </div>
                  ))}
                </div>
              )}

              {errors.length > 0 && offerYears.length > 0 && (
                <div className="bg-cap-over/10 border border-cap-over/30 rounded-lg p-3 mb-4 text-xs text-cap-over space-y-1">
                  {errors.map((err, i) => <div key={i}>• {err}</div>)}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={errors.length > 0}
                className="w-full py-3 bg-primary text-white rounded-lg font-bold hover:bg-primary-hover disabled:opacity-30"
              >
                Submit Official Bid
              </button>
            </div>
          )}
        </div>

        {/* Offer Log */}
        <div className="lg:col-span-1">
          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border font-bold text-sm">Offer Log</div>
            <div className="max-h-[600px] overflow-y-auto">
              {playerIdsWithOffers.map((pId) => {
                const offers = offersByPlayer.get(pId)!;
                const top = offers[0];
                const isViewing = viewingPlayerId === pId;
                return (
                  <div key={pId} className="border-b border-border/50">
                    <button 
                      onClick={() => setViewingPlayerId(isViewing ? null : pId)}
                      className="w-full text-left p-4 hover:bg-surface-light"
                    >
                      <div className="flex justify-between font-bold text-xs">
                        <span>{top.playerName}</span>
                        <span className="text-primary">{offers.length} Bids</span>
                      </div>
                      <div className="text-[10px] text-text-dim mt-1">High: {formatSalary(top.totalValue)}</div>
                    </button>
                    {isViewing && (
                      <div className="p-4 bg-surface-light space-y-2 border-t border-border/30">
                        {offers.map((o) => (
                          <div key={o.id} className="text-[10px] border-b border-border/20 pb-1 last:border-0">
                            <div className="flex justify-between font-bold">
                              <span>{o.userName}</span>
                              <span>{formatSalary(o.totalValue)}</span>
                            </div>
                          </div>
                        ))}
                        <button 
                          onClick={() => handleRequestClear(pId)}
                          className="w-full py-1 text-[10px] text-cap-over font-bold uppercase hover:underline"
                        >
                          Clear Bids
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Copy Popup */}
      {showCopyPopup && copiedOffer && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl p-6 max-w-sm w-full border border-border">
            <h3 className="font-bold text-primary mb-4">Bid Formatted</h3>
            <pre className="bg-surface-light p-4 rounded-lg text-[10px] font-mono whitespace-pre-wrap mb-4">
              {getOfferCopyText(copiedOffer)}
            </pre>
            <button
              onClick={() => {
                navigator.clipboard.writeText(getOfferCopyText(copiedOffer));
                setShowCopyPopup(false);
              }}
              className="w-full py-2 bg-primary text-white rounded font-bold"
            >
              Copy & Close
            </button>
          </div>
        </div>
      )}

      {/* --- Password Modal --- */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
          <div className="bg-surface rounded-xl p-6 max-w-xs w-full border border-border">
            <h3 className="font-bold text-white mb-2">Admin Required</h3>
            <p className="text-xs text-text-dim mb-4">Enter password to clear bids for this player.</p>
            <input 
              type="password"
              autoFocus
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConfirmClear()}
              className="w-full bg-surface-light border border-border rounded px-3 py-2 text-sm outline-none mb-4 text-white"
              placeholder="Password"
            />
            <div className="flex gap-2">
              <button 
                onClick={handleConfirmClear}
                className="flex-1 py-2 bg-cap-over text-white rounded font-bold text-xs"
              >
                Clear
              </button>
              <button 
                onClick={() => {
                  setShowPasswordModal(false);
                  setPasswordInput("");
                }}
                className="flex-1 py-2 bg-surface-light text-text-muted rounded font-bold text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
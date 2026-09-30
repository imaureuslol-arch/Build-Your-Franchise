"use client";

export const dynamic = "force-dynamic";

import { useMemo, useState, useEffect, useCallback, useDeferredValue } from "react";
import { usePlayers, refreshLeague } from "@/lib/hooks";
import FreeAgencySchedule from "@/components/FreeAgencySchedule";
import { getWeightedValue, minOffer, type FreeAgencyRound, type FreeAgencyAward } from "@/lib/free-agency-rules";
import { useUserTeam } from "@/lib/user-context";
import {
  Player,
  FREE_AGENCY_TEAM,
  formatSalary,
  getHardCap,
  SALARY_YEARS,
  getCurrentSeasonYear,
  getCurrentSalary,
} from "@/lib/types";

const FREE_AGENT_ROWS = 60;
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
    playerId: String(row.player_id),
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
  const { owner: myOwner, isLoading: teamLoading, isWhitelisted, isSubCommish } = useUserTeam();
  const canClear = isWhitelisted || isSubCommish;
  const loading = pLoading || teamLoading;

  const [round, setRound] = useState<FreeAgencyRound | null>(null);
  const [awards, setAwards] = useState<FreeAgencyAward[]>([]);
  const [serverClock, setServerClock] = useState<{ server: number; local: number } | null>(null);
  const [now, setNow] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const biddingOpen = !!round?.closes_at && now < Date.parse(round.closes_at);
  const [searchQuery, setSearchQuery] = useState("");
  // Bids are placed as the logged-in team; the server checks this too
  const selectedUser = myOwner?.user_name ?? "";
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [offerYears, setOfferYears] = useState<number[]>([]);
  const [yearAmounts, setYearAmounts] = useState<{ [year: number]: number }>({});
  const [showCopyPopup, setShowCopyPopup] = useState(false);
  const [copiedOffer, setCopiedOffer] = useState<FAOffer | null>(null);
  const [offerHistory, setOfferHistory] = useState<FAOffer[]>([]);
  const [offersLoading, setOffersLoading] = useState(true);
  const [viewingPlayerId, setViewingPlayerId] = useState<string | null>(null);

  const refreshOffers = useCallback(async () => {
    try {
      const res = await fetch("/api/free-agent-offers");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load bidding data.");
      setOfferHistory((data.offers as FAOfferRow[]).map(rowToOffer));
      setRound(data.round);
      setAwards(data.awards);
      const server = Date.parse(data.serverNow);
      setServerClock({ server, local: performance.now() });
      setNow(server);
      setLoadError("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load bidding data.");
    }
    setOffersLoading(false);
  }, []);

  useEffect(() => {
    refreshOffers();
    // Other owners' bids show up within 15 seconds.
    const timer = setInterval(refreshOffers, 15_000);
    return () => clearInterval(timer);
  }, [refreshOffers]);

  useEffect(() => {
    if (!serverClock) return;
    const timer = setInterval(() => setNow(serverClock.server + performance.now() - serverClock.local), 1000);
    return () => clearInterval(timer);
  }, [serverClock]);

  const awardVersion = awards.map(a => a.player_id + ":" + a.awarded_at).join(",");
  useEffect(() => { if (awardVersion) refreshLeague(); }, [awardVersion]);

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

  // The pool is every unrostered NBA player (~300), so only the best
  // FREE_AGENT_ROWS are drawn; searching reaches the rest. The deferred query
  // keeps typing responsive while the list catches up.
  const deferredQuery = useDeferredValue(searchQuery);
  const filteredFreeAgents = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const matches = q ? freeAgents.filter((p) => p.name.toLowerCase().includes(q)) : freeAgents;
    return matches.slice(0, FREE_AGENT_ROWS);
  }, [freeAgents, deferredQuery]);

  const availableYears = (SALARY_YEARS as readonly number[]).filter((y) => y >= getCurrentSeasonYear());

  const offersByPlayer = useMemo(() => {
    const map = new Map<string, FAOffer[]>();
    for (const offer of offerHistory) {
      if (!map.has(offer.playerId)) map.set(offer.playerId, []);
      map.get(offer.playerId)!.push(offer);
    }
    for (const [, offers] of map) {
      offers.sort((a, b) => getWeightedValue(b) - getWeightedValue(a));
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
    if (!biddingOpen) errors.push("Bidding is closed");
    if (loadError) errors.push("Bidding data could not be refreshed");
    if (!selectedUser) errors.push("Open your login link to bid");
    if (!selectedPlayer) errors.push("Select a player");
    if (offerYears.length === 0) errors.push("Select at least one year");

    const sorted = [...offerYears].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      const yr = sorted[i];
      const amt = isOverHardCap ? minOffer(yr) : yearAmounts[yr];

      if (amt < minOffer(yr)) {
        errors.push(`${yr} must be at least ${formatSalary(minOffer(yr))}`);
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
    if (currentErrors.length > 0 || !selectedPlayer || submitting) return;
    setSubmitting(true);
    try {

    const amounts: { [year: number]: number } = {};
    for (const y of offerYears) amounts[y] = isOverHardCap ? minOffer(y) : yearAmounts[y];

    const res = await fetch("/api/free-agent-offers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roundId: round?.id, player_id: selectedPlayer.id, years: [...offerYears], amounts }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.offer) {
      alert(data?.error ?? "Failed to submit offer. Please try again.");
      return;
    }

    const offer = rowToOffer({ ...(data.offer as FAOfferRow), user_name: myOwner?.user_name ?? "" });
    // Polling reconciles other owners’ bids.
    setOfferHistory((prev) =>
      prev.some((o) => o.id === offer.id) ? prev : [offer, ...prev]
    );
    setCopiedOffer(offer);
    setShowCopyPopup(true);

    setOfferYears([]);
    setSelectedPlayer(null);
    } catch { alert("Could not submit the bid. Refresh and try again."); }
    finally { setSubmitting(false); }
  }

  async function handleClear(playerId: string) {
    if (!confirm("Clear every bid on this player?")) return;
    const res = await fetch(`/api/free-agent-offers?player_id=${playerId}&round_id=${round?.id}`, { method: "DELETE" });
    if (!res.ok) {
      alert("Failed to clear offers. Please try again.");
      return;
    }
    setOfferHistory((prev) => prev.filter((o) => o.playerId !== playerId));
    if (viewingPlayerId === playerId) setViewingPlayerId(null);
  }

  function getOfferCopyText(offer: FAOffer): string {
    const yearDetails = offer.years.sort().map((y) => `  ${y}: ${formatSalary(offer.amounts[y])}`).join("\n");
    return `Free Agent Offer\nFrom: ${offer.userName} (${offer.teamName})\nPlayer: ${offer.playerName}\nYears:\n${yearDetails}\nTotal Value: ${formatSalary(offer.totalValue)}`;
  }

  const errors = getOfferErrors();

  if (loading || offersLoading) return <div className="flex items-center justify-center h-96 byf-loading">Loading data...</div>;

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-6 sm:py-8">
      <h1 className="text-4xl mb-6">Free Agency Tracker</h1>
      {loadError && <p role="alert" className="mb-4 byf-alert byf-alert--danger">{loadError} <button className="byf-btn byf-btn--ghost byf-btn--sm" onClick={refreshOffers}>Retry</button></p>}
      {round && <FreeAgencySchedule round={round} now={now} canManage={canClear} bids={offerHistory} awards={awards} refresh={refreshOffers} />}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {/* Player List */}
        <div className="lg:col-span-1">
          <div className="card-frame overflow-hidden">
            <div className="p-4 border-b border-border">
              <input
                type="text"
                placeholder="Search players..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="byf-input"
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
                      {playerOffers && playerOffers[0] && (
                        <span className="byf-tile text-primary text-[11px] px-1 font-semibold shrink-0 ml-2 font-mono">
                          {formatSalary(getWeightedValue(playerOffers[0]))}
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
            <div className="card-frame flex items-center justify-center h-96 text-text-dim">
              Select a player to build a bid
            </div>
          ) : (
            <div className="card-frame p-6">
              <h2 className="font-bold text-xl mb-4">{selectedPlayer.name}</h2>
              
              <div className="mb-6">
                <label className="byf-label mb-2 block">Your Identity</label>
                <div className="byf-tile px-3 py-2 w-full text-sm text-text">
                  {myOwner ? `${myOwner.user_name} (${myOwner.team_name})` : "Not identified"}
                </div>
              </div>

              <div className="mb-6">
                <label className="byf-label mb-2 block">Contract Duration</label>
                <div className="flex gap-2">
                  {availableYears.map((year, idx) => {
                    const isSelected = offerYears.includes(year);
                    const isDisabled = idx > 0 && !offerYears.includes(availableYears[idx - 1]) && !isSelected;
                    return (
                      <button
                        key={year}
                        disabled={isDisabled}
                        onClick={() => toggleYear(year)}
                        className={`byf-chip ${isSelected ? "byf-chip--on" : ""} ${isDisabled ? "opacity-30 cursor-not-allowed" : ""}`}
                      >
                        {year}
                      </button>
                    );
                  })}
                </div>
              </div>

              {isOverHardCap && (
                <div className="byf-alert byf-alert--danger mb-4">
                  Your team is over the hard cap — offers are locked to the minimum (the veteran minimum each season).
                </div>
              )}

              {offerYears.length > 0 && (
                <div className="space-y-4 mb-6">
                  {offerYears.sort().map((year) => (
                    <div key={year}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-text-muted">{year}</span>
                        <span className="font-mono font-bold">
                          {formatSalary(isOverHardCap ? minOffer(year) : yearAmounts[year])}
                        </span>
                      </div>
                      <input
                        type="range" min={1_000_000} max={80_000_000} step={1_000_000}
                        value={isOverHardCap ? minOffer(year) : yearAmounts[year]}
                        disabled={isOverHardCap}
                        onChange={(e) => setYearAmounts(prev => ({ ...prev, [year]: Math.max(minOffer(year), parseInt(e.target.value)) }))}
                        className="w-full accent-primary disabled:opacity-40"
                      />
                    </div>
                  ))}
                </div>
              )}

              {errors.length > 0 && offerYears.length > 0 && (
                <div className="byf-alert byf-alert--danger mb-4 space-y-1">
                  {errors.map((err, i) => <div key={i}>• {err}</div>)}
                </div>
              )}

              {offerYears.length > 0 && (() => {
                const sortedYrs = [...offerYears].sort((a, b) => a - b);
                const amts: { [y: number]: number } = {};
                for (const y of sortedYrs) amts[y] = isOverHardCap ? minOffer(y) : yearAmounts[y];
                const myWeighted = getWeightedValue({ years: sortedYrs, amounts: amts });
                const myTotal = sortedYrs.reduce((s, y) => s + amts[y], 0);
                const existing = offersByPlayer.get(String(selectedPlayer.id)) ?? [];
                const topWeighted = existing.length > 0 ? getWeightedValue(existing[0]) : 0;
                const wouldWin = myWeighted > topWeighted;
                const rank = existing.filter((o) => getWeightedValue(o) >= myWeighted).length + 1;
                return (
                  <div
                    className={`p-3 mb-4 ${
                      wouldWin
                        ? "byf-alert byf-alert--ok"
                        : "byf-tile"
                    }`}
                  >
                    <div className="flex justify-between font-bold">
                      <span>Your bid: {formatSalary(myWeighted)} weighted</span>
                      <span className="font-mono">{formatSalary(myTotal)} total</span>
                    </div>
                    <div className="mt-1">
                      {existing.length === 0
                        ? "No other bids — you'd be the only one."
                        : wouldWin
                        ? `Would become the highest bid (current top: ${formatSalary(topWeighted)} weighted).`
                        : `Would rank #${rank} of ${existing.length + 1}. Top bid is ${formatSalary(topWeighted)} weighted.`}
                    </div>
                  </div>
                );
              })()}

              <button
                onClick={handleSubmit}
                disabled={errors.length > 0 || submitting}
                className="byf-btn byf-btn--primary byf-btn--block"
              >
                {submitting ? "Submitting…" : "Submit Official Bid"}
              </button>
            </div>
          )}
        </div>

        {/* Offer Log */}
        <div className="lg:col-span-1">
          <div className="card-frame overflow-hidden">
            <div className="card-head px-4 py-3 flex items-center justify-between gap-3 font-bold text-sm">Offer Log</div>
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
                      <div className="text-[10px] text-text-dim mt-1">
                        Top: {formatSalary(getWeightedValue(top))} weighted
                        <span className="text-text-dim/60"> · {formatSalary(top.totalValue)} total</span>
                      </div>
                    </button>
                    {isViewing && (
                      <div className="byf-tile p-4 space-y-2 border-t border-border/30">
                        {offers.map((o) => (
                          <div key={o.id} className="text-[10px] border-b border-border/20 pb-1.5 last:border-0 space-y-0.5">
                            <div className="flex justify-between font-bold">
                              <span>{o.userName}</span>
                              <span>{formatSalary(getWeightedValue(o))}</span>
                            </div>
                            <div className="font-mono text-text-muted leading-tight">
                              {[...o.years].sort((a, b) => a - b).map((y) => (
                                <div key={y} className="flex justify-between">
                                  <span className="text-text-dim">{y}</span>
                                  <span>{formatSalary(o.amounts[y])}</span>
                                </div>
                              ))}
                            </div>
                            <div className="flex justify-between text-text-dim/60">
                              <span>{o.years.length}yr</span>
                              <span>{formatSalary(o.totalValue)} total</span>
                            </div>
                          </div>
                        ))}
                        {canClear && biddingOpen && <button
                          onClick={() => handleClear(pId)}
                          className="byf-btn byf-btn--danger byf-btn--sm byf-btn--block"
                        >
                          Clear Bids
                        </button>}
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
          <div className="card-frame p-6 max-w-sm w-full">
            <h3 className="font-bold text-primary mb-4">Bid Formatted</h3>
            <pre className="byf-code whitespace-pre-wrap mb-4">
              {getOfferCopyText(copiedOffer)}
            </pre>
            <button
              onClick={() => {
                navigator.clipboard.writeText(getOfferCopyText(copiedOffer));
                setShowCopyPopup(false);
              }}
              className="byf-btn byf-btn--primary byf-btn--block"
            >
              Copy & Close
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

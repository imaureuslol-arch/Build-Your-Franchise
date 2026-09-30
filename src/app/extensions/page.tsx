"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback } from "react";
import { usePlayers } from "@/lib/hooks";
import { useUserTeam } from "@/lib/user-context";
import {
  Player,
  ChatMessage,
  isEligibleForExtension,
  getExtensionYears,
  formatSalary,
} from "@/lib/types";
import { MAX_OFFERS, MAX_SALARY, YOUNG_MAX_SALARY, maxSalaryForAge } from "@/lib/extensions";

interface PlayerStats {
  fairValue: number; // millions
  age: number;
  ppg: number;
  avgGamesPlayed: number;
}

const OPENING_LINES = [
  "Alright, let's talk.",
  "My agent said you'd be calling. What's the number?",
  "Aight I'm listening. Don't lowball me.",
  "Been waiting on this. Let's hear it.",
  "Look, I like it here. But this is business. what's the offer?",
  "Let's get this done. I got shootaround in an hour.",
  "Straight up, just give me the number. I don't want to hear nothing else.",
  "Sup boss. I think I proved my worth this season. So I'm expecting a bag.",
  "Listen, I did everything coach asked. Played for the team. Now I need the team to do what's best for me."
];

interface ExtensionRecord {
  id: string;
  player_id: number;
  player_name: string;
  team_name: string;
  user_name: string;
  years: number[];
  amounts: Record<string, number>;
  total_value: number;
  accepted: boolean;
  created_at: string;
}

export default function ExtensionsPage() {
  const { players: allPlayers, loading: playersLoading } = usePlayers();
  const { teamName, owner, isLoading: teamLoading } = useUserTeam();

  const [extensions, setExtensions] = useState<ExtensionRecord[]>([]);
  const [extensionsLoading, setExtensionsLoading] = useState(true);

  const fetchExtensions = useCallback(async () => {
    try {
      const res = await fetch("/api/extensions");
      const data = await res.json();
      if (res.ok) setExtensions(data.extensions ?? []);
    } catch {
      /* silent — non-blocking */
    } finally {
      setExtensionsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExtensions();
  }, [fetchExtensions]);

  const loading = playersLoading || teamLoading || extensionsLoading;
  const lockedPlayerIds = new Set(extensions.map((e) => e.player_id));

  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [offersUsed, setOffersUsed] = useState(0);
  const [negotiationDone, setNegotiationDone] = useState(false);
  const [agreementReached, setAgreementReached] = useState(false);
  const [showCopyPopup, setShowCopyPopup] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [finalOffer, setFinalOffer] = useState<{
    years: number[];
    amounts: { [year: number]: number };
  } | null>(null);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [yearAmounts, setYearAmounts] = useState<{ [year: number]: number }>({});

  const [isFinalDemand, setIsFinalDemand] = useState(false);
  const [finalDemandAmount, setFinalDemandAmount] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);

  const eligiblePlayers = allPlayers.filter(
    (p) =>
      isEligibleForExtension(p) &&
      p.team === teamName &&
      !lockedPlayerIds.has(p.id)
  );
  const filteredPlayers = searchQuery
    ? eligiblePlayers.filter((p) =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : eligiblePlayers;

  async function startNegotiation(player: Player) {
    setSelectedPlayer(player);
    setPlayerStats(null);
    setStatsError(null);
    setStatsLoading(true);
    setChat([
      {
        role: "player",
        content: OPENING_LINES[Math.floor(Math.random() * OPENING_LINES.length)],
      },
    ]);
    setOffersUsed(0);
    setNegotiationDone(false);
    setAgreementReached(false);
    setIsFinalDemand(false);
    setFinalOffer(null);
    setSelectedYears([]);
    setValidationError(null);
    setYearAmounts(
      Object.fromEntries(getExtensionYears(player).map((y) => [y, 10_000_000]))
    );

    // Pick up where this negotiation left off: offers used and any final
    // demand live on the server.
    fetch(`/api/extensions/negotiate?player_id=${player.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((state) => {
        if (!state) return;
        setOffersUsed(state.offersUsed ?? 0);
        if (state.offersUsed > 0) {
          setChat((prev) => [...prev, {
            role: "player",
            content: `We already talked. You've used ${state.offersUsed} of ${MAX_OFFERS} offers.`,
          }]);
        }
        if (state.demand) {
          setSelectedYears(state.demand.years);
          setFinalDemandAmount(state.demand.amount);
          setIsFinalDemand(true);
          setChat((prev) => [...prev, {
            role: "player",
            content: `My final demand stands: ${formatSalary(state.demand.amount)} per year for ${state.demand.years.length} ${state.demand.years.length === 1 ? "year" : "years"}.`,
          }]);
        }
      })
      .catch(() => {});

    try {
      const res = await fetch(
        `/api/player-stats?name=${encodeURIComponent(player.name)}`
      );
      const data = await res.json();
      if (res.ok) {
        const stats = data as PlayerStats;
        setPlayerStats(stats);
        if (stats.fairValue * 1_000_000 > maxSalaryForAge(stats.age)) {
          // Swap only the opening line; anything restored after it stays.
          setChat((prev) => [
            {
              role: "player",
              content:
                "I know what I'm worth, you know what I'm worth. Just put down the max and let's get to work.",
            },
            ...prev.slice(1),
          ]);
        }
      } else {
        setStatsError(data.error ?? "Stats unavailable — contact the commissioner.");
      }
    } catch {
      setStatsError("Failed to fetch player stats — contact the commissioner.");
    } finally {
      setStatsLoading(false);
    }
  }

  function toggleYear(year: number) {
    const available = getExtensionYears(selectedPlayer!).sort((a, b) => a - b);
    setSelectedYears((prev) => {
      const isSelected = prev.includes(year);
      if (isSelected) {
        return prev.filter((y) => y < year);
      } else {
        const yearIndex = available.indexOf(year);
        if (yearIndex > 0 && !prev.includes(available[yearIndex - 1]))
          return prev;
        return [...prev, year].sort((a, b) => a - b);
      }
    });
    setValidationError(null);
  }

  async function submitOffer() {
    if (!selectedPlayer || !playerStats || selectedYears.length === 0 || negotiationDone || submitting) return;
    const years = [...selectedYears].sort((a, b) => a - b);
    const amounts: { [year: number]: number } = {};
    for (const y of years) amounts[y] = yearAmounts[y];

    setSubmitting(true);
    try {
      const res = await fetch("/api/extensions/negotiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: selectedPlayer.id, action: "offer", years, amounts }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setValidationError(data.error ?? "That offer didn't go through.");
        return;
      }
      setValidationError(null);

      const label = years.length === 1 ? "year" : "years";
      const details = years.map((y) => `${y}: ${formatSalary(amounts[y])}`).join(", ");
      const userMsg: ChatMessage = {
        role: "user",
        content: `Offer #${offersUsed + 1}${data.insulting ? " (PLAYER INSULTED. 2 OFFERS USED)" : ""}: ${years.length} ${label} — ${details}`,
        offer: { years, amounts },
      };
      setChat((prev) => [...prev, userMsg, { role: "player", content: data.reply }]);
      setOffersUsed(data.offersUsed);

      if (data.accepted) {
        setNegotiationDone(true);
        setAgreementReached(true);
        setFinalOffer(data.final);
        setShowCopyPopup(true);
        fetchExtensions();
      } else if (data.demand) {
        setFinalDemandAmount(data.demand.amount);
        setIsFinalDemand(true);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFinalDecision(accepted: boolean) {
    if (!selectedPlayer || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/extensions/negotiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: selectedPlayer.id, action: accepted ? "accept" : "decline" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setValidationError(data.error ?? "That didn't go through.");
        return;
      }
      setIsFinalDemand(false);
      setNegotiationDone(true);
      setAgreementReached(data.accepted);
      setChat((prev) => [...prev, { role: "player", content: data.reply }]);
      if (data.accepted) {
        setFinalOffer(data.final);
        setShowCopyPopup(true);
      }
      fetchExtensions();
    } finally {
      setSubmitting(false);
    }
  }

  function getCopyText(): string {
    if (!selectedPlayer || !finalOffer) return "";
    const yearDetails = finalOffer.years
      .sort()
      .map((y) => `  ${y}: ${formatSalary(finalOffer.amounts[y])}`)
      .join("\n");
    const total = Object.values(finalOffer.amounts).reduce(
      (s, v) => s + v,
      0
    );
    return `Extension Agreement\nPlayer: ${selectedPlayer.name}\nTeam: ${selectedPlayer.team}\nYears:\n${yearDetails}\nTotal Value: ${formatSalary(total)}`;
  }

  if (loading)
    return (
      <div className="flex items-center justify-center h-96 byf-loading">
        Loading...
      </div>
    );

  const isYoungPlayer = playerStats != null && playerStats.age <= 23;
  const sliderMax = isYoungPlayer ? YOUNG_MAX_SALARY : MAX_SALARY;
  const canNegotiate = !!playerStats && !statsError && !statsLoading;

  const myExtensions = extensions
    .filter((e) => e.team_name === teamName)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const leagueExtensions = extensions
    .filter((e) => e.team_name !== teamName)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-6 sm:py-8">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-6">
        <h1 className="text-4xl">Player Extensions</h1>
        {teamName && (
          <span className="text-sm text-text-muted">
            {teamName}
            {owner?.user_name ? ` · ${owner.user_name}` : ""}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 flex flex-col gap-6">
          <div className="card-frame overflow-hidden">
            <div className="p-4 border-b border-border">
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="byf-input"
              />
            </div>
            <div className="max-h-[600px] overflow-y-auto">
              {filteredPlayers.map((player) => (
                <button
                  key={player.name}
                  onClick={() => startNegotiation(player)}
                  className={`w-full text-left px-4 py-3 border-b border-border/50 hover:bg-surface-light transition-colors ${
                    selectedPlayer?.name === player.name
                      ? "bg-primary/10 border-l-2 border-l-primary"
                      : ""
                  }`}
                >
                  <div className="font-medium text-sm">{player.name}</div>
                  <div className="text-xs text-text-muted">{player.team}</div>
                </button>
              ))}
            </div>
          </div>

        </div>

        <div className="lg:col-span-3 flex flex-col gap-6">
          {!selectedPlayer ? (
            <div className="card-frame flex items-center justify-center h-96 text-text-dim">
              Select a player to begin
            </div>
          ) : (
            <div className="card-frame flex flex-col h-[600px] sm:h-[700px]">
              <div className="p-4 border-b border-border flex justify-between items-start">
                <div>
                  <h2 className="font-bold text-lg">{selectedPlayer.name}</h2>
                  {statsLoading ? (
                    <p className="byf-loading mt-0.5">Loading player info…</p>
                  ) : statsError ? (
                    <p className="text-xs text-cap-over mt-0.5">{statsError}</p>
                  ) : playerStats ? (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-0.5 text-xs text-text-muted">
                      <span>{playerStats.ppg} PPG</span>
                      <span className="text-text-dim">|</span>
                      <span>Age {playerStats.age}</span>
                      <span className="text-text-dim">|</span>
                      <span>{playerStats.avgGamesPlayed} GP/season</span>
                    </div>
                  ) : null}
                </div>
                {!negotiationDone && (
                  <div className="text-sm text-text-dim">
                    Offers: {Math.min(offersUsed, 3)}/3
                  </div>
                )}
              </div>

              {!statsError && (
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {chat.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] px-4 py-2.5 text-sm ${
                          msg.role === "user"
                            ? "byf-tile bg-primary text-white"
                            : "byf-tile"
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {isFinalDemand && (
                <div className="border-t-2 border-primary/30 p-4 bg-primary/5">
                  <p className="text-sm font-bold text-center mb-3 text-primary uppercase tracking-tighter">
                    Final Ultimatum
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleFinalDecision(true)}
                      className="byf-btn byf-btn--ok flex-1"
                    >
                      ACCEPT ({formatSalary(finalDemandAmount)}/yr)
                    </button>
                    <button
                      onClick={() => handleFinalDecision(false)}
                      className="byf-btn byf-btn--danger flex-1"
                    >
                      DECLINE
                    </button>
                  </div>
                </div>
              )}

              {canNegotiate && !negotiationDone && !isFinalDemand && (
                <div className="border-t border-border p-4">
                  <div className="mb-3">
                    <div className="flex gap-2 mb-4">
                      {getExtensionYears(selectedPlayer).map((year, idx, arr) => {
                        const isSelected = selectedYears.includes(year);
                        const isDisabled =
                          idx > 0 &&
                          !selectedYears.includes(arr[idx - 1]) &&
                          !isSelected;
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
                    {selectedYears.length > 0 &&
                      selectedYears.sort().map((year) => (
                        <div key={year} className="mb-4">
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-text-muted">{year}</span>
                            <span className="font-mono font-bold">
                              {formatSalary(yearAmounts[year])}
                            </span>
                          </div>
                          <input
                            type="range"
                            min={1_000_000}
                            max={sliderMax}
                            step={1_000_000}
                            value={yearAmounts[year]}
                            onChange={(e) => {
                              setYearAmounts((prev) => ({
                                ...prev,
                                [year]: parseInt(e.target.value),
                              }));
                              setValidationError(null);
                            }}
                            className="w-full"
                          />
                        </div>
                      ))}
                  </div>
                  {validationError && (
                    <div className="mb-3 byf-alert byf-alert--danger">
                      {validationError}
                    </div>
                  )}
                  <button
                    onClick={submitOffer}
                    disabled={selectedYears.length === 0 || submitting}
                    className="byf-btn byf-btn--primary byf-btn--block"
                  >
                    Submit Offer ({Math.min(offersUsed + 1, 3)}/3)
                  </button>
                </div>
              )}

              {negotiationDone && (
                <div className="border-t border-border p-4 text-center">
                  <p className={`font-bold mb-2 ${agreementReached ? "text-cap-under" : "text-cap-over"}`}>
                    {agreementReached ? "Agreement Reached!" : "Negotiations Failed"}
                  </p>
                  {agreementReached ? (
                    <button
                      onClick={() => setShowCopyPopup(true)}
                      className="byf-btn byf-btn--ok"
                    >
                      View Details
                    </button>
                  ) : (
                    <p className="text-sm text-text-muted">He won&apos;t negotiate again. He plays out his deal.</p>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="card-frame overflow-hidden">
            <div className="card-head px-4 py-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold">Extension History</h3>
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              {extensions.length === 0 ? (
                <p className="px-4 py-6 byf-empty">No extensions yet</p>
              ) : (
                <>
                  {myExtensions.length > 0 && (
                    <>
                      <div className="px-4 py-2 bg-surface-light/50 font-blocky text-sm font-bold uppercase text-text-muted">
                        Your Team
                      </div>
                      {myExtensions.map((ext) => (
                        <div key={ext.id} className="px-4 py-2.5 border-b border-border/50">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{ext.player_name}</span>
                            <span className={`text-xs font-semibold ${ext.accepted ? "text-cap-under" : "text-cap-over"}`}>
                              {ext.accepted ? "Signed" : "Failed"}
                            </span>
                          </div>
                          {ext.accepted && (
                            <div className="text-xs text-text-muted mt-0.5">
                              {ext.years.sort().map((y: number) => `${y}: ${formatSalary(ext.amounts[String(y)])}`).join(" · ")}
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                  {leagueExtensions.length > 0 && (
                    <>
                      <div className="px-4 py-2 bg-surface-light/50 font-blocky text-sm font-bold uppercase text-text-muted">
                        League
                      </div>
                      {leagueExtensions.map((ext) => (
                        <div key={ext.id} className="px-4 py-2.5 border-b border-border/50">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">{ext.player_name}</span>
                            <span className={`text-xs font-semibold ${ext.accepted ? "text-cap-under" : "text-cap-over"}`}>
                              {ext.accepted ? "Signed" : "Failed"}
                            </span>
                          </div>
                          <div className="text-xs text-text-dim mt-0.5">{ext.team_name}</div>
                          {ext.accepted && (
                            <div className="text-xs text-text-muted mt-0.5">
                              {ext.years.sort().map((y: number) => `${y}: ${formatSalary(ext.amounts[String(y)])}`).join(" · ")}
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {showCopyPopup && finalOffer && selectedPlayer && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="card-frame p-6 max-w-md w-full">
            <h3 className="text-lg font-bold mb-4 text-cap-under">Extension Signed</h3>
            <pre className="byf-code whitespace-pre-wrap mb-4">
              {getCopyText()}
            </pre>
            <div className="flex gap-3">
              <button
                onClick={() => navigator.clipboard.writeText(getCopyText())}
                className="byf-btn byf-btn--primary flex-1"
              >
                Copy
              </button>
              <button
                onClick={() => setShowCopyPopup(false)}
                className="byf-btn byf-btn--secondary flex-1"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
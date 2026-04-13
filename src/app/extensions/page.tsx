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
  getFairValueForYear,
} from "@/lib/types";

interface PlayerStats {
  fairValue: number; // millions
  age: number;
  ppg: number;
  avgGamesPlayed: number;
}

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
  const [bestRatioSoFar, setBestRatioSoFar] = useState<number>(0);
  const [lastOfferAvg, setLastOfferAvg] = useState<number>(0);

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

  async function saveExtension(
    player: Player,
    years: number[],
    amounts: { [year: number]: number },
    accepted: boolean
  ) {
    const total = Object.values(amounts).reduce((s, v) => s + v, 0);
    try {
      await fetch("/api/extensions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_id: player.id,
          player_name: player.name,
          team_name: player.team,
          user_name: owner?.user_name ?? teamName,
          years,
          amounts,
          total_value: total,
          accepted,
        }),
      });
      // Refresh the locked list so the player disappears from sidebar
      fetchExtensions();
    } catch {
      /* best-effort — the copy text is still the record */
    }
  }

  async function startNegotiation(player: Player) {
    setSelectedPlayer(player);
    setPlayerStats(null);
    setStatsError(null);
    setStatsLoading(true);
    setChat([
      {
        role: "player",
        content:
          "Hey, I'm open to discussing an extension with you. I've got a number in mind, but let's see what you've got for me. Don't waste my time, I don't have all day.",
      },
    ]);
    setOffersUsed(0);
    setNegotiationDone(false);
    setAgreementReached(false);
    setIsFinalDemand(false);
    setFinalOffer(null);
    setSelectedYears([]);
    setValidationError(null);
    setBestRatioSoFar(0);
    setLastOfferAvg(0);
    setYearAmounts(
      Object.fromEntries(getExtensionYears(player).map((y) => [y, 10_000_000]))
    );

    try {
      const res = await fetch(
        `/api/player-stats?name=${encodeURIComponent(player.name)}`
      );
      const data = await res.json();
      if (res.ok) {
        setPlayerStats(data as PlayerStats);
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

  function submitOffer() {
    if (
      !selectedPlayer ||
      !playerStats ||
      selectedYears.length === 0 ||
      negotiationDone
    )
      return;

    const baseFV = playerStats.fairValue; // millions
    // Average inflated fair value across the selected extension years
    const avgFairValue =
      selectedYears.reduce((sum, y) => sum + getFairValueForYear(baseFV, y), 0) /
      selectedYears.length *
      1_000_000;
    const currentTotal = selectedYears.reduce(
      (sum, year) => sum + (yearAmounts[year] || 0),
      0
    );
    const currentAvg = currentTotal / selectedYears.length;

    // 1. Validation: Prevent lowering offers
    if (offersUsed > 0 && currentAvg < lastOfferAvg) {
      setValidationError(
        `You can't lower your offer! Your last offer averaged ${formatSalary(lastOfferAvg)}.`
      );
      return;
    }

    // 2. Validation: Salary variance (10% rule)
    const sortedYears = [...selectedYears].sort((a, b) => a - b);
    for (let i = 1; i < sortedYears.length; i++) {
      const prevYear = sortedYears[i - 1];
      const currYear = sortedYears[i];
      const diff = Math.abs(yearAmounts[currYear] - yearAmounts[prevYear]);
      if (diff > yearAmounts[prevYear] * 0.1) {
        setValidationError(
          `Salary variance too high: ${currYear} must be within 10% of ${prevYear}`
        );
        return;
      }
    }

    setValidationError(null);

    // 3. Logic for "Insulting" offers and Attempt Penalties
    const currentRatio = currentAvg / avgFairValue;
    const isInsulting = currentRatio < 0.4;
    const attemptCost = isInsulting ? 2 : 1;
    const newOffersUsedTotal = offersUsed + attemptCost;

    const amounts: { [year: number]: number } = {};
    for (const y of selectedYears) amounts[y] = yearAmounts[y];

    const yearLabel = selectedYears.length === 1 ? "year" : "years";
    const yearDetails = selectedYears
      .sort()
      .map((y) => `${y}: ${formatSalary(amounts[y])}`)
      .join(", ");

    // Create User Message with penalty indicator
    const userMsg: ChatMessage = {
      role: "user",
      content: `Offer #${offersUsed + 1}${isInsulting ? " (PLAYER INSULTED. 2 OFFERS USED)" : ""}: ${selectedYears.length} ${yearLabel} — ${yearDetails}`,
      offer: { years: selectedYears, amounts },
    };

    const playerResponse = generatePlayerResponse(
      avgFairValue,
      amounts,
      selectedYears,
      newOffersUsedTotal // Pass the penalized total
    );

    const updatedBestRatio = Math.max(bestRatioSoFar, currentRatio);
    setBestRatioSoFar(updatedBestRatio);
    setLastOfferAvg(currentAvg);

    // 4. Handle Ultimatum vs Response
    if (!playerResponse.accepted && newOffersUsedTotal >= 3) {
      const isSoften = updatedBestRatio >= 0.8;
      const multiplier = isSoften ? 1.1 : 1.5;
      const demandVal = avgFairValue * multiplier;

      setFinalDemandAmount(demandVal);
      setIsFinalDemand(true);

      const ultimatumMsg: ChatMessage = {
        role: "player",
        content: isInsulting
          ? `That offer is a slap in the face. You're wasting my time. My final demand is ${formatSalary(demandVal)} per year for ${selectedYears.length} ${yearLabel}. Take it or I'm hitting the market.`
          : isSoften
          ? `Look, your last offer was close, and I'd like to stay here. Give me ${formatSalary(demandVal)} per year for ${selectedYears.length} ${yearLabel} and I'll sign right now.`
          : `Alright. I'm done playing games. Pay me what I'm worth or I'm leaving. My final demand is ${formatSalary(demandVal)} per year for ${selectedYears.length} ${yearLabel}.`,
      };

      setChat((prev) => [...prev, userMsg, ultimatumMsg]);
    } else {
      setChat((prev) => [...prev, userMsg, playerResponse.message]);

      if (playerResponse.accepted) {
        setNegotiationDone(true);
        setAgreementReached(true);
        setFinalOffer({ years: selectedYears, amounts });
        setShowCopyPopup(true);
        saveExtension(selectedPlayer, selectedYears, amounts, true);
      }
    }

    setOffersUsed(newOffersUsedTotal);
  }

  function handleFinalDecision(accepted: boolean) {
    if (!selectedPlayer) return;
    setIsFinalDemand(false);

    if (accepted) {
      const amounts: { [year: number]: number } = {};
      selectedYears.forEach((y) => (amounts[y] = finalDemandAmount));
      setFinalOffer({ years: selectedYears, amounts });
      setNegotiationDone(true);
      setAgreementReached(true);
      setShowCopyPopup(true);
      setChat((prev) => [
        ...prev,
        { role: "player", content: "Smart move. I'll see you at training camp." },
      ]);
      saveExtension(selectedPlayer, selectedYears, amounts, true);
    } else {
      setNegotiationDone(true);
      setAgreementReached(false);
      setChat((prev) => [
        ...prev,
        {
          role: "player",
          content: "This is the kinda mistake that gets you fired. Don't call me again.",
        },
      ]);
      // Declined ultimatum — lock the player so they can't renegotiate
      const declinedAmounts: { [year: number]: number } = {};
      selectedYears.forEach((y) => (declinedAmounts[y] = 0));
      saveExtension(selectedPlayer, selectedYears, declinedAmounts, false);
    }
  }

  function generatePlayerResponse(
    fairValue: number,
    amounts: { [year: number]: number },
    years: number[],
    offerNum: number
  ): { message: ChatMessage; accepted: boolean } {
    const avgPerYear =
      Object.values(amounts).reduce((s, v) => s + v, 0) / years.length;
    const ratio = fairValue > 0 ? avgPerYear / fairValue : 1;

    const remainingOffers = Math.max(0, 3 - offerNum);
    const offerText =
      remainingOffers === 1
        ? "This is your last chance."
        : `${remainingOffers} offers remaining`;

    if (ratio >= 1.3) // Slightly lowered threshold for "Hell yeah"
      return {
        message: {
          role: "player",
          content: "YOU SERIOUS?! Hell yeah! You got a deal!",
        },
        accepted: true,
      };
    if (ratio >= 0.95)
      return {
        message: {
          role: "player",
          content: "Alright, that's a fair deal. Let's do it.",
        },
        accepted: true,
      };

    let responseContent = "";
    if (ratio >= 0.9)
      responseContent = `This is pretty fair. Give me a small bump and you've got a deal. (${offerText})`;
    else if (ratio >= 0.85)
    responseContent = `I love the city, but business is business. I’m gonna need a little more. (${offerText})`;
    else if (ratio >= 0.8)
      responseContent = `This is a bit too low, but we're close. (${offerText})`;
    else if (ratio >= 0.7)
      responseContent = `I like playing here but I'm gonna need more. (${offerText})`;
    else if (ratio >= 0.6)
      responseContent = `This is a low-ball offer, I know what I'm worth. (${offerText})`;
    else if (ratio >= 0.5)
      responseContent = `You're crazy man. Let me tell you, this is disrespectful. (${offerText})`;
    else if (ratio >= 0.45)
      responseContent = `Try again with a real offer. Or don't, I'll go somewhere I'm respected. (${offerText})`;
    else if (ratio >= 0.4)
      responseContent = `Is this a joke? I feel like I'm being pranked right now. Check the stats and try again. (${offerText})`;
    else
      // For anything < 0.4, since they lose 2 attempts, the message should sound severe
      responseContent = `Is this a joke? Man, stop wasting my time or I'll walk out of here RIGHT NOW. (${offerText})`;

    return {
      message: { role: "player", content: responseContent },
      accepted: false,
    };
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
      <div className="flex items-center justify-center h-96 text-text-muted">
        Loading...
      </div>
    );

  const canNegotiate = !!playerStats && !statsError && !statsLoading;

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 py-6 sm:py-8">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-6">
        <h1 className="text-2xl font-bold">Player Extensions</h1>
        <span className="text-sm text-text-muted">
          {owner?.user_name ?? teamName} &mdash; {teamName}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border">
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-surface-light border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
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

        <div className="lg:col-span-2">
          {!selectedPlayer ? (
            <div className="bg-surface rounded-xl border border-border flex items-center justify-center h-96 text-text-dim">
              Select a player to begin
            </div>
          ) : (
            <div className="bg-surface rounded-xl border border-border flex flex-col h-[600px] sm:h-[700px]">
              <div className="p-4 border-b border-border flex justify-between items-start">
                <div>
                  <h2 className="font-bold text-lg">{selectedPlayer.name}</h2>
                  {statsLoading ? (
                    <p className="text-xs text-text-dim mt-0.5">Loading player info…</p>
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
                        className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
                          msg.role === "user"
                            ? "bg-primary text-white"
                            : "bg-surface-light text-text"
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
                      className="flex-1 py-3 bg-cap-under text-white rounded-lg font-bold hover:opacity-90 transition-opacity"
                    >
                      ACCEPT ({formatSalary(finalDemandAmount)}/yr)
                    </button>
                    <button
                      onClick={() => handleFinalDecision(false)}
                      className="flex-1 py-3 bg-cap-over text-white rounded-lg font-bold hover:opacity-90 transition-opacity"
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
                            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                              isSelected
                                ? "bg-primary text-white"
                                : "bg-surface-light text-text-muted border border-border"
                            } ${isDisabled ? "opacity-30 cursor-not-allowed" : ""}`}
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
                            max={80_000_000}
                            step={500_000}
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
                    <div className="mb-3 p-2 bg-red-500/10 border border-red-500/50 rounded text-red-500 text-xs">
                      {validationError}
                    </div>
                  )}
                  <button
                    onClick={submitOffer}
                    disabled={selectedYears.length === 0}
                    className="w-full py-2.5 bg-primary text-white rounded-lg font-medium disabled:opacity-40"
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
                  <button
                    onClick={() =>
                      agreementReached ? setShowCopyPopup(true) : startNegotiation(selectedPlayer)
                    }
                    className={`px-4 py-2 rounded-lg text-sm font-medium ${
                      agreementReached
                        ? "bg-cap-under text-white"
                        : "bg-surface-light border border-border text-text-muted"
                    }`}
                  >
                    {agreementReached ? "View Details" : "Try Again"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showCopyPopup && finalOffer && selectedPlayer && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface rounded-xl p-6 max-w-md w-full border border-border">
            <h3 className="text-lg font-bold mb-4 text-cap-under">Extension Signed</h3>
            <pre className="bg-surface-light rounded-lg p-4 text-sm font-mono whitespace-pre-wrap mb-4">
              {getCopyText()}
            </pre>
            <div className="flex gap-3">
              <button
                onClick={() => navigator.clipboard.writeText(getCopyText())}
                className="flex-1 py-2.5 bg-primary text-white rounded-lg font-medium"
              >
                Copy
              </button>
              <button
                onClick={() => setShowCopyPopup(false)}
                className="flex-1 py-2.5 bg-surface-light border border-border rounded-lg"
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
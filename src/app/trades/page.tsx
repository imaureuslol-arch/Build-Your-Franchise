"use client";

export const dynamic = "force-dynamic";

import { Suspense, useState, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { usePlayers } from "@/lib/hooks";
import { useUserTeam } from "@/lib/user-context";
import { Player, FREE_AGENCY_TEAM, getCurrentSalary, isPick } from "@/lib/types";
import TeamTradeColumn from "@/components/TeamTradeColumn";
import TradeSidebar from "@/components/TradeSidebar";
import TradeProposals, { type TradeView } from "@/components/TradeProposals";

// How much a bargain contract adds on top of the player's own value.
const SURPLUS_WEIGHT = 0.25;

interface TradeSlot {
  team: string;
  playersOut: Player[];
  retainedSalary: number;
}

export default function TradesPageWrapper() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-96"><div className="text-text-muted text-lg">Loading...</div></div>}>
      <TradesPage />
    </Suspense>
  );
}

function TradesPage() {
  const { players: allPlayers, loading } = usePlayers();
  const { teamName: myTeam, isWhitelisted, isSubCommish } = useUserTeam();
  const isCommish = isWhitelisted || isSubCommish;
  const searchParams = useSearchParams();
  const [playerValues, setPlayerValues] = useState<Record<number, { fairValue: number; age: number }>>({});
  useEffect(() => {
    fetch("/api/player-values")
      .then((r) => r.json())
      .then((d) => setPlayerValues(d.values ?? {}))
      .catch(() => {});
  }, []);
  const [slots, setSlots] = useState<TradeSlot[]>([
    { team: "", playersOut: [], retainedSalary: 0 },
    { team: "", playersOut: [], retainedSalary: 0 },
  ]);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    errors: string[];
  } | null>(null);
  const [openTrades, setOpenTrades] = useState<TradeView[]>([]);
  const [history, setHistory] = useState<TradeView[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadTrades = useCallback(async () => {
    const res = await fetch("/api/trades");
    if (!res.ok) return;
    const data = await res.json();
    setOpenTrades(data.open);
    setHistory(data.history);
  }, []);

  // Draft picks, as salary-free entries owned by their current team.
  const [picks, setPicks] = useState<Player[]>([]);
  const [power, setPower] = useState<Record<string, number>>({});
  const [pickValues, setPickValues] = useState<Record<number, { fairValue: number; salary: number; slot: number }>>({});
  const loadPicks = useCallback(async () => {
    const res = await fetch("/api/picks");
    if (!res.ok) return;
    const data = await res.json();
    setPicks(data.picks);
    setPower(data.power ?? {});
    setPickValues(data.values ?? {});
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPicks();
  }, [loadPicks]);

  useEffect(() => {
    loadTrades();
  }, [loadTrades]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [destinationMap, setDestinationMap] = useState<Record<string, string>>({});

  // Pre-populate from query params (roster search sends ?team=, trade finder sends ?team1=&team1out=&team2=&team2out=)
  useEffect(() => {
    if (allPlayers.length === 0) return;
    const rostered = allPlayers.filter((p) => p.team !== FREE_AGENCY_TEAM);

    const team1 = searchParams.get("team1");
    const team2 = searchParams.get("team2");

    // Full trade pre-population from Trade Finder
    if (team1 && team2) {
      const team1OutNames = (searchParams.get("team1out") ?? "").split(",").filter(Boolean);
      const team2OutNames = (searchParams.get("team2out") ?? "").split(",").filter(Boolean);
      const team1Out = rostered.filter((p) => p.team === team1 && team1OutNames.includes(p.name));
      const team2Out = rostered.filter((p) => p.team === team2 && team2OutNames.includes(p.name));

      setSlots([
        { team: team1, playersOut: team1Out, retainedSalary: 0 },
        { team: team2, playersOut: team2Out, retainedSalary: 0 },
      ]);

      // Auto-set destinations (2-team trade: each side goes to the other)
      const newDestMap: Record<string, string> = {};
      for (const p of team1Out) newDestMap[`${team1}:${p.name}`] = team2;
      for (const p of team2Out) newDestMap[`${team2}:${p.name}`] = team1;
      setDestinationMap(newDestMap);
      return;
    }

    // Simple team pre-select from roster search
    const teamParam = searchParams.get("team");
    if (teamParam) {
      setSlots((prev) => {
        if (prev[0].team === teamParam) return prev;
        const next = [...prev];
        next[0] = { team: teamParam, playersOut: [], retainedSalary: 0 };
        return next;
      });
    }
  }, [searchParams, allPlayers]);

  const rostered = allPlayers.filter((p) => p.team !== FREE_AGENCY_TEAM);
  const allTeams = [
    ...new Set(rostered.map((p) => p.team).filter(Boolean)),
  ].sort();
  const usedTeams = slots.map((s) => s.team).filter(Boolean);

  const getTeamPlayers = useCallback(
    (team: string) => [...rostered.filter((p) => p.team === team), ...picks.filter((p) => p.team === team)],
    [rostered, picks]
  );

  const getPlayersIn = useCallback(
    (teamName: string): Player[] => {
      if (!teamName) return [];
      const incoming: Player[] = [];
      for (const slot of slots) {
        if (slot.team === teamName) continue;
        for (const p of slot.playersOut) {
          if (destinationMap[`${slot.team}:${p.name}`] === teamName) {
            incoming.push(p);
          }
        }
      }
      return incoming;
    },
    [slots, destinationMap]
  );

  function updateSlot(index: number, updates: Partial<TradeSlot>) {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      return next;
    });
    setValidationResult(null);
  }

  function addTeam() {
    if (slots.length < 4) {
      setSlots((prev) => [...prev, { team: "", playersOut: [], retainedSalary: 0 }]);
    }
  }

  function removeTeam(index: number) {
    const removedTeam = slots[index].team;
    setDestinationMap((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (key.startsWith(`${removedTeam}:`) || next[key] === removedTeam) {
          delete next[key];
        }
      }
      return next;
    });
    setSlots((prev) => prev.filter((_, i) => i !== index));
    setValidationResult(null);
  }

  function handleAddPlayerOut(slotIndex: number, player: Player) {
    const slot = slots[slotIndex];
    if (slot.playersOut.some((p) => p.name === player.name)) return;
    updateSlot(slotIndex, { playersOut: [...slot.playersOut, player] });

    const otherTeams = slots
      .filter((_, i) => i !== slotIndex)
      .map((s) => s.team)
      .filter(Boolean);
    if (otherTeams.length === 1) {
      setDestinationMap((prev) => ({
        ...prev,
        [`${slot.team}:${player.name}`]: otherTeams[0],
      }));
    }
  }

  function handleRemovePlayerOut(slotIndex: number, player: Player) {
    const slot = slots[slotIndex];
    const remaining = slot.playersOut.filter((p) => p.name !== player.name);
    const newOutTotal = remaining.reduce((s, p) => s + (getCurrentSalary(p) || 0), 0);
    const maxRetained = Math.floor(newOutTotal * 0.25);
    updateSlot(slotIndex, {
      playersOut: remaining,
      retainedSalary: Math.min(slot.retainedSalary, maxRetained),
    });
    setDestinationMap((prev) => {
      const next = { ...prev };
      delete next[`${slot.team}:${player.name}`];
      return next;
    });
  }

  /** Sum of salary retained by OTHER teams on players coming INTO this team */
  function getIncomingRetained(teamName: string): number {
    if (!teamName) return 0;
    let total = 0;
    for (const slot of slots) {
      if (slot.team === teamName || !slot.team || slot.retainedSalary === 0) continue;
      // Check if any of this slot's outgoing players are destined for teamName
      const outToThisTeam = slot.playersOut.filter(
        (p) => destinationMap[`${slot.team}:${p.name}`] === teamName
      );
      if (outToThisTeam.length > 0) {
        // Distribute retained salary proportionally across all outgoing players
        const slotOutTotal = slot.playersOut.reduce((s, p) => s + (getCurrentSalary(p) || 0), 0);
        if (slotOutTotal > 0) {
          const toThisTeamSalary = outToThisTeam.reduce((s, p) => s + (getCurrentSalary(p) || 0), 0);
          total += Math.round(slot.retainedSalary * (toThisTeamSalary / slotOutTotal));
        }
      }
    }
    return total;
  }

  /**
   * What a team receives, in dollars: fair value plus SURPLUS_WEIGHT of the
   * contract surplus (fair value minus salary, net of salary other teams
   * retain). Missing fair values count as 0.
   */
  function computeTradeValue(teamName: string): { value: number; missingFV: string[] } {
    if (!teamName) return { value: 0, missingFV: [] };
    const incoming = getPlayersIn(teamName);
    const missingFV: string[] = [];
    let fvSum = 0;
    let salarySum = 0;
    for (const p of incoming) {
      // A pick counts at its projected slot: value, and that slot's rookie-scale salary.
      if (isPick(p)) {
        const pv = pickValues[p.id];
        if (pv) {
          fvSum += pv.fairValue * 1_000_000;
          salarySum += pv.salary;
        }
        continue;
      }
      const fv = playerValues[p.id]?.fairValue;
      if (fv == null) {
        if (p.name !== "Dead Cap" && !isPick(p)) missingFV.push(p.name);
      } else {
        fvSum += fv * 1_000_000;
      }
      salarySum += getCurrentSalary(p) || 0;
    }
    // Talent first: an elite player on a big deal still outweighs a cheap role player.
    const surplus = fvSum - (salarySum - getIncomingRetained(teamName));
    const value = fvSum + SURPLUS_WEIGHT * surplus;
    return { value, missingFV };
  }

  const activeSlots = slots.filter((s) => s.team);
  const tradeValues = activeSlots.map((s) => ({
    team: s.team,
    ...computeTradeValue(s.team),
  }));
  const hasAnyIncoming = activeSlots.some((s) => getPlayersIn(s.team).length > 0);
  const maxAbsValue = Math.max(1, ...tradeValues.map((tv) => Math.abs(tv.value)));
  const valueSpread =
    tradeValues.length > 1
      ? Math.max(...tradeValues.map((tv) => tv.value)) -
        Math.min(...tradeValues.map((tv) => tv.value))
      : 0;
  const fairnessLabel =
    valueSpread < 20_000_000
      ? { text: "Fair Trade", color: "text-cap-under" }
      : valueSpread < 50_000_000
      ? { text: "Slight Edge", color: "text-cap-yellow" }
      : { text: "Lopsided", color: "text-cap-over" };

  /** The trade as the server wants it: teams with retention, and who goes where. */
  function buildTradeInput() {
    const active = slots.filter((s) => s.team);
    return {
      teams: active.map((s) => ({ team: s.team, retained: s.retainedSalary })),
      items: active.flatMap((s) =>
        s.playersOut.map((p) => ({
          playerId: p.id,
          from: s.team,
          to: destinationMap[`${s.team}:${p.name}`] ?? "",
        }))
      ),
    };
  }

  async function handleValidate() {
    const res = await fetch("/api/trades/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trade: buildTradeInput() }),
    });
    setValidationResult(await res.json());
  }

  async function submit(record: boolean) {
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade: buildTradeInput(), record }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setValidationResult({ valid: false, errors: data.errors ?? [data.error ?? "Something went wrong."] });
        return;
      }
      handleReset();
      setNotice(
        record
          ? "Trade recorded. Rosters are updated; make the same trade in Sleeper."
          : "Trade proposed. The other teams can accept it below."
      );
      await loadTrades();
      if (record) window.location.reload();
    } finally {
      setSubmitting(false);
    }
  }

  const inTrade = slots.some((s) => s.team && s.team === myTeam);

  function handleReset() {
    setSlots([{ team: "", playersOut: [], retainedSalary: 0 }, { team: "", playersOut: [], retainedSalary: 0 }]);
    setDestinationMap({});
    setValidationResult(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-text-muted text-lg">Loading players...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-4xl">Trade Machine</h1>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSidebarOpen(true)}
            className="px-4 py-2 bg-surface text-text-muted border border-border rounded-sm text-sm hover:text-text transition-colors relative"
          >
            History

          </button>
          {slots.length < 4 && (
            <button
              onClick={addTeam}
              className="px-4 py-2 bg-surface-light text-text border border-border rounded-sm text-sm hover:bg-primary hover:text-white transition-colors"
            >
              + Add Team
            </button>
          )}
        </div>
      </div>

      <TradeProposals trades={openTrades} myTeam={myTeam} isCommish={isCommish} onChange={loadTrades} />

      <div className="flex flex-col md:flex-row gap-4 md:overflow-x-auto pb-4">
        {slots.map((slot, i) => {
          const otherTeams = slots
            .filter((s, j) => j !== i && s.team)
            .map((s) => s.team);
          return (
            <div key={i} className="md:flex-1 md:min-w-[280px]">
              <TeamTradeColumn
                teamName={slot.team}
                allTeams={allTeams.filter((t) => t === slot.team || !usedTeams.includes(t))}
                teamPlayers={getTeamPlayers(slot.team)}
                playersOut={slot.playersOut}
                playersIn={getPlayersIn(slot.team)}
                otherTeamsInTrade={otherTeams}
                destinationMap={destinationMap}
                retainedSalary={slot.retainedSalary}
                incomingRetained={getIncomingRetained(slot.team)}
                onTeamChange={(team) => {
                  const oldTeam = slot.team;
                  setDestinationMap((prev) => {
                    const next = { ...prev };
                    for (const key of Object.keys(next)) {
                      if (key.startsWith(`${oldTeam}:`) || next[key] === oldTeam) delete next[key];
                    }
                    return next;
                  });
                  updateSlot(i, { team, playersOut: [], retainedSalary: 0 });
                }}
                onAddPlayerOut={(p) => handleAddPlayerOut(i, p)}
                onRemovePlayerOut={(p) => handleRemovePlayerOut(i, p)}
                onSetDestination={(playerName, destTeam) => {
                  setDestinationMap((prev) => ({
                    ...prev,
                    [`${slot.team}:${playerName}`]: destTeam,
                  }));
                }}
                onRetainedChange={(amount) => updateSlot(i, { retainedSalary: amount })}
                onRemove={() => removeTeam(i)}
                canRemove={slots.length > 2}
                power={power}
                pickValues={pickValues}
              />
            </div>
          );
        })}
      </div>

      {hasAnyIncoming && (() => {
        const winner = tradeValues.reduce(
          (best, tv) => (tv.value > best.value ? tv : best),
          tradeValues[0]
        );
        const showWinner = valueSpread >= 20_000_000 && winner?.team;
        // Fixed scale so small surpluses look small. $150M of surplus fills
        // the half-bar; stretches if anyone actually exceeds that.
        const scale = Math.max(150_000_000, maxAbsValue);
        return (
          <div className="mt-6 w-full max-w-2xl mx-auto bg-surface border border-border rounded-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <h3 className="text-xl text-text">
                Trade Fairness
              </h3>
              <span className={`text-sm font-bold ${fairnessLabel.color}`}>
                {fairnessLabel.text}
                {showWinner && (
                  <span className="text-text-dim font-normal ml-2">
                    ({winner.team} wins)
                  </span>
                )}
              </span>
            </div>
            <div className="divide-y divide-border/50">
              {tradeValues.map((tv) => {
                const halfPct = Math.min(50, (Math.abs(tv.value) / scale) * 50);
                const positive = tv.value >= 0;
                return (
                  <div key={tv.team} className="px-4 py-2.5">
                    <div className="text-sm font-medium truncate mb-1">{tv.team}</div>
                    <div className="relative h-2 bg-surface-light overflow-hidden">
                      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border/80" />
                      <div
                        className={`absolute top-0 bottom-0 ${
                          positive
                            ? "left-1/2 bg-cap-under/60"
                            : "right-1/2 bg-cap-over/60"
                        }`}
                        style={{ width: `${halfPct}%` }}
                      />
                    </div>
                    {tv.missingFV.length > 0 && (
                      <p className="text-xs text-text-dim mt-1">
                        No fair value for: {tv.missingFV.join(", ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <div className="mt-6 flex flex-col items-center gap-4">
        <div className="flex flex-wrap justify-center gap-2 sm:gap-3 w-full">
          <button onClick={handleValidate} className="flex-1 sm:flex-none min-w-[140px] px-4 sm:px-6 py-2.5 bg-primary text-white rounded-sm font-medium hover:bg-primary-hover transition-colors">
            Validate Trade
          </button>
          {myTeam && (
            <button
              onClick={() => submit(false)}
              disabled={!inTrade || submitting}
              title={inTrade ? undefined : "Your team has to be in the trade"}
              className="flex-1 sm:flex-none min-w-[140px] px-4 sm:px-6 py-2.5 bg-cap-under text-white rounded-sm font-medium hover:opacity-90 transition-colors disabled:opacity-40"
            >
              Propose Trade
            </button>
          )}
          {isCommish && (
            <button
              onClick={() => confirm("Record this trade now? Rosters and cap change immediately.") && submit(true)}
              disabled={submitting}
              className="flex-1 sm:flex-none min-w-[140px] px-4 sm:px-6 py-2.5 bg-surface-light text-text border border-border rounded-sm font-medium hover:text-text transition-colors disabled:opacity-40"
            >
              Record Trade
            </button>
          )}
          <button onClick={handleReset} className="flex-1 sm:flex-none min-w-[100px] px-4 sm:px-6 py-2.5 bg-surface-light text-text-muted border border-border rounded-sm font-medium hover:text-text transition-colors">
            Reset
          </button>
        </div>

        {notice && <p className="text-sm text-cap-under text-center">{notice}</p>}

        {validationResult && (
          <div className={`w-full max-w-2xl rounded-sm border p-4 ${validationResult.valid ? "bg-cap-under/10 border-cap-under/30" : "bg-cap-over/10 border-cap-over/30"}`}>
            {validationResult.valid ? (
              <p className="text-cap-under font-medium text-center">Trade works under the cap rules.</p>
            ) : (
              <div>
                <p className="text-cap-over font-medium mb-2">Trade is invalid:</p>
                <ul className="list-disc list-inside space-y-1">
                  {validationResult.errors.map((err, i) => (
                    <li key={i} className="text-sm text-cap-over/80">{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <TradeSidebar trades={history} onClose={() => setSidebarOpen(false)} open={sidebarOpen} />

    </div>
  );
}
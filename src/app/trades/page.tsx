"use client";

export const dynamic = "force-dynamic";

import { Suspense, useState, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { usePlayers } from "@/lib/hooks";
import {
  Player,
  TradeTeam,
  ConfirmedTrade,
  FREE_AGENCY_TEAM,
  validateTrade,
  getCurrentSalary,
} from "@/lib/types";
import TeamTradeColumn from "@/components/TeamTradeColumn";
import TradeSidebar from "@/components/TradeSidebar";

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
  const searchParams = useSearchParams();
  const [slots, setSlots] = useState<TradeSlot[]>([
    { team: "", playersOut: [], retainedSalary: 0 },
    { team: "", playersOut: [], retainedSalary: 0 },
  ]);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    errors: string[];
  } | null>(null);
  const [confirmedTrades, setConfirmedTrades] = useState<ConfirmedTrade[]>(() => {
    if (typeof window === "undefined") return [];
    const saved = localStorage.getItem("confirmedTrades");
    return saved ? JSON.parse(saved) : [];
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [destinationMap, setDestinationMap] = useState<Record<string, string>>({});

  // --- Password Protection State ---
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const ADMIN_PASSWORD = "stoplookinginthefilesasshole"; // Set your password here

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
    (team: string) => rostered.filter((p) => p.team === team),
    [rostered]
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

  function buildTradeTeams(): TradeTeam[] {
    return slots
      .filter((s) => s.team)
      .map((slot) => ({
        team: slot.team,
        playersOut: slot.playersOut,
        playersIn: getPlayersIn(slot.team),
        retainedSalary: slot.retainedSalary,
        incomingRetained: getIncomingRetained(slot.team),
      }));
  }

  function handleValidate() {
    setValidationResult(validateTrade(buildTradeTeams(), rostered));
  }

  function handleConfirm() {
    const tradeTeams = buildTradeTeams();
    const result = validateTrade(tradeTeams, rostered);
    if (!result.valid) {
      setValidationResult(result);
      return;
    }

    const trade: ConfirmedTrade = {
      id: crypto.randomUUID(),
      teams: tradeTeams,
      timestamp: Date.now(),
    };

    const updated = [trade, ...confirmedTrades];
    setConfirmedTrades(updated);
    localStorage.setItem("confirmedTrades", JSON.stringify(updated));
    setSidebarOpen(true);

    setSlots([{ team: "", playersOut: [], retainedSalary: 0 }, { team: "", playersOut: [], retainedSalary: 0 }]);
    setDestinationMap({});
    setValidationResult(null);
  }

  function handleReset() {
    setSlots([{ team: "", playersOut: [], retainedSalary: 0 }, { team: "", playersOut: [], retainedSalary: 0 }]);
    setDestinationMap({});
    setValidationResult(null);
  }

  // --- Password Logic ---
  function handleConfirmClearHistory() {
    if (passwordInput === ADMIN_PASSWORD) {
      setConfirmedTrades([]);
      localStorage.removeItem("confirmedTrades");
      setShowPasswordModal(false);
      setPasswordInput("");
      alert("Trade history cleared.");
    } else {
      alert("Incorrect Password");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-text-muted text-lg">Loading players...</div>
      </div>
    );
  }

  return (
    <div className="max-w-full mx-auto px-3 sm:px-4 py-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold">Trade Machine</h1>
        <div className="flex flex-wrap gap-2">
          {/* Clear History Button */}
          <button
            onClick={() => setShowPasswordModal(true)}
            className="px-4 py-2 bg-cap-over/10 text-cap-over border border-cap-over/30 rounded-lg text-sm hover:bg-cap-over/20 transition-colors"
          >
            Clear History
          </button>
          <button
            onClick={() => setSidebarOpen(true)}
            className="px-4 py-2 bg-surface text-text-muted border border-border rounded-lg text-sm hover:text-text transition-colors relative"
          >
            History
            {confirmedTrades.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-primary text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                {confirmedTrades.length}
              </span>
            )}
          </button>
          {slots.length < 4 && (
            <button
              onClick={addTeam}
              className="px-4 py-2 bg-surface-light text-text border border-border rounded-lg text-sm hover:bg-primary hover:text-white transition-colors"
            >
              + Add Team
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-4 -mx-3 sm:mx-0 px-3 sm:px-0 snap-x snap-mandatory sm:snap-none">
        {slots.map((slot, i) => {
          const otherTeams = slots
            .filter((s, j) => j !== i && s.team)
            .map((s) => s.team);
          return (
            <div key={i} className="flex-1 min-w-[260px] sm:min-w-[280px] snap-start">
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
              />
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex flex-col items-center gap-4">
        <div className="flex flex-wrap justify-center gap-2 sm:gap-3 w-full">
          <button onClick={handleValidate} className="flex-1 sm:flex-none min-w-[140px] px-4 sm:px-6 py-2.5 bg-primary text-white rounded-lg font-medium hover:bg-primary-hover transition-colors">
            Validate Trade
          </button>
          <button onClick={handleConfirm} className="flex-1 sm:flex-none min-w-[140px] px-4 sm:px-6 py-2.5 bg-cap-under text-white rounded-lg font-medium hover:opacity-90 transition-colors">
            Confirm Trade
          </button>
          <button onClick={handleReset} className="flex-1 sm:flex-none min-w-[100px] px-4 sm:px-6 py-2.5 bg-surface-light text-text-muted border border-border rounded-lg font-medium hover:text-text transition-colors">
            Reset
          </button>
        </div>

        {validationResult && (
          <div className={`w-full max-w-2xl rounded-lg border p-4 ${validationResult.valid ? "bg-cap-under/10 border-cap-under/30" : "bg-cap-over/10 border-cap-over/30"}`}>
            {validationResult.valid ? (
              <p className="text-cap-under font-medium text-center">Trade is valid! Click Confirm to save it.</p>
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

      <TradeSidebar trades={confirmedTrades} onClose={() => setSidebarOpen(false)} open={sidebarOpen} />

      {/* --- Password Modal --- */}
      {showPasswordModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
          <div className="bg-surface rounded-xl p-6 max-w-xs w-full border border-border shadow-2xl">
            <h3 className="font-bold text-white mb-2">Admin Required</h3>
            <p className="text-xs text-text-dim mb-4">Enter password to wipe all confirmed trade history.</p>
            <input 
              type="password"
              autoFocus
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConfirmClearHistory()}
              className="w-full bg-surface-light border border-border rounded px-3 py-2 text-sm outline-none mb-4 text-white focus:ring-1 focus:ring-primary"
              placeholder="Password"
            />
            <div className="flex gap-2">
              <button 
                onClick={handleConfirmClearHistory}
                className="flex-1 py-2 bg-cap-over text-white rounded font-bold text-xs hover:opacity-90 transition-opacity"
              >
                Confirm Clear
              </button>
              <button 
                onClick={() => {
                  setShowPasswordModal(false);
                  setPasswordInput("");
                }}
                className="flex-1 py-2 bg-surface-light text-text-muted rounded font-bold text-xs hover:text-text transition-colors"
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
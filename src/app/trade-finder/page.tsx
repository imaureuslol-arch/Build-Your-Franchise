"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useMemo, useCallback } from "react";
import { usePlayers } from "@/lib/hooks";
import { useUserTeam } from "@/lib/user-context";
import {
  Player,
  FREE_AGENCY_TEAM,
  DEAD_CAP_NAME,
  isDeadCap,
  getTeamTotalCap,
  getCapStatus,
  formatSalary,
} from "@/lib/types";

interface PlayerValue {
  fairValue: number; // millions
  age: number;
}

interface PackageResult {
  team: string;
  players: (Player & { fairValue: number; age: number })[];
  totalSalary: number;
  totalFairValue: number;
  fairValueDiff: number; // absolute diff from user's package
}

export default function TradeFinderPage() {
  const { players: allPlayers, loading: pLoading } = usePlayers();
  const { teamName, owner, isLoading: teamLoading } = useUserTeam();
  const loading = pLoading || teamLoading;

  // Fair values from bulk endpoint
  const [playerValues, setPlayerValues] = useState<Record<number, PlayerValue>>({});
  const [valuesLoading, setValuesLoading] = useState(true);

  useEffect(() => {
    async function fetchValues() {
      try {
        const res = await fetch("/api/player-values");
        const data = await res.json();
        if (res.ok) setPlayerValues(data.values ?? {});
      } catch {
        /* silent */
      } finally {
        setValuesLoading(false);
      }
    }
    fetchValues();
  }, []);

  // User's selected players to trade away
  const [selectedPlayers, setSelectedPlayers] = useState<Player[]>([]);
  const [rosterSearch, setRosterSearch] = useState("");

  // Filters
  const [playerCount, setPlayerCount] = useState(1);
  const [salaryMin, setSalaryMin] = useState(5_000_000);
  const [salaryMax, setSalaryMax] = useState(80_000_000);
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(40);

  // Results
  const [results, setResults] = useState<PackageResult[]>([]);
  const [searched, setSearched] = useState(false);

  const rostered = useMemo(
    () => allPlayers.filter((p) => p.team !== FREE_AGENCY_TEAM && !isDeadCap(p)),
    [allPlayers]
  );

  const myPlayers = useMemo(
    () => rostered.filter((p) => p.team === teamName).sort((a, b) => (b.contract_27 || 0) - (a.contract_27 || 0)),
    [rostered, teamName]
  );

  const filteredMyPlayers = useMemo(() => {
    if (!rosterSearch) return myPlayers;
    const q = rosterSearch.toLowerCase();
    return myPlayers.filter((p) => p.name.toLowerCase().includes(q));
  }, [myPlayers, rosterSearch]);

  // Determine user's cap status
  const myTeamPlayers = useMemo(
    () => allPlayers.filter((p) => p.team === teamName),
    [allPlayers, teamName]
  );
  const myCapStatus = getCapStatus(getTeamTotalCap(myTeamPlayers));

  // User's package fair value
  const userPackageFV = useMemo(
    () => selectedPlayers.reduce((sum, p) => sum + (playerValues[p.id]?.fairValue ?? 0), 0),
    [selectedPlayers, playerValues]
  );

  const userPackageSalary = useMemo(
    () => selectedPlayers.reduce((sum, p) => sum + (p.contract_27 || 0), 0),
    [selectedPlayers]
  );

  const findPackages = useCallback(() => {
    if (selectedPlayers.length === 0) return;

    // Group other teams' players
    const teamMap = new Map<string, Player[]>();
    for (const p of rostered) {
      if (p.team === teamName) continue;
      if (!teamMap.has(p.team)) teamMap.set(p.team, []);
      teamMap.get(p.team)!.push(p);
    }

    // If user is over hard cap, only search green (under) teams
    const eligibleTeams = new Map<string, Player[]>();
    for (const [team, players] of teamMap) {
      const allTeamPlayers = allPlayers.filter((p) => p.team === team);
      const status = getCapStatus(getTeamTotalCap(allTeamPlayers));
      if (myCapStatus === "over" && status !== "under") continue;
      eligibleTeams.set(team, players);
    }

    const packages: PackageResult[] = [];

    for (const [team, players] of eligibleTeams) {
      // Filter by age range and having fair value data
      const eligible = players.filter((p) => {
        const pv = playerValues[p.id];
        if (!pv) return false;
        if (pv.age < ageMin || pv.age > ageMax) return false;
        return true;
      });

      // Find combinations of playerCount size
      const combos = getCombinations(eligible, playerCount);

      for (const combo of combos) {
        const totalSalary = combo.reduce((s, p) => s + (p.contract_27 || 0), 0);
        if (totalSalary < salaryMin || totalSalary > salaryMax) continue;

        const totalFV = combo.reduce((s, p) => s + (playerValues[p.id]?.fairValue ?? 0), 0);
        const diff = Math.abs(totalFV - userPackageFV);

        packages.push({
          team,
          players: combo.map((p) => ({
            ...p,
            fairValue: playerValues[p.id]?.fairValue ?? 0,
            age: playerValues[p.id]?.age ?? 0,
          })),
          totalSalary,
          totalFairValue: totalFV,
          fairValueDiff: diff,
        });
      }
    }

    // Sort by closest fair value match
    packages.sort((a, b) => a.fairValueDiff - b.fairValueDiff);

    setResults(packages.slice(0, 50)); // Top 50 results
    setSearched(true);
  }, [selectedPlayers, rostered, teamName, allPlayers, myCapStatus, playerValues, playerCount, salaryMin, salaryMax, ageMin, ageMax, userPackageFV]);

  function togglePlayer(player: Player) {
    setSelectedPlayers((prev) => {
      if (prev.some((p) => p.id === player.id)) {
        return prev.filter((p) => p.id !== player.id);
      }
      return [...prev, player];
    });
    setSearched(false);
    setResults([]);
  }

  if (loading || valuesLoading) {
    return (
      <div className="flex items-center justify-center h-96 text-text-muted">
        Loading...
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 py-6 sm:py-8">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-6">
        <h1 className="text-2xl font-bold">Trade Finder</h1>
        <span className="text-sm text-text-muted">
          {owner?.user_name ?? teamName} &mdash; {teamName}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: select your players */}
        <div className="lg:col-span-1">
          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <div className="p-4 border-b border-border">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted mb-2">
                Your Players to Trade
              </h2>
              <input
                type="text"
                placeholder="Search roster..."
                value={rosterSearch}
                onChange={(e) => setRosterSearch(e.target.value)}
                className="w-full bg-surface-light border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Selected players */}
            {selectedPlayers.length > 0 && (
              <div className="p-3 border-b border-border bg-primary/5">
                <div className="text-xs text-text-dim mb-1.5">
                  Selected ({selectedPlayers.length}) &mdash; {formatSalary(userPackageSalary)}
                </div>
                <div className="space-y-1">
                  {selectedPlayers.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between bg-primary/10 rounded px-2 py-1.5 text-sm gap-2"
                    >
                      <span className="font-medium truncate min-w-0">{p.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-text-muted font-mono text-xs">
                          {formatSalary(p.contract_27)}
                        </span>
                        <button
                          onClick={() => togglePlayer(p)}
                          className="text-text-dim hover:text-cap-over text-xs"
                        >
                          &times;
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Roster list */}
            <div className="max-h-[400px] overflow-y-auto">
              {filteredMyPlayers
                .filter((p) => !selectedPlayers.some((s) => s.id === p.id))
                .map((player) => {
                  const hasValue = !!playerValues[player.id];
                  return (
                  <button
                    key={player.id}
                    onClick={() => hasValue && togglePlayer(player)}
                    disabled={!hasValue}
                    className={`w-full text-left px-3 sm:px-4 py-2.5 border-b border-border/50 flex justify-between items-center gap-2 ${
                      hasValue
                        ? "hover:bg-surface-light transition-colors"
                        : "opacity-40 cursor-not-allowed"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-sm font-medium truncate">{player.name}</span>
                      {!hasValue && (
                        <span className="text-[10px] text-text-dim shrink-0">No stats</span>
                      )}
                    </div>
                    <span className="text-xs text-text-dim font-mono shrink-0">
                      {formatSalary(player.contract_27)}
                    </span>
                  </button>
                  );
                })}
            </div>
          </div>
        </div>

        {/* Right column: filters + results */}
        <div className="lg:col-span-2 space-y-6">
          {/* Filters */}
          <div className="bg-surface rounded-xl border border-border p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted mb-4">
              Search Filters
            </h2>

            <div className="space-y-4">
              {/* Player count */}
              <div>
                <label className="text-xs text-text-dim block mb-1">
                  Players in return package
                </label>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      onClick={() => { setPlayerCount(n); setSearched(false); }}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                        playerCount === n
                          ? "bg-primary text-white"
                          : "bg-surface-light text-text-muted border border-border"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Age range */}
              <div>
                <label className="text-xs text-text-dim block mb-1">
                  Age range: {ageMin} &ndash; {ageMax}
                </label>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-dim w-8">Min</span>
                    <input
                      type="range"
                      min={18}
                      max={45}
                      value={ageMin}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        setAgeMin(Math.min(v, ageMax));
                        setSearched(false);
                      }}
                      className="flex-1"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-dim w-8">Max</span>
                    <input
                      type="range"
                      min={18}
                      max={45}
                      value={ageMax}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        setAgeMax(Math.max(v, ageMin));
                        setSearched(false);
                      }}
                      className="flex-1"
                    />
                  </div>
                </div>
              </div>

              {/* Salary range */}
              <div>
                <label className="text-xs text-text-dim block mb-1">
                  Total package salary: {formatSalary(salaryMin)} &ndash; {formatSalary(salaryMax)}
                </label>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-dim w-8">Min</span>
                    <input
                      type="range"
                      min={1_000_000}
                      max={200_000_000}
                      step={1_000_000}
                      value={salaryMin}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        setSalaryMin(Math.min(v, salaryMax));
                        setSearched(false);
                      }}
                      className="flex-1"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-text-dim w-8">Max</span>
                    <input
                      type="range"
                      min={1_000_000}
                      max={200_000_000}
                      step={1_000_000}
                      value={salaryMax}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        setSalaryMax(Math.max(v, salaryMin));
                        setSearched(false);
                      }}
                      className="flex-1"
                    />
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={findPackages}
              disabled={selectedPlayers.length === 0}
              className="w-full mt-4 py-2.5 bg-primary text-white rounded-lg font-medium disabled:opacity-40 hover:bg-primary-hover transition-colors"
            >
              Find Packages
            </button>

            {myCapStatus === "over" && (
              <p className="text-xs text-cap-over mt-2 text-center">
                You are over the hard cap &mdash; only showing packages from under-cap teams
              </p>
            )}
          </div>

          {/* Results */}
          {searched && (
            <div className="bg-surface rounded-xl border border-border overflow-hidden">
              <div className="p-4 border-b border-border">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
                  Results ({results.length})
                </h2>
              </div>

              {results.length === 0 ? (
                <div className="p-8 text-center text-text-dim text-sm">
                  No matching packages found. Try adjusting your filters.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {results.map((pkg, i) => (
                    <div
                      key={i}
                      className="p-3 sm:p-4 hover:bg-surface-light/50 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2 gap-2">
                        <span className="font-bold text-sm truncate min-w-0">{pkg.team}</span>
                        <span className="text-xs text-text-muted font-mono shrink-0">
                          {formatSalary(pkg.totalSalary)}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {pkg.players.map((p) => (
                          <div
                            key={p.id}
                            className="flex items-center justify-between text-sm gap-2"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="truncate">{p.name}</span>
                              <span className="text-[10px] sm:text-xs text-text-dim shrink-0">
                                {p.age}
                              </span>
                            </div>
                            <span className="font-mono text-text-muted text-xs shrink-0">
                              {formatSalary(p.contract_27)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Generate all combinations of size k from array */
function getCombinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const results: T[][] = [];

  function helper(start: number, current: T[]) {
    if (current.length === k) {
      results.push([...current]);
      return;
    }
    // Prune: not enough elements left
    if (arr.length - start < k - current.length) return;
    // Cap results to prevent browser freeze on large rosters
    if (results.length >= 5000) return;

    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]);
      helper(i + 1, current);
      current.pop();
    }
  }

  helper(0, []);
  return results;
}

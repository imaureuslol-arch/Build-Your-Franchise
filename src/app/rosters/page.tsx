"use client";

export const dynamic = "force-dynamic";

import { useMemo, useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePlayers, useTeamOwners } from "@/lib/hooks";
import {
  Player,
  TeamSummary,
  SALARY_YEARS,
  FREE_AGENCY_TEAM,
  DEAD_CAP_NAME,
  isDeadCap,
  getTeamTotalCap,
  getCapStatus,
  formatSalary,
  getCurrentSalary,
  getPlayerSalary,
  getSoftCap,
  getHardCap,
} from "@/lib/types";

export default function RostersPage() {
  const { players, loading: pLoading } = usePlayers();
  const { owners, loading: oLoading } = useTeamOwners();
  const loading = pLoading || oLoading;
  const router = useRouter();

  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [conferenceFilter, setConferenceFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [showPlayerResults, setShowPlayerResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Close player dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowPlayerResults(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const rosterPlayers = useMemo(
    () => players.filter((p) => p.team !== FREE_AGENCY_TEAM),
    [players]
  );

  const teams = useMemo(() => {
    const teamMap = new Map<string, Player[]>();
    for (const player of rosterPlayers) {
      if (!player.team) continue;
      if (!teamMap.has(player.team)) teamMap.set(player.team, []);
      teamMap.get(player.team)!.push(player);
    }

    return Array.from(teamMap.entries())
      .map(([team, teamPlayers]) => {
        const owner = owners.get(team);
        const realPlayers = teamPlayers.filter((p) => !isDeadCap(p));
        const deadCapPlayer = teamPlayers.find((p) => isDeadCap(p));
        const deadCapHit = deadCapPlayer ? getCurrentSalary(deadCapPlayer) ?? 0 : 0;
        const totalCap = getTeamTotalCap(teamPlayers); // includes dead cap

        // Per-year cap projections
        const yearCaps: Record<number, number> = {};
        const yearDeadCaps: Record<number, number> = {};
        for (const y of SALARY_YEARS) {
          yearCaps[y] = teamPlayers.reduce((sum, p) => sum + (getPlayerSalary(p, y) || 0), 0);
          yearDeadCaps[y] = deadCapPlayer ? getPlayerSalary(deadCapPlayer, y) ?? 0 : 0;
        }

        return {
          team,
          userName: owner?.user_name || "",
          conference: owner?.conference || "",
          players: realPlayers.sort(
            (a, b) => (getCurrentSalary(b) || 0) - (getCurrentSalary(a) || 0)
          ),
          totalCap,
          capStatus: getCapStatus(totalCap),
          deadCapHit,
          yearCaps,
          yearDeadCaps,
        };
      })
      .sort((a, b) => a.team.localeCompare(b.team));
  }, [rosterPlayers, owners]);

  const conferences = ["All", ...new Set(teams.map((t) => t.conference).filter(Boolean))];

  // Player search results
  const playerSearchResults = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return [];
    const q = searchQuery.toLowerCase();
    return rosterPlayers
      .filter((p) => p.name.toLowerCase().includes(q) && !isDeadCap(p))
      .slice(0, 8);
  }, [searchQuery, rosterPlayers]);

  const filteredTeams = teams.filter((t) => {
    if (conferenceFilter !== "All" && t.conference !== conferenceFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      // Show team if it matches team name, user name, OR contains a matching player
      return (
        t.team.toLowerCase().includes(q) ||
        t.userName.toLowerCase().includes(q) ||
        t.players.some((p) => p.name.toLowerCase().includes(q))
      );
    }
    return true;
  });

  function handlePlayerClick(player: Player) {
    setShowPlayerResults(false);
    setSearchQuery("");
    // Navigate to trades with team pre-selected via query param
    router.push(`/trades?team=${encodeURIComponent(player.team)}`);
  }

  const capStatusColors = {
    under: "text-cap-under",
    yellow: "text-cap-yellow",
    over: "text-cap-over",
  };
  const capStatusBg = {
    under: "bg-cap-under/10 border-cap-under/30",
    yellow: "bg-cap-yellow/10 border-cap-yellow/30",
    over: "bg-cap-over/10 border-cap-over/30",
  };
  const capStatusLabel = {
    under: "Under Soft Cap",
    yellow: "Over Soft Cap",
    over: "Over Hard Cap",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-text-muted text-lg">Loading rosters...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold">Rosters</h1>
        <div className="flex flex-wrap gap-2 items-center w-full sm:w-auto">
          <div className="relative w-full sm:w-auto" ref={searchRef}>
            <input
              type="text"
              placeholder="Search team, user, or player..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowPlayerResults(true);
              }}
              onFocus={() => setShowPlayerResults(true)}
              className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm placeholder-text-dim focus:outline-none focus:ring-1 focus:ring-primary w-full sm:w-64"
            />
            {/* Player search dropdown */}
            {showPlayerResults && playerSearchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-xl z-50 overflow-hidden">
                <div className="px-3 py-1.5 text-xs text-text-dim border-b border-border font-semibold uppercase tracking-wider">
                  Players — click to trade
                </div>
                {playerSearchResults.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handlePlayerClick(p)}
                    className="w-full text-left px-3 py-2 hover:bg-surface-light transition-colors flex justify-between items-center"
                  >
                    <span className="text-sm font-medium">{p.name}</span>
                    <span className="text-xs text-text-dim">{p.team}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {conferences.map((conf) => (
            <button
              key={conf}
              onClick={() => setConferenceFilter(conf)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                conferenceFilter === conf
                  ? "bg-primary text-white"
                  : "bg-surface text-text-muted hover:text-text"
              }`}
            >
              {conf}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 mb-6 text-xs sm:text-sm">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-cap-under" /> Under {formatSalary(getSoftCap())}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-cap-yellow" /> {formatSalary(getSoftCap())} - {formatSalary(getHardCap())}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-cap-over" /> Over {formatSalary(getHardCap())}
        </span>
      </div>

      {/* Grid with self-start so expanded cards don't push siblings */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
        {filteredTeams.map((team) => (
          <div
            key={team.team}
            className={`bg-surface rounded-xl border cursor-pointer transition-all hover:border-primary/50 ${
              selectedTeam === team.team ? "border-primary ring-1 ring-primary/30" : "border-border"
            }`}
            onClick={() =>
              setSelectedTeam(selectedTeam === team.team ? null : team.team)
            }
          >
            <div className="p-4">
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-bold text-lg">{team.team}</h2>
                <span
                  className={`text-xs px-2 py-1 rounded-full border ${capStatusBg[team.capStatus]}`}
                >
                  <span className={capStatusColors[team.capStatus]}>
                    {capStatusLabel[team.capStatus]}
                  </span>
                </span>
              </div>
              {team.userName && (
                <p className="text-xs text-text-dim mb-2">
                  Owner: {team.userName}
                </p>
              )}
              <div className="flex items-baseline justify-between">
                <span className="text-text-muted text-sm">
                  {team.players.length} players
                </span>
                <div className="text-right">
                  <span className={`text-lg font-mono font-bold ${capStatusColors[team.capStatus]}`}>
                    {formatSalary(team.totalCap)}
                  </span>
                  {team.deadCapHit !== 0 && (
                    <div className="text-xs text-text-dim font-mono">
                      Dead Cap: <span className={team.deadCapHit < 0 ? "text-cap-under" : "text-cap-over"}>{formatSalary(team.deadCapHit)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {selectedTeam === team.team && (
              <>
              {/* Cap Projections */}
              <div className="border-t border-border px-4 py-3">
                <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wider mb-2">Cap Projections</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {SALARY_YEARS.map((y) => {
                    const yCap = team.yearCaps[y];
                    const yStatus = getCapStatus(yCap, y);
                    const yDeadCap = team.yearDeadCaps[y];
                    return (
                      <div key={y} className={`rounded-lg border p-2 text-center ${capStatusBg[yStatus]}`}>
                        <div className="text-[10px] text-text-dim font-medium">{y}</div>
                        <div className={`text-xs sm:text-sm font-mono font-bold ${capStatusColors[yStatus]}`}>
                          {formatSalary(yCap)} <span className="text-[10px] font-normal text-text-dim">(HC: {formatSalary(getHardCap(y))})</span>
                        </div>
                        {yDeadCap !== 0 && (
                          <div className="text-[10px] font-mono text-text-dim">
                            DC: <span className={yDeadCap < 0 ? "text-cap-under" : "text-cap-over"}>{formatSalary(yDeadCap)}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Player Roster */}
              <div className="border-t border-border overflow-x-auto">
                <table className="w-full text-sm min-w-[480px]">
                  <thead>
                    <tr className="text-text-dim text-xs">
                      <th className="text-left px-4 py-2 font-medium">Player</th>
                      {SALARY_YEARS.map((y) => (
                        <th key={y} className="text-right px-2 py-2 font-medium">
                          {y}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {team.players.map((player) => (
                      <tr
                        key={player.name}
                        className="border-t border-border/50 hover:bg-surface-light/50"
                      >
                        <td className="px-4 py-2 font-medium">{player.name}</td>
                        {SALARY_YEARS.map((y) => (
                          <td key={y} className="text-right px-2 py-2 font-mono text-text-muted">
                            {formatSalary(getPlayerSalary(player, y))}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

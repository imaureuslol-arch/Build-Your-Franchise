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
  getTeamTotalCap,
  getCapStatus,
  formatSalary,
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
        const totalCap = getTeamTotalCap(teamPlayers);
        return {
          team,
          userName: owner?.user_name || "",
          conference: owner?.conference || "",
          players: teamPlayers.sort(
            (a, b) => (b.contract_27 || 0) - (a.contract_27 || 0)
          ),
          totalCap,
          capStatus: getCapStatus(totalCap),
        } as TeamSummary;
      })
      .sort((a, b) => a.team.localeCompare(b.team));
  }, [rosterPlayers, owners]);

  const conferences = ["All", ...new Set(teams.map((t) => t.conference).filter(Boolean))];

  // Player search results
  const playerSearchResults = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return [];
    const q = searchQuery.toLowerCase();
    return rosterPlayers
      .filter((p) => p.name.toLowerCase().includes(q))
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
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Rosters</h1>
        <div className="flex gap-2 items-center">
          <div className="relative" ref={searchRef}>
            <input
              type="text"
              placeholder="Search team, user, or player..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowPlayerResults(true);
              }}
              onFocus={() => setShowPlayerResults(true)}
              className="bg-surface border border-border rounded-lg px-3 py-1.5 text-sm placeholder-text-dim focus:outline-none focus:ring-1 focus:ring-primary w-64"
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

      <div className="flex gap-4 mb-6 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-cap-under" /> Under $225M
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-cap-yellow" /> $225M - $250M
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-cap-over" /> Over $250M
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
                <span className={`text-lg font-mono font-bold ${capStatusColors[team.capStatus]}`}>
                  {formatSalary(team.totalCap)}
                </span>
              </div>
            </div>

            {selectedTeam === team.team && (
              <div className="border-t border-border">
                <table className="w-full text-sm">
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
                        <td className="text-right px-2 py-2 font-mono text-text-muted">
                          {formatSalary(player.contract_27)}
                        </td>
                        <td className="text-right px-2 py-2 font-mono text-text-muted">
                          {formatSalary(player.contract_28)}
                        </td>
                        <td className="text-right px-2 py-2 font-mono text-text-muted">
                          {formatSalary(player.contract_29)}
                        </td>
                        <td className="text-right px-2 py-2 font-mono text-text-muted">
                          {formatSalary(player.contract_30)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

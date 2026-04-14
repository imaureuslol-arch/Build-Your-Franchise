"use client";

export const dynamic = "force-dynamic";

import { useMemo } from "react";
import { usePlayers, useTeamOwners } from "@/lib/hooks";
import {
  getTeamTotalCap,
  getCapStatus,
  formatSalary,
  FREE_AGENCY_TEAM,
  getHardCap,
  getSoftCap,
} from "@/lib/types";

export default function HomePage() {
  const { players, loading: pLoading } = usePlayers();
  const { owners, loading: oLoading } = useTeamOwners();
  const loading = pLoading || oLoading;

  const teamCaps = useMemo(() => {
    const teamMap = new Map<string, typeof players>();
    for (const p of players) {
      if (!p.team || p.team === FREE_AGENCY_TEAM) continue;
      if (!teamMap.has(p.team)) teamMap.set(p.team, []);
      teamMap.get(p.team)!.push(p);
    }

    return Array.from(teamMap.entries())
      .map(([team, pls]) => {
        const totalCap = getTeamTotalCap(pls);
        return {
          team,
          conference: owners.get(team)?.conference || "",
          totalCap,
          playerCount: pls.length,
          status: getCapStatus(totalCap),
        };
      })
      .sort((a, b) => b.totalCap - a.totalCap);
  }, [players, owners]);

  const overCount = teamCaps.filter((t) => t.status === "over").length;
  const yellowCount = teamCaps.filter((t) => t.status === "yellow").length;
  const underCount = teamCaps.filter((t) => t.status === "under").length;

  const statusColors = {
    under: "bg-cap-under",
    yellow: "bg-cap-yellow",
    over: "bg-cap-over",
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="text-center mb-8 sm:mb-10">
        <h1 className="text-2xl sm:text-4xl font-bold mb-2">Build Your Franchise</h1>
        <p className="text-text-muted text-sm sm:text-lg">
          Mock trades, offer extensions, and view rosters for your cap league
        </p>
      </div>

      {loading ? (
        <div className="text-center text-text-muted">Loading cap data...</div>
      ) : (
        <>
          <h2 className="text-xl font-bold mb-4">League Cap Overview</h2>

          <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-6">
            <div className="bg-cap-over/10 border border-cap-over/30 rounded-lg px-2 sm:px-4 py-2 text-center sm:text-left">
              <span className="text-cap-over font-bold text-xl sm:text-2xl">{overCount}</span>
              <span className="text-text-muted text-xs sm:text-sm ml-1 sm:ml-2">Over Hard</span>
            </div>
            <div className="bg-cap-yellow/10 border border-cap-yellow/30 rounded-lg px-2 sm:px-4 py-2 text-center sm:text-left">
              <span className="text-cap-yellow font-bold text-xl sm:text-2xl">{yellowCount}</span>
              <span className="text-text-muted text-xs sm:text-sm ml-1 sm:ml-2">Over Soft</span>
            </div>
            <div className="bg-cap-under/10 border border-cap-under/30 rounded-lg px-2 sm:px-4 py-2 text-center sm:text-left">
              <span className="text-cap-under font-bold text-xl sm:text-2xl">{underCount}</span>
              <span className="text-text-muted text-xs sm:text-sm ml-1 sm:ml-2">Under Cap</span>
            </div>
          </div>

          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            {teamCaps.map((tc, i) => {
              const hardCap = getHardCap();
              const softCap = getSoftCap();
              const pct = Math.min((tc.totalCap / (hardCap * 1.3)) * 100, 100);
              return (
                <div
                  key={tc.team}
                  className={`flex items-center gap-2 sm:gap-4 px-3 sm:px-4 py-2.5 ${
                    i > 0 ? "border-t border-border/50" : ""
                  } hover:bg-surface-light/50 transition-colors`}
                >
                  <span className="text-xs sm:text-sm font-medium w-24 sm:w-40 truncate shrink-0">
                    {tc.team}
                  </span>
                  <div className="flex-1 h-4 sm:h-5 bg-surface-light rounded-full overflow-hidden relative">
                    <div
                      className={`h-full rounded-full transition-all ${statusColors[tc.status]}`}
                      style={{ width: `${pct}%`, opacity: 0.7 }}
                    />
                    <div
                      className="absolute top-0 bottom-0 w-px bg-cap-yellow/50"
                      style={{ left: `${(softCap / (hardCap * 1.3)) * 100}%` }}
                    />
                    <div
                      className="absolute top-0 bottom-0 w-px bg-cap-over/50"
                      style={{ left: `${(hardCap / (hardCap * 1.3)) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs sm:text-sm font-mono font-bold w-16 sm:w-24 text-right shrink-0">
                    {formatSalary(tc.totalCap)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex justify-center gap-6 mt-3 text-xs text-text-dim">
            <span className="flex items-center gap-1">
              <span className="w-px h-3 bg-cap-yellow/50" /> {formatSalary(getSoftCap())} soft cap
            </span>
            <span className="flex items-center gap-1">
              <span className="w-px h-3 bg-cap-over/50" /> {formatSalary(getHardCap())} hard cap
            </span>
          </div>
        </>
      )}
    </div>
  );
}

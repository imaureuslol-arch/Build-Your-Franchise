"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import CapDeadline from "@/components/CapDeadline";
import CapWarning from "@/components/CapWarning";
import { useUserTeam } from "@/lib/user-context";
import { useMemo } from "react";
import { usePlayers, useTeamOwners } from "@/lib/hooks";
import {
  getTeamTotalCap,
  getCapStatus,
  formatSalary,
  isDeadCap,
  getCurrentSeasonYear,
  FREE_AGENCY_TEAM,
  getHardCap,
  getSoftCap,
} from "@/lib/types";

const statusText = { under: "text-cap-under", yellow: "text-cap-yellow", over: "text-cap-over" } as const;
const statusBar = { under: "bg-cap-under", yellow: "bg-cap-yellow", over: "bg-cap-over" } as const;

export default function HomePage() {
  const { owner } = useUserTeam();
  const { players, loading: pLoading } = usePlayers();
  const { owners, loading: oLoading } = useTeamOwners();
  const loading = pLoading || oLoading;

  const season = getCurrentSeasonYear();
  const soft = getSoftCap();
  const hard = getHardCap();
  // Bars run to 125% of the hard cap so the markers sit well inside.
  const scale = hard * 1.25;

  const teams = useMemo(() => {
    const byTeam = new Map<string, typeof players>();
    for (const p of players) {
      if (!p.team || p.team === FREE_AGENCY_TEAM) continue;
      if (!byTeam.has(p.team)) byTeam.set(p.team, []);
      byTeam.get(p.team)!.push(p);
    }
    return Array.from(byTeam.entries())
      .map(([team, pls]) => {
        const total = getTeamTotalCap(pls);
        return {
          team,
          owner: owners.get(team)?.user_name ?? "",
          conference: owners.get(team)?.conference ?? "",
          total,
          count: pls.filter((p) => !isDeadCap(p)).length,
          status: getCapStatus(total),
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [players, owners]);

  if (loading) {
    return <div className="max-w-7xl mx-auto px-4 py-10 text-text-muted">Loading…</div>;
  }

  const over = teams.filter((t) => t.status === "over").length;
  const taxed = teams.filter((t) => t.status === "yellow").length;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 mb-4">
        <h1>
          {season - 1}–{String(season).slice(2)} Payrolls
        </h1>
        <dl className="flex gap-6 text-sm">
          <div>
            <dt className="text-text-dim">Soft cap</dt>
            <dd className="font-mono font-semibold">{formatSalary(soft)}</dd>
          </div>
          <div>
            <dt className="text-text-dim">Hard cap</dt>
            <dd className="font-mono font-semibold">{formatSalary(hard)}</dd>
          </div>
          <div>
            <dt className="text-text-dim">Over soft / hard</dt>
            <dd className="font-mono font-semibold">
              <span className="text-cap-yellow">{taxed}</span> / <span className="text-cap-over">{over}</span>
            </dd>
          </div>
        </dl>
      </div>

      <div className="mb-4"><CapWarning owner={owner} /></div>
      <table className="w-full text-sm card-frame">
        <thead>
          <tr className="card-head text-left font-blocky italic uppercase">
            <th className="py-2 pl-3 pr-2 w-10 font-extrabold">#</th>
            <th className="py-2 pr-4 font-extrabold">Team</th>
            <th className="py-2 pr-4 font-extrabold hidden md:table-cell">Owner</th>
            <th className="py-2 pr-4 font-extrabold text-right hidden sm:table-cell">Pl</th>
            <th className="py-2 pr-4 font-extrabold text-right">Payroll</th>
            <th className="py-2 pr-4 font-extrabold text-right hidden sm:table-cell">To soft cap</th>
            <th className="py-2 pr-3 font-bold hidden lg:table-cell w-[32%]"></th>
          </tr>
        </thead>
        <tbody>
          {teams.map((t, i) => {
            const room = soft - t.total;
            return (
              <tr key={t.team} className="border-b border-border last:border-0 even:bg-surface-light/50 hover:bg-surface-light">
                <td className="py-2 pl-3 pr-2 font-mono text-text-dim">{i + 1}</td>
                <td className="py-2 pr-4 font-semibold">
                  <Link href={`/rosters?team=${encodeURIComponent(t.team)}`} className="hover:underline">
                    {t.team}
                  </Link>
                  <CapDeadline deadline={owners.get(t.team)?.capDeadline} />
                </td>
                <td className="py-2 pr-4 text-text-muted hidden md:table-cell">{t.owner}</td>
                <td className="py-2 pr-4 font-mono text-right text-text-muted hidden sm:table-cell">{t.count}</td>
                <td className={`py-2 pr-4 font-mono font-semibold text-right ${statusText[t.status]}`}>
                  {formatSalary(t.total)}
                </td>
                <td className="py-2 pr-4 font-mono text-right hidden sm:table-cell">
                  {room >= 0 ? formatSalary(room) : <span className="text-cap-over">−{formatSalary(-room)}</span>}
                </td>
                <td className="py-2 pr-3 hidden lg:table-cell">
                  <div className="relative h-2.5 bg-surface-light">
                    <div
                      className={`absolute inset-y-0 left-0 ${statusBar[t.status]}`}
                      style={{ width: `${Math.min(100, (t.total / scale) * 100)}%` }}
                    />
                    <div className="absolute -inset-y-1 w-px bg-text/40" style={{ left: `${(soft / scale) * 100}%` }} />
                    <div className="absolute -inset-y-1 w-px bg-text" style={{ left: `${(hard / scale) * 100}%` }} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-text-dim hidden lg:block">
        Faint line: soft cap. Solid line: hard cap.
      </p>
      <p className="mt-2 text-xs text-text-dim">Oct 15–Mar 30: teams have 10 days to get under the hard cap before their lowest-value players are waived.</p>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

interface Issue {
  id: number;
  kind: string;
  detail: string;
  player: string | null;
  team: string | null;
}

const LABELS: Record<string, string> = {
  no_contract: "On a Sleeper roster, no contract",
  not_on_sleeper_roster: "Has a contract, not on any Sleeper roster",
  wrong_team: "On a different team in Sleeper",
};

/** Commissioner panel: run the Sleeper sync and list what doesn't line up. */
export default function SyncIssues() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/commissioner/sync");
    if (res.ok) setIssues((await res.json()).issues);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function run() {
    setRunning(true);
    setMsg(null);
    const res = await fetch("/api/commissioner/sync", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setMsg(
      res.ok
        ? `Synced: ${data.teamsUpdated} team changes, ${data.playersAdded} new players, ${data.issues} issues, stats for ${data.statsUpdated} players (${data.statsSeason}).`
        : data.error ?? "Sync failed."
    );
    await load();
    setRunning(false);
  }

  const kinds = [...new Set(issues.map((i) => i.kind))];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xl text-text">Sleeper Sync</h3>
        <button
          onClick={run}
          disabled={running}
          className="text-xs px-2.5 py-1 rounded-sm border border-border hover:bg-surface-light disabled:opacity-40"
        >
          {running ? "Syncing…" : "Sync now"}
        </button>
      </div>
      {msg && <p className="text-xs text-text-muted">{msg}</p>}
      <div className="bg-surface border border-border rounded-sm overflow-hidden">
        {issues.length === 0 ? (
          <p className="px-4 py-6 text-sm text-text-dim text-center">Rosters match Sleeper.</p>
        ) : (
          kinds.map((k) => (
            <div key={k} className="border-b border-border last:border-0">
              <div className="px-4 py-2 text-xs font-semibold text-text-muted bg-surface-light">
                {LABELS[k] ?? k} ({issues.filter((i) => i.kind === k).length})
              </div>
              <ul className="divide-y divide-border max-h-60 overflow-y-auto">
                {issues
                  .filter((i) => i.kind === k)
                  .map((i) => (
                    <li key={i.id} className="px-4 py-2 text-sm flex justify-between gap-2">
                      <span>{i.player}</span>
                      <span className="text-xs text-text-dim">{i.team}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

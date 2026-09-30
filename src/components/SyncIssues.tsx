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
  wrong_team: "Different team than in Sleeper — make the trade in Sleeper",
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
    const moving = issues.filter((i) => i.kind === "wrong_team").length;
    const releasing = issues.filter((i) => i.kind === "not_on_sleeper_roster").length;
    if (
      (moving || releasing) &&
      !confirm(
        `Make the site match Sleeper? ${moving} player${moving === 1 ? "" : "s"} will move to their Sleeper team` +
          ` and ${releasing} will be released (contract erased). Site trades that Sleeper doesn't have are undone.`
      )
    ) return;
    setRunning(true);
    setMsg(null);
    const res = await fetch("/api/commissioner/sync", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setMsg(
      res.ok
        ? [
            data.applied?.moved?.length
              ? `Moved: ${data.applied.moved.map((m: { player: string; from: string; to: string }) => `${m.player} (${m.from} → ${m.to})`).join(", ")}.`
              : "",
            data.applied?.released?.length ? `Released: ${data.applied.released.join(", ")}.` : "",
            data.applied?.joined?.length ? `Joined without a contract: ${data.applied.joined.join(", ")}.` : "",
            data.applied?.tradesUndone ? `${data.applied.tradesUndone} site trade(s) undone.` : "",
            `${data.issues} issue(s) left; stats for ${data.statsUpdated} players (${data.statsSeason}).`,
          ].filter(Boolean).join(" ")
        : data.error ?? "Sync failed."
    );
    await load();
    setRunning(false);
  }

  const kinds = [...new Set(issues.map((i) => i.kind))];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xl">Sleeper Sync</h3>
        <button
          onClick={run}
          disabled={running}
          className="byf-btn byf-btn--primary"
        >
          {running ? "Syncing…" : "Sync to Sleeper"}
        </button>
      </div>
      {msg && <p className="byf-alert byf-alert--info">{msg}</p>}
      <div className="card-frame overflow-hidden">
        {issues.length === 0 ? (
          <p className="byf-empty px-4 py-6">Rosters match Sleeper.</p>
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
                      {i.kind === "wrong_team" ? (
                        <span>{i.detail}</span>
                      ) : (
                        <>
                          <span>{i.player}</span>
                          <span className="text-xs text-text-dim">{i.team}</span>
                        </>
                      )}
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

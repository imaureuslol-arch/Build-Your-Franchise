"use client";

import { useState } from "react";
import { formatSalary } from "@/lib/types";

import type { TradeView } from "@/lib/trades";
export type { TradeView } from "@/lib/trades";

interface Props {
  trades: TradeView[];
  myTeam: string | null;
  isCommish: boolean;
  onChange: () => void;
  onCounter: (trade: TradeView) => void;
}

/** One trade: who gets what, with each team's acceptance. */
export function TradeSummary({ trade }: { trade: TradeView }) {
  return (
    <div className="space-y-2">
      {trade.teams.map((t) => {
        const gets = trade.items.filter((i) => i.to === t.team);
        return (
          <div key={t.team}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold text-sm">{t.team}</span>
              {trade.status === "proposed" && (
                <span className={`text-xs ${t.accepted ? "text-cap-under" : "text-text-dim"}`}>
                  {t.accepted ? "accepted" : "waiting"}
                </span>
              )}
            </div>
            <div className="text-sm text-text-muted">
              {gets.length === 0
                ? "gets nothing"
                : "gets " + gets.map((i) => `${i.player}${i.salary ? ` (${formatSalary(i.salary)})` : ""}`).join(", ")}
              {t.retained > 0 && <span className="text-text-dim"> · keeps {formatSalary(t.retained)} of salary</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Open trades: accept/decline for the teams in them, approve/reject for commissioners. */
export default function TradeProposals({ trades, myTeam, isCommish, onChange, onCounter }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const visible = trades.filter(
    (t) => isCommish || t.teams.some((x) => x.team === myTeam)
  );
  if (visible.length === 0) return null;

  async function act(id: string, action: string) {
    setBusy(id);
    const res = await fetch(`/api/trades/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, revision: trades.find(t => t.id === id)?.revision }),
    });
    const data = await res.json().catch(() => ({}));
    setErrors((e) => ({ ...e, [id]: res.ok ? [] : data.errors ?? [data.error ?? "That didn't work."] }));
    setBusy(null);
    if (res.ok) {
      window.dispatchEvent(new Event("byf-trades-changed"));
      onChange();
      if (action === "approve") window.location.reload();
    }
  }

  const btn = "px-3 py-1.5 text-sm rounded-sm border border-border hover:bg-surface-light disabled:opacity-40";

  return (
    <section className="mb-6 space-y-3">
      <h2 className="text-lg font-semibold">Open trades</h2>
      {visible.map((t) => {
        const me = t.teams.find((x) => x.team === myTeam);
        const canRespond = t.status === "proposed" && me && !me.accepted;
        const canCancel = t.proposed_by === myTeam;
        const awaitingApproval = t.status === "accepted";
        return (
          <div key={t.id} className="bg-surface border border-border rounded-sm p-4 space-y-3">
            <div className="flex items-baseline justify-between gap-2 text-xs text-text-dim">
              <span>Proposed by {t.proposed_by ?? "the commissioner"}</span>
              <span>{awaitingApproval ? "All teams accepted — waiting for the commissioner" : "Waiting for teams"}</span>
            </div>
            <TradeSummary trade={t} />
            {errors[t.id]?.length ? (
              <ul className="text-sm text-cap-over list-disc list-inside">
                {errors[t.id].map((e) => <li key={e}>{e}</li>)}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {canRespond && (
                <>
                  <button className={`${btn} bg-cap-under/15`} disabled={busy === t.id} onClick={() => act(t.id, "accept")}>Accept</button>
                  <button className={btn} disabled={busy === t.id} onClick={() => onCounter(t)}>Counteroffer</button>
                  <button className={btn} disabled={busy === t.id} onClick={() => act(t.id, "decline")}>Decline</button>
                </>
              )}
              {isCommish && awaitingApproval && (
                <button className={`${btn} bg-cap-under/15`} disabled={busy === t.id} onClick={() => act(t.id, "approve")}>Approve</button>
              )}
              {isCommish && (
                <button className={btn} disabled={busy === t.id} onClick={() => confirm("Reject this trade?") && act(t.id, "reject")}>Reject</button>
              )}
              {canCancel && (
                <button className={btn} disabled={busy === t.id} onClick={() => act(t.id, "cancel")}>Withdraw</button>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

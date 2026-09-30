"use client";
import { useState } from "react";
import { countdown, getWeightedValue, type FreeAgencyAward, type FreeAgencyRound } from "@/lib/free-agency-rules";
import { formatSalary } from "@/lib/types";
import { refreshLeague } from "@/lib/hooks";

interface Bid { id: string; playerId: string; playerName: string; teamName: string; years: number[]; amounts: Record<string, number>; totalValue: number }
interface Props { round: FreeAgencyRound; now: number; canManage: boolean; bids: Bid[]; awards: FreeAgencyAward[]; refresh: () => Promise<void> }
const input = "bg-background border border-border rounded-sm px-3 py-2 text-sm w-full";
const button = "px-3 py-2 bg-primary text-white rounded-sm text-sm disabled:opacity-40";

export default function FreeAgencySchedule({ round, now, canManage, bids, awards, refresh }: Props) {
  const closed = round.closes_at != null && Date.parse(round.closes_at) <= now;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const groups = new Map<string, Bid[]>();
  for (const bid of bids) {
    const list = groups.get(bid.playerId) ?? [];
    list.push(bid); groups.set(bid.playerId, list);
  }
  const pending = [...groups.keys()].filter(id => !awards.some(a => String(a.player_id) === id)).length;
  async function act(key: string, body: object) {
    setBusy(key); setError("");
    try {
      const res = await fetch("/api/commissioner/free-agency", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, roundId: round.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save.");
      await refresh(); refreshLeague();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(null); }
  }
  return <section className="mb-6 border border-border rounded-sm bg-surface p-4 sm:p-5 space-y-4">
    <div className="flex flex-wrap justify-between gap-4 items-center">
      <div><h2 className="text-xl">{closed ? "Bidding closed" : "Free-agency deadline"}</h2>
        <p className="text-sm text-text-muted mt-1">{round.closes_at
          ? new Date(round.closes_at).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })
          : "The commissioner has not set a deadline. Bidding is paused."}</p>
        {round.closes_at && <p className="text-xs text-text-dim mt-1">{Intl.DateTimeFormat().resolvedOptions().timeZone}</p>}
      </div>
      {round.closes_at && !closed && <div role="timer" aria-label="Time until bidding closes" className="font-mono text-xl sm:text-2xl text-primary tabular-nums">
        {countdown(round.closes_at, now)}
      </div>}
    </div>
    <p className="text-xs text-text-dim">{closed
      ? "Winning bids are listed below. A commissioner must apply each award; Sleeper moves remain manual."
      : "At the deadline, bidding closes and winning bids are shown. A commissioner then applies the awards."}</p>
    {error && <p role="alert" className="text-sm text-cap-over">{error}</p>}
    {canManage && <DeadlineForm key={round.id + ":" + round.closes_at} deadline={round.closes_at} closed={closed}
      disabled={busy != null || (closed && pending > 0)}
      submit={closesAt => act("deadline", { action: closed ? "new_round" : "deadline", closesAt })} />}
    {canManage && closed && pending > 0 && <p className="text-xs text-text-dim">Apply or dismiss the remaining awards before starting a new round.</p>}
    {closed && <div className="space-y-3 border-t border-border pt-4">
      <h3 className="text-xl">Free-agency results</h3>
      {groups.size === 0 && <p className="text-sm text-text-dim">No bids were placed in this round.</p>}
      {[...groups].map(([id, offers]) => {
        const result = awards.find(a => String(a.player_id) === id);
        const bestValue = Math.max(...offers.map(getWeightedValue));
        const top = offers.filter(o => getWeightedValue(o) === bestValue);
        const choice = top.length === 1 ? top[0].id : choices[id] ?? "";
        const winner = top.find(o => o.id === choice);
        return <div key={id} className="border border-border rounded-sm p-3 space-y-2">
          <div className="flex flex-wrap justify-between gap-2"><h4 className="font-semibold">{offers[0].playerName}</h4>
            <span className={result ? "text-cap-under text-sm" : "text-text-muted text-sm"}>{result ? result.offer_id ? "Award applied" : "Dismissed" : top.length > 1 ? "Tied bids" : "Awaiting award"}</span></div>
          {result ? <p className="text-sm">{result.offer_id ? result.team_name : result.note}
            {result.offer_id && <span className="text-text-muted"> · {result.years.map(y => `${y}: ${formatSalary(Number(result.amounts[y]))}`).join(" · ")}</span>}</p>
          : <>
            {top.length === 1 ? <p className="text-sm">Winner: <strong>{top[0].teamName}</strong> · {formatSalary(bestValue)} weighted</p>
              : <div className="space-y-2"><p className="text-sm">{top.length} bids tied at {formatSalary(bestValue)} weighted. Commissioner selection required.</p>
                {canManage ? <select aria-label={`Choose tied winner for ${offers[0].playerName}`} className={input} value={choice}
                  onChange={e => setChoices(old => ({ ...old, [id]: e.target.value }))}>
                  <option value="">Choose a tied bid</option>{top.map(o => <option key={o.id} value={o.id}>{o.teamName} · {o.years.map(y => `${y}: ${formatSalary(o.amounts[y])}`).join(", ")}</option>)}
                </select> : <p className="text-sm text-text-muted">{top.map(o => o.teamName).join(" / ")}</p>}
              </div>}
            {winner && <p className="text-xs text-text-muted">{winner.years.map(y => `${y}: ${formatSalary(winner.amounts[y])}`).join(" · ")}</p>}
            {canManage && <div className="flex flex-wrap gap-3">
              <button className={button} disabled={busy != null || !choice}
                onClick={() => act(id, { action: "award", playerId: Number(id), offerId: choice })}>{busy === id ? "Saving…" : "Apply award"}</button>
              <button className="text-xs text-text-dim underline" disabled={busy != null} onClick={() => {
                const note = prompt("Reason for dismissing all bids on " + offers[0].playerName + ":");
                if (note?.trim()) void act(id, { action: "dismiss", playerId: Number(id), note });
              }}>Dismiss bids</button>
            </div>}
          </>}
        </div>;
      })}
    </div>}
  </section>;
}

function DeadlineForm({ deadline, closed, disabled, submit }: { deadline: string | null; closed: boolean; disabled: boolean; submit: (date: string) => Promise<void> }) {
  const localDate = deadline ? new Date(Date.parse(deadline) - new Date(deadline).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
  const [value, setValue] = useState(closed ? "" : localDate);
  return <form className="flex flex-col sm:flex-row sm:items-end gap-3" onSubmit={e => { e.preventDefault(); if (value) void submit(new Date(value).toISOString()); }}>
    <label className="text-xs text-text-muted flex-1">{closed ? "Next round deadline" : "Close bidding at"} · {Intl.DateTimeFormat().resolvedOptions().timeZone}
      <input aria-label="Free-agency deadline" className={input + " mt-1"} type="datetime-local" required value={value} disabled={disabled} onChange={e => setValue(e.target.value)} />
    </label>
    <button className={button} disabled={disabled || !value}>{closed ? "Start next round" : "Save deadline"}</button>
  </form>;
}

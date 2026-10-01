"use client";
import { useState } from "react";
import { getWeightedValue, type FreeAgencyAward, type FreeAgencyRound, type PlayerAuction } from "@/lib/free-agency-rules";
import CountdownClock from "./CountdownClock";
import Select from "./Select";
import { formatSalary } from "@/lib/types";
import { refreshLeague } from "@/lib/hooks";

interface Bid { id: string; playerId: string; playerName: string; teamName: string; years: number[]; amounts: Record<string, number>; totalValue: number }
interface Props { round: FreeAgencyRound; now: number; canManage: boolean; bids: Bid[]; awards: FreeAgencyAward[]; auctions: PlayerAuction[]; ownerKey?: string; refresh: () => Promise<void> }
const button = "px-3 py-2 bg-primary text-white rounded-sm text-sm disabled:opacity-40";

export default function FreeAgencySchedule({ round, now, canManage, bids, awards, auctions, ownerKey, refresh }: Props) {
  const closed = auctions.some(a => Date.parse(a.accepts_at) <= now);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [confirmMatch, setConfirmMatch] = useState<{playerId:string; offerId:string} | null>(null);
  const groups = new Map<string, Bid[]>();
  for (const bid of bids) {
    const list = groups.get(bid.playerId) ?? [];
    list.push(bid); groups.set(bid.playerId, list);
  }
  const pending = [...groups.keys()].filter(id => !awards.some(a => String(a.player_id) === id)).length;
  async function act(key: string, body: {action:string; playerId?:number; offerId?:string; note?:string}) {
    setBusy(key); setError("");
    try {
      const res = await fetch(body.action === "match" ? "/api/free-agent-offers/match" : "/api/commissioner/free-agency", {
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
      <div><h2 className="text-xl">Player deadlines</h2>
        <p className="text-sm text-text-muted mt-1">Higher Bid Values shorten the time the player will spend before accepting them. New bids add 12 hours to countdown.</p>
      </div>
    </div>
    <p className="text-xs text-text-dim">Weighted bids at or above the larger of twice fair value and fair value + $10M start a 3-day timer. Bids 20% below value start a 14-day timer; bids 50% below start a 30-day timer. Intermediate bids scale between these durations. Previous owners have 7 days to match restricted free agents. A commissioner applies every award; Sleeper moves remain manual.</p>
    {error && <p role="alert" className="text-sm text-cap-over">{error}</p>}
    {canManage && <button className={button} disabled={busy != null || pending > 0}
      onClick={() => act("new_round", {action:"new_round"})}>Start next round</button>}
    {canManage && pending > 0 && <p className="text-xs text-text-dim">Apply or dismiss the remaining awards before starting a new round.</p>}
    {closed && <div className="space-y-3 border-t border-border pt-4">
      <h3 className="text-xl">Free-agency results</h3>
      {groups.size === 0 && <p className="text-sm text-text-dim">No bids were placed in this round.</p>}
      {[...groups].map(([id, offers]) => {
        const auction = auctions.find(a => String(a.player_id) === id);
        if (!auction || Date.parse(auction.accepts_at) > now) return null;
        const result = awards.find(a => String(a.player_id) === id);
        const bestValue = Math.max(...offers.map(getWeightedValue));
        const top = offers.filter(o => getWeightedValue(o) === bestValue);
        const choice = auction.matched_offer_id ?? (top.length === 1 ? top[0].id : choices[id] ?? "");
        const winner = top.find(o => o.id === choice);
        const matchDeadline = new Date(Date.parse(auction.accepts_at) + 7 * 86400000).toISOString();
        const matchOpen = !!auction.rfa_owner_key && !auction.matched_offer_id && Date.parse(matchDeadline) > now;
        const canMatch = matchOpen && ownerKey === auction.rfa_owner_key;
        const waitingForMatch = matchOpen && winner?.teamName !== auction.rfa_team_name;
        return <div key={id} className="border border-border rounded-sm p-3 space-y-2">
          <div className="flex flex-wrap justify-between gap-2"><h4 className="font-semibold">{offers[0].playerName}</h4>
            <span className={result ? "text-cap-under text-sm" : "text-text-muted text-sm"}>{result ? result.offer_id ? "Award applied" : "Dismissed" : top.length > 1 ? "Tied bids" : "Awaiting award"}</span></div>
          {result ? <p className="text-sm">{result.offer_id ? result.team_name : result.note}
            {result.offer_id && <span className="text-text-muted"> · {result.years.map(y => `${y}: ${formatSalary(Number(result.amounts[y]))}`).join(" · ")}</span>}</p>
          : <>
            {top.length === 1 ? <p className="text-sm">Winner: <strong>{top[0].teamName}</strong> · {formatSalary(bestValue)} weighted</p>
              : <div className="space-y-2"><p className="text-sm">{top.length} bids tied at {formatSalary(bestValue)} weighted. Commissioner selection required.</p>
                {canManage || canMatch ? <Select ariaLabel={`Choose tied winner for ${offers[0].playerName}`} value={choice} placeholder="Choose a tied bid"
                  onChange={v => setChoices(old => ({ ...old, [id]: v }))}
                  options={top.map(o => ({ value: o.id, label: `${o.teamName} · ${o.years.map(y => `${y}: ${formatSalary(o.amounts[y])}`).join(", ")}` }))} />
                  : <p className="text-sm text-text-muted">{top.map(o => o.teamName).join(" / ")}</p>}
              </div>}
            {winner && <p className="text-xs text-text-muted">{winner.years.map(y => `${y}: ${formatSalary(winner.amounts[y])}`).join(" · ")}</p>}
            {auction.matched_offer_id && <p className="text-sm text-cap-under">Matched by {auction.matched_team_name}. Awaiting commissioner award.</p>}
            {matchOpen && <div className="space-y-2"><p className="text-sm">{auction.rfa_team_name ?? "Previous owner"} can match this contract.</p>
              <CountdownClock deadline={matchDeadline} now={now} label="Time left to match the contract" />
              {canMatch && (confirmMatch?.playerId === id && confirmMatch.offerId === choice
                ? <div className="space-y-2 border border-primary rounded-sm p-3"><p className="text-sm">Match the contract shown above? A commissioner will apply it to your team.</p>
                  <div className="flex gap-3"><button className={button} disabled={busy != null} onClick={async () => {
                    await act(id, {action:"match",playerId:Number(id),offerId:choice}); setConfirmMatch(null);
                  }}>Confirm match</button><button className="text-sm underline" disabled={busy != null} onClick={() => setConfirmMatch(null)}>Cancel</button></div>
                </div>
                : <button className={button} disabled={busy != null || !choice} onClick={() => setConfirmMatch({playerId:id,offerId:choice})}>Match contract</button>)}
            </div>}
            {canManage && <div className="flex flex-wrap gap-3">
              <button className={button} disabled={busy != null || !choice || waitingForMatch}
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

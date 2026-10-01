"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useUserTeam } from "@/lib/user-context";
import type { SleeperTradeView } from "@/lib/sleeper-trades";
import { TradeSummary } from "./TradeProposals";

export default function SleeperTrades({ onReview }: { onReview: (trade: SleeperTradeView) => void }) {
  const { teamName, isWhitelisted, isSubCommish, isLoading } = useUserTeam();
  const loggedIn = !!teamName || isWhitelisted || isSubCommish;
  const [trades, setTrades] = useState<SleeperTradeView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/trades/sleeper", { cache: "no-store" });
      const data = await res.json();
      if (!mounted.current) return;
      if (!res.ok) { setError(data.error ?? "Sleeper trades could not be checked."); return; }
      setTrades(data.trades);
      setCheckedAt(data.checkedAt);
      setError(null);
    } catch {
      if (mounted.current) setError("Sleeper trades could not be checked. Try refreshing shortly.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (isLoading || !loggedIn) return;
    mounted.current = true;
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("byf-trades-changed", refresh);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("byf-trades-changed", refresh);
    };
  }, [isLoading, loggedIn, load]);
  if (isLoading || !loggedIn) return null;
  return (
    <section className="mb-6 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Sleeper trades awaiting processing</h2>
        <button onClick={() => void load()} disabled={busy} className="text-sm underline disabled:opacity-40">
          {busy ? "Checking…" : "Refresh"}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-cap-over">{error}{checkedAt ? " Previous results may be out of date." : ""}</p>}
      {!error && !busy && trades.length === 0 && <p className="text-sm text-text-muted">No accepted trades waiting to process.</p>}
      {trades.length > 0 && <p className="text-sm text-text-muted">Cap checks assume $0 salary retained. Load a trade to enter agreed retention.</p>}
      {trades.map(t => (
        <div key={t.id} className="bg-surface border border-border rounded-sm p-4 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="text-text-dim">Accepted in Sleeper · awaiting processing</span>
            <span className={t.check === "valid" ? "text-cap-under" : t.check === "invalid" ? "text-cap-over" : "text-cap-yellow"}>
              {t.check === "valid" ? "Valid with $0 retention" : t.check === "invalid" ? "Invalid with $0 retention" : t.check === "ownership_updated" ? "Ownership already updated" : "Unable to check"}
            </span>
          </div>
          <TradeSummary trade={t} />
          {t.errors.length > 0 && <ul className="text-sm text-cap-over list-disc list-inside">{t.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
          {t.notes.map((n, i) => <p key={i} className="text-sm text-text-muted">{n}</p>)}
          {(t.check === "valid" || t.check === "invalid") && <button
            onClick={() => onReview(t)} disabled={!!error || busy}
            className="px-3 py-1.5 text-sm rounded-sm border border-border hover:bg-surface-light disabled:opacity-40"
          >Load in Trade Machine</button>}
        </div>
      ))}
      {checkedAt && <p className="text-xs text-text-dim">Last checked {new Date(checkedAt).toLocaleTimeString()}</p>}
    </section>
  );
}

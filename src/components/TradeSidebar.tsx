"use client";

import { TradeSummary, type TradeView } from "./TradeProposals";

interface TradeSidebarProps {
  trades: TradeView[];
  onClose: () => void;
  open: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Every approved trade, newest first. */
export default function TradeSidebar({ trades, onClose, open }: TradeSidebarProps) {
  if (!open) return null;

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/50 z-40" />
      <div className="fixed inset-y-0 right-0 w-full sm:w-[420px] max-w-full bg-surface border-l-2 border-text z-50 flex flex-col">
        <div className="card-head px-4 py-3 flex items-center justify-between gap-2">
          <h2 className="text-lg">Trade history</h2>
          <button onClick={onClose} aria-label="Close" className="text-white/70 hover:text-white text-2xl leading-none">
            &times;
          </button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {trades.length === 0 ? (
            <p className="byf-empty mt-8">No trades yet this season.</p>
          ) : (
            trades.map((trade) => (
              <div key={trade.id} className="p-4 space-y-2">
                <div className="text-xs text-text-dim">{formatDate(trade.decided_at ?? trade.created_at)}</div>
                <TradeSummary trade={trade} />
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

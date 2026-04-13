"use client";

import { ConfirmedTrade, formatSalary, getCurrentSalary } from "@/lib/types";

interface TradeSidebarProps {
  trades: ConfirmedTrade[];
  onClose: () => void;
  open: boolean;
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function TradeSidebar({ trades, onClose, open }: TradeSidebarProps) {
  if (!open) return null;

  return (
    <>
      {/* Backdrop on mobile to dim the page and let users tap-away to close */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 z-40 sm:hidden"
      />
      <div className="fixed inset-y-0 right-0 w-full sm:w-96 max-w-full bg-surface border-l border-border shadow-2xl z-50 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-bold text-lg">Confirmed Trades</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-text-muted hover:text-text p-1 text-2xl leading-none"
          >
            &times;
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {trades.length === 0 ? (
            <p className="text-text-dim text-sm text-center mt-8">
              No confirmed trades yet. Complete a valid trade to see it here.
            </p>
          ) : (
            trades.map((trade) => (
              <div key={trade.id} className="bg-surface-light rounded-lg border border-border p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-text-dim">{timeAgo(trade.timestamp)}</span>
                  <span className="text-xs text-cap-under font-medium">Valid</span>
                </div>
                {trade.teams
                  .filter((t) => t.playersOut.length > 0 || t.playersIn.length > 0)
                  .map((tradeTeam) => (
                    <div key={tradeTeam.team} className="mb-2 last:mb-0">
                      <div className="text-sm font-bold text-primary">{tradeTeam.team}</div>
                      {tradeTeam.playersOut.length > 0 && (
                        <div className="text-xs text-cap-over ml-2">
                          Sends: {tradeTeam.playersOut.map((p) => `${p.name} (${formatSalary(getCurrentSalary(p))})`).join(", ")}
                        </div>
                      )}
                      {tradeTeam.playersIn.length > 0 && (
                        <div className="text-xs text-cap-under ml-2">
                          Receives: {tradeTeam.playersIn.map((p) => `${p.name} (${formatSalary(getCurrentSalary(p))})`).join(", ")}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

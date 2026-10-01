"use client";

import { Player, formatSalary, getTeamTotalCap, getCapStatus, isDeadCap, isPick, pickOriginalTeam, getCurrentSalary } from "@/lib/types";

/** Salary column: picks carry no salary until drafted. */
const salaryText = (p: Player) => (isPick(p) ? "pick" : formatSalary(getCurrentSalary(p)));

interface TeamTradeColumnProps {
  teamName: string;
  allTeams: string[];
  teamPlayers: Player[];
  playersOut: Player[];
  playersIn: Player[];
  otherTeamsInTrade: string[];
  destinationMap: Record<string, string>;
  retainedSalary: number;
  incomingRetained: number;
  onTeamChange: (team: string) => void;
  onAddPlayerOut: (player: Player) => void;
  onRemovePlayerOut: (player: Player) => void;
  onSetDestination: (playerName: string, destTeam: string) => void;
  onRetainedChange: (amount: number) => void;
  onRemove: () => void;
  canRemove: boolean;
  /** Power rating (1-100) by team name, shown next to each pick's original team. */
  power?: Record<string, number>;
}

export default function TeamTradeColumn({
  teamName, allTeams, teamPlayers, playersOut, playersIn, otherTeamsInTrade,
  destinationMap, retainedSalary, incomingRetained, onTeamChange, onAddPlayerOut, onRemovePlayerOut, onSetDestination,
  onRetainedChange, onRemove, canRemove, power = {},
}: TeamTradeColumnProps) {
  const currentCap = getTeamTotalCap(teamPlayers);
  const capStatus = getCapStatus(currentCap);
  const outSalary = playersOut.reduce((s, p) => s + (getCurrentSalary(p) || 0), 0);
  const inSalary = playersIn.reduce((s, p) => s + (getCurrentSalary(p) || 0), 0);
  // Retained salary stays on this team as dead cap; incoming retained = discount from other teams
  const newCap = currentCap - outSalary + retainedSalary + inSalary - incomingRetained;
  // Retention only applies to real player salary, not Dead Cap
  const realOutSalary = playersOut.filter((p) => !isDeadCap(p)).reduce((s, p) => s + (getCurrentSalary(p) || 0), 0);
  const maxRetention = Math.floor(realOutSalary * 0.25);

  const capColors = { under: "text-cap-under", yellow: "text-cap-yellow", over: "text-cap-over" };
  const available = teamPlayers.filter((p) => !playersOut.some((out) => out.name === p.name));
  const availablePlayers = available
    .filter((p) => !isPick(p))
    .sort((a, b) => (getCurrentSalary(b) || 0) - (getCurrentSalary(a) || 0));
  // teamPlayers arrives with picks in draft order.
  const availablePicks = available.filter(isPick);
  const showDestPicker = otherTeamsInTrade.length > 1;

  return (
    <div className="bg-surface rounded-sm border border-border flex flex-col">
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <select
            value={teamName}
            onChange={(e) => onTeamChange(e.target.value)}
            className="bg-surface-light text-text border border-border rounded-sm px-3 py-1.5 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Select Team</option>
            {allTeams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {canRemove && (
            <button onClick={onRemove} className="text-text-dim hover:text-danger text-sm px-2">Remove</button>
          )}
        </div>
        {teamName && (
          <div className="flex justify-between text-xs mt-1">
            <span className="text-text-muted">
              Cap: <span className={capColors[capStatus]}>{formatSalary(currentCap)}</span>
            </span>
            <span className="text-text-muted">
              After: <span className={capColors[getCapStatus(newCap)]}>{formatSalary(newCap)}</span>
            </span>
          </div>
        )}
      </div>

      {teamName && (
        <>
          <div className="p-3 border-b border-border">
            <h3 className="text-lg text-cap-over mb-1">
              Sending Out ({formatSalary(outSalary)})
            </h3>
            {playersOut.length === 0 ? (
              <p className="text-text-dim text-xs">Nothing selected</p>
            ) : (
              <div className="space-y-1.5">
                {playersOut.map((p) => {
                  const destKey = `${teamName}:${p.name}`;
                  const currentDest = destinationMap[destKey] || "";
                  return (
                    <div key={p.name} className="bg-cap-over/10 rounded px-2 py-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span>{p.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-text-muted font-mono text-xs">{salaryText(p)}</span>
                          <button onClick={() => onRemovePlayerOut(p)} className="text-text-dim hover:text-danger text-xs">&times;</button>
                        </div>
                      </div>
                      {showDestPicker && (
                        <div className="mt-1">
                          <select
                            value={currentDest}
                            onChange={(e) => {
                              e.stopPropagation();
                              onSetDestination(p.name, e.target.value);
                            }}
                            className="w-full bg-surface border border-border rounded px-2 py-0.5 text-xs text-text-muted focus:outline-none focus:ring-1 focus:ring-primary"
                          >
                            <option value="">Send to...</option>
                            {otherTeamsInTrade.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {playersOut.length > 0 && maxRetention > 0 && (
              <div className="mt-3 pt-3 border-t border-border/50">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text-dim">Salary Retained</span>
                  <span className="font-mono font-bold text-cap-yellow">
                    {retainedSalary > 0 ? formatSalary(retainedSalary) : "None"}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={maxRetention}
                  step={1_000_000}
                  value={retainedSalary}
                  onChange={(e) => onRetainedChange(parseInt(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-text-dim mt-0.5">
                  <span>0%</span>
                  <span>Max 25% ({formatSalary(maxRetention)})</span>
                </div>
              </div>
            )}
          </div>

          <div className="p-3 border-b border-border">
            <h3 className="text-lg text-cap-under mb-1">
              Receiving ({formatSalary(inSalary - incomingRetained)})
            </h3>
            {playersIn.length === 0 ? (
              <p className="text-text-dim text-xs">Players and picks sent here by other teams will appear</p>
            ) : (
              <div className="space-y-1">
                {playersIn.map((p) => (
                  <div key={p.name} className="flex items-center justify-between bg-cap-under/10 rounded px-2 py-1 text-sm">
                    <span>{p.name}</span>
                    <span className="text-text-muted font-mono text-xs">{salaryText(p)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-3 flex-1 overflow-y-auto max-h-64">
            <h3 className="text-lg text-text mb-1">Roster</h3>
            <div className="space-y-0.5">
              {availablePlayers.map((p) => (
                <button
                  key={p.name}
                  onClick={() => onAddPlayerOut(p)}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded text-sm hover:bg-surface-light transition-colors text-left"
                >
                  <span>{p.name}</span>
                  <span className="text-text-dim font-mono text-xs">{formatSalary(getCurrentSalary(p))}</span>
                </button>
              ))}
            </div>
            {availablePicks.length > 0 && (
              <>
                <h3 className="text-lg text-text mt-3 mb-1">Draft Picks</h3>
                <div className="space-y-0.5">
                  {availablePicks.map((p) => (
                    <button
                      key={p.name}
                      onClick={() => onAddPlayerOut(p)}
                      className="w-full flex items-center justify-between px-2 py-1.5 rounded text-sm hover:bg-surface-light transition-colors text-left"
                    >
                      <span>{p.name}</span>
                      <span className="text-text-dim font-mono text-xs" title="Original team's power rating (1-100). Lower = earlier pick.">
                        PWR {power[pickOriginalTeam(p)] ?? "–"}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

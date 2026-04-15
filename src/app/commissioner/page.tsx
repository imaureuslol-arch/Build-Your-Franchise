"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback } from "react";
import { useUserTeam } from "@/lib/user-context";
import { usePlayers } from "@/lib/hooks";
import { Player, formatSalary, getCurrentSalary } from "@/lib/types";

interface PlayerValues {
  [id: number]: { fairValue: number; age: number };
}

const COMMISH_PASSWORD = "BYFCommish";

export default function CommissionerPage() {
  const { isWhitelisted, isSubCommish, isLoading: teamLoading } = useUserTeam();
  const { players, loading: playersLoading } = usePlayers();
  const [values, setValues] = useState<PlayerValues>({});
  const [valuesLoading, setValuesLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [editPts, setEditPts] = useState("");
  const [editReb, setEditReb] = useState("");
  const [editAst, setEditAst] = useState("");
  const [editStl, setEditStl] = useState("");
  const [editBlk, setEditBlk] = useState("");
  const [editTov, setEditTov] = useState("");
  const [editFg3m, setEditFg3m] = useState("");
  const [editAge, setEditAge] = useState("");
  const [editGp, setEditGp] = useState("");
  const [editFppg, setEditFppg] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [passwordError, setPasswordError] = useState(false);

  const [loggedInUsers, setLoggedInUsers] = useState<{ team_name: string; ip_count: number }[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [loggingOut, setLoggingOut] = useState<string | null>(null);
  const [logoutMsg, setLogoutMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Super-commish-only: login history and banned IPs
  type LoginRow = { id: number; ip: string; team_name: string; user_agent: string | null; created_at: string };
  type BanRow = { ip: string; reason: string | null; banned_at: string };
  const [loginHistory, setLoginHistory] = useState<LoginRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showSuspiciousOnly, setShowSuspiciousOnly] = useState(false);
  const [bans, setBans] = useState<BanRow[]>([]);
  const [bansLoading, setBansLoading] = useState(false);
  const [banBusy, setBanBusy] = useState<string | null>(null);
  const [banMsg, setBanMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Higher/lower guessing game state
  const [gamePair, setGamePair] = useState<[Player, Player] | null>(null);
  const [gameReveal, setGameReveal] = useState<"left" | "right" | null>(null);
  const [gameStreak, setGameStreak] = useState(0);
  const [gameBest, setGameBest] = useState(0);

  useEffect(() => {
    fetch("/api/player-values")
      .then((r) => r.json())
      .then((d) => setValues(d.values ?? {}))
      .catch(() => {})
      .finally(() => setValuesLoading(false));
  }, []);

  async function fetchLoggedInUsers() {
    setUsersLoading(true);
    try {
      const res = await fetch("/api/commissioner/logout-user");
      const data = await res.json();
      if (res.ok) setLoggedInUsers(data.users ?? []);
    } catch {
      /* silent */
    } finally {
      setUsersLoading(false);
    }
  }

  useEffect(() => {
    // Logged-in users is super-commish only, so only fetch for whitelisted IPs.
    if (isWhitelisted) fetchLoggedInUsers();
  }, [isWhitelisted]);

  async function fetchLoginHistory() {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/commissioner/login-history");
      const data = await res.json();
      if (res.ok) setLoginHistory(data.history ?? []);
    } catch {
      /* silent */
    } finally {
      setHistoryLoading(false);
    }
  }

  async function fetchBans() {
    setBansLoading(true);
    try {
      const res = await fetch("/api/commissioner/banned-ips");
      const data = await res.json();
      if (res.ok) setBans(data.bans ?? []);
    } catch {
      /* silent */
    } finally {
      setBansLoading(false);
    }
  }

  useEffect(() => {
    if (isWhitelisted) {
      fetchLoginHistory();
      fetchBans();
    }
  }, [isWhitelisted]);

  async function handleBanIp(ip: string) {
    const reason = prompt(`Ban ${ip}? Optional reason:`);
    if (reason === null) return;
    setBanBusy(ip);
    setBanMsg(null);
    try {
      const res = await fetch("/api/commissioner/banned-ips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, reason: reason || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ban failed");
      setBanMsg({ type: "ok", text: `Banned ${ip}.` });
      fetchBans();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ban failed";
      setBanMsg({ type: "err", text: msg });
    } finally {
      setBanBusy(null);
    }
  }

  async function handleUnbanIp(ip: string) {
    if (!confirm(`Unban ${ip}?`)) return;
    setBanBusy(ip);
    setBanMsg(null);
    try {
      const res = await fetch("/api/commissioner/banned-ips", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unban failed");
      setBanMsg({ type: "ok", text: `Unbanned ${ip}.` });
      fetchBans();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unban failed";
      setBanMsg({ type: "err", text: msg });
    } finally {
      setBanBusy(null);
    }
  }

  async function handleLogOutUser(teamName: string) {
    if (!confirm(`Log out ${teamName}? This removes all IP mappings for that team.`)) return;
    setLoggingOut(teamName);
    setLogoutMsg(null);
    try {
      const res = await fetch("/api/commissioner/logout-user", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_name: teamName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Log out failed");
      setLogoutMsg({ type: "ok", text: `Logged out ${teamName} (${data.removed} IPs removed).` });
      fetchLoggedInUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Log out failed";
      setLogoutMsg({ type: "err", text: msg });
    } finally {
      setLoggingOut(null);
    }
  }

  const newGameRound = useCallback(() => {
    const pool = players.filter((p) => p.name !== "Dead Cap" && values[p.id] != null);
    if (pool.length < 2) return;
    const a = Math.floor(Math.random() * pool.length);
    let b = Math.floor(Math.random() * pool.length);
    while (b === a) b = Math.floor(Math.random() * pool.length);
    setGamePair([pool[a], pool[b]]);
    setGameReveal(null);
  }, [players, values]);

  useEffect(() => {
    const stored = parseInt(localStorage.getItem("commishGameBest") ?? "0", 10);
    if (!isNaN(stored)) setGameBest(stored);
  }, []);

  useEffect(() => {
    if (gamePair == null && players.length > 0 && Object.keys(values).length >= 2) {
      newGameRound();
    }
  }, [gamePair, players, values, newGameRound]);

  const loading = teamLoading || playersLoading || valuesLoading;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Password gate — skipped for whitelisted commissioner IPs and sub-commish IPs
  if (!authenticated && !isWhitelisted && !isSubCommish) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="bg-surface border border-border rounded-xl p-6 w-full max-w-sm space-y-4">
          <h1 className="text-xl font-bold text-text text-center">Commissioner Tools</h1>
          <p className="text-sm text-text-muted text-center">Enter the commissioner password to continue.</p>
          <input
            type="password"
            value={passwordInput}
            onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (passwordInput === COMMISH_PASSWORD) setAuthenticated(true);
                else setPasswordError(true);
              }
            }}
            placeholder="Password"
            className="w-full px-4 py-3 rounded-lg bg-background border border-border text-text placeholder:text-text-dim focus:outline-none focus:border-primary"
          />
          {passwordError && (
            <p className="text-sm text-danger text-center">Incorrect password.</p>
          )}
          <button
            type="button"
            onClick={() => {
              if (passwordInput === COMMISH_PASSWORD) setAuthenticated(true);
              else setPasswordError(true);
            }}
            className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors"
          >
            Enter
          </button>
        </div>
      </div>
    );
  }

  // Search filtering
  const query = searchQuery.trim().toLowerCase();
  const filtered = query.length >= 2
    ? players.filter((p) => p.name.toLowerCase().includes(query)).slice(0, 15)
    : [];

  function selectPlayer(p: Player) {
    setSelectedPlayer(p);
    setSearchQuery(p.name);
    setSaveMsg(null);
    const v = values[p.id];
    // Clear stat fields — commish enters per-game stats fresh
    setEditPts("");
    setEditReb("");
    setEditAst("");
    setEditStl("");
    setEditBlk("");
    setEditTov("");
    setEditFg3m("");
    setEditFppg("");
    setEditGp(p.avg_gp != null ? String(p.avg_gp) : "");
    setEditAge(v?.age != null ? String(v.age) : "");
  }

  function birthdateFromAge(age: number): string {
    // Approximate: set birthdate to today minus `age` years
    const now = new Date();
    const y = now.getFullYear() - age;
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // Same formula as scripts/populate-stats.mjs
  function calcFantasyPpg(): number | null {
    const pts = parseFloat(editPts);
    const reb = parseFloat(editReb);
    const ast = parseFloat(editAst);
    const stl = parseFloat(editStl);
    const blk = parseFloat(editBlk);
    const tov = parseFloat(editTov);
    const fg3m = parseFloat(editFg3m);
    if ([pts, reb, ast, stl, blk, tov, fg3m].some((v) => isNaN(v))) return null;
    const raw = pts * 0.6 + reb * 0.9 + ast * 1 + stl * 2 + blk * 2.5 + fg3m * 0.5 - tov * 1;
    return Math.round(raw * 10) / 10;
  }

  const computedFppg = calcFantasyPpg();
  // Manual FPPG overrides the per-stat calc when filled. Lets the commish
  // enter FPPG directly (or total ÷ GP) without filling every breakdown field.
  const manualFppg = editFppg.trim() ? parseFloat(editFppg) : null;
  const effectiveFppg =
    manualFppg != null && !isNaN(manualFppg) ? manualFppg : computedFppg;

  async function handleSave() {
    if (!selectedPlayer) return;
    setSaving(true);
    setSaveMsg(null);

    const ppg = effectiveFppg;
    const avg_gp = editGp.trim() ? parseFloat(editGp) : null;
    const age = editAge.trim() ? parseInt(editAge, 10) : null;
    const birthdate = age != null ? birthdateFromAge(age) : undefined;

    try {
      const res = await fetch("/api/commissioner/update-player", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: selectedPlayer.id,
          ppg,
          avg_gp,
          birthdate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      setSaveMsg({ type: "ok", text: "Player updated successfully." });

      // Refresh values
      const vRes = await fetch("/api/player-values");
      const vData = await vRes.json();
      if (vRes.ok) setValues(vData.values ?? {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Update failed";
      setSaveMsg({ type: "err", text: msg });
    } finally {
      setSaving(false);
    }
  }

  const sv = selectedPlayer ? values[selectedPlayer.id] : null;

  const rankedByFairValue = players
    .filter((p) => p.name !== "Dead Cap" && values[p.id] != null)
    .map((p) => ({ player: p, ...values[p.id] }))
    .sort((a, b) => b.fairValue - a.fairValue);

  function handleGameGuess(side: "left" | "right") {
    if (!gamePair || gameReveal) return;
    const [left, right] = gamePair;
    const leftFv = values[left.id]?.fairValue ?? 0;
    const rightFv = values[right.id]?.fairValue ?? 0;
    const higher = leftFv >= rightFv ? "left" : "right";
    setGameReveal(side);
    const correct = side === higher;
    if (correct) {
      const next = gameStreak + 1;
      setGameStreak(next);
      if (next > gameBest) {
        setGameBest(next);
        localStorage.setItem("commishGameBest", String(next));
      }
    } else {
      setGameStreak(0);
    }
  }

  const teamStrength = (() => {
    const totals = new Map<string, { total: number; count: number }>();
    for (const p of players) {
      if (p.name === "Dead Cap") continue;
      if (!p.team || p.team === "Free Agency") continue;
      const fv = values[p.id]?.fairValue ?? 0;
      const entry = totals.get(p.team) ?? { total: 0, count: 0 };
      entry.total += fv;
      entry.count += 1;
      totals.set(p.team, entry);
    }
    return Array.from(totals.entries())
      .map(([team, { total, count }]) => ({ team, total, count }))
      .sort((a, b) => b.total - a.total);
  })();
  const maxTeamTotal = Math.max(1, ...teamStrength.map((t) => t.total));

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 flex flex-col lg:flex-row gap-6">
      <div className="flex-1 min-w-0 space-y-8">
      <h1 className="text-2xl font-bold text-text">Commissioner Tools</h1>

      {/* Higher or Lower game */}
      {gamePair && (
        <section className="bg-surface border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider">
                Higher or Lower
              </h3>
              <p className="text-xs text-text-dim mt-0.5">
                Who has the higher value?
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-text-muted">
                Streak <span className="text-accent font-bold text-base ml-1">{gameStreak}</span>
              </span>
              <span className="text-text-muted">
                Best <span className="text-text font-bold text-base ml-1">{gameBest}</span>
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(["left", "right"] as const).map((side) => {
              const p = side === "left" ? gamePair[0] : gamePair[1];
              const fv = values[p.id]?.fairValue ?? 0;
              const otherFv =
                (side === "left"
                  ? values[gamePair[1].id]?.fairValue
                  : values[gamePair[0].id]?.fairValue) ?? 0;
              const isHigher = fv >= otherFv;
              const picked = gameReveal === side;
              let stateClass = "border-border hover:border-primary/60 hover:bg-surface-light/50";
              if (gameReveal) {
                if (isHigher) stateClass = "border-cap-under bg-cap-under/10";
                else if (picked) stateClass = "border-cap-over bg-cap-over/10";
                else stateClass = "border-border opacity-60";
              }
              return (
                <button
                  key={side}
                  type="button"
                  disabled={!!gameReveal}
                  onClick={() => handleGameGuess(side)}
                  className={`border rounded-xl px-4 py-5 text-left transition-colors ${stateClass}`}
                >
                  <div className="text-xs text-text-dim truncate">{p.team}</div>
                  <div className="text-lg font-bold text-text truncate">{p.name}</div>
                  {gameReveal ? (
                    <div className="text-2xl font-bold text-accent mt-2 font-mono">
                      ${fv}M
                    </div>
                  ) : (
                    <div className="text-2xl font-bold text-text-dim mt-2 font-mono">?</div>
                  )}
                </button>
              );
            })}
          </div>
          {gameReveal && (
            <button
              type="button"
              onClick={newGameRound}
              className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors"
            >
              Next Round
            </button>
          )}
        </section>
      )}

      {/* Search */}
      <section className="space-y-3">
        <label className="block text-sm text-text-muted">Search Player</label>
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (selectedPlayer && e.target.value !== selectedPlayer.name) {
                setSelectedPlayer(null);
                setSaveMsg(null);
              }
            }}
            placeholder="Type a player name..."
            className="w-full px-4 py-3 rounded-lg bg-surface border border-border text-text placeholder:text-text-dim focus:outline-none focus:border-primary"
          />
          {filtered.length > 0 && !selectedPlayer && (
            <ul className="absolute z-20 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg max-h-60 overflow-y-auto">
              {filtered.map((p) => {
                const pv = values[p.id];
                const missingStats = !pv;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => selectPlayer(p)}
                      className="w-full text-left px-4 py-2.5 hover:bg-surface-light transition-colors flex items-center justify-between gap-2"
                    >
                      <span className="text-text">{p.name}</span>
                      <span className="flex items-center gap-3 text-xs text-text-muted">
                        <span>{p.team}</span>
                        {missingStats && (
                          <span className="text-warning font-semibold">MISSING STATS</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Selected Player Card */}
      {selectedPlayer && (
        <section className="bg-surface border border-border rounded-xl p-6 space-y-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-xl font-bold text-text">{selectedPlayer.name}</h2>
              <p className="text-sm text-text-muted mt-1">
                {selectedPlayer.team} &middot; Salary: {formatSalary(getCurrentSalary(selectedPlayer))}
              </p>
            </div>
            {sv && (
              <div className="text-right">
                <p className="text-sm text-text-muted">Fair Value</p>
                <p className="text-2xl font-bold text-accent">${sv.fairValue}M</p>
                <p className="text-xs text-text-dim mt-0.5">Age {sv.age}</p>
              </div>
            )}
            {!sv && (
              <div className="text-right">
                <p className="text-sm text-warning font-semibold">No fair value</p>
                <p className="text-xs text-text-dim">Fill in stats below to generate</p>
              </div>
            )}
          </div>

          {/* Edit Form */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider">
              Edit Player Stats
            </h3>
            <p className="text-xs text-text-dim">
              Enter per-game stats — FPPG auto-calcs. Or type FPPG directly (or
              total fantasy points ÷ GP) to skip the breakdown.
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {([
                ["PTS", editPts, setEditPts, "22.5"],
                ["REB", editReb, setEditReb, "8.0"],
                ["AST", editAst, setEditAst, "5.0"],
                ["STL", editStl, setEditStl, "1.2"],
                ["BLK", editBlk, setEditBlk, "0.8"],
                ["TOV", editTov, setEditTov, "2.5"],
                ["3PM", editFg3m, setEditFg3m, "1.5"],
              ] as [string, string, (v: string) => void, string][]).map(([label, val, setter, ph]) => (
                <div key={label}>
                  <label className="block text-xs text-text-dim mb-1">{label}</label>
                  <input
                    type="number"
                    step="0.1"
                    value={val}
                    onChange={(e) => setter(e.target.value)}
                    placeholder={ph}
                    className="w-full px-3 py-2 rounded-lg bg-background border border-border text-text placeholder:text-text-dim focus:outline-none focus:border-primary"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs text-text-dim mb-1">FPPG</label>
                <input
                  type="number"
                  step="0.1"
                  value={editFppg}
                  onChange={(e) => setEditFppg(e.target.value)}
                  placeholder={computedFppg != null ? String(computedFppg) : "—"}
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-accent font-semibold placeholder:text-accent/40 placeholder:font-normal focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
              <div>
                <label className="block text-xs text-text-dim mb-1">Age</label>
                <input
                  type="number"
                  value={editAge}
                  onChange={(e) => setEditAge(e.target.value)}
                  placeholder="e.g. 25"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-text placeholder:text-text-dim focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-xs text-text-dim mb-1">Avg GP</label>
                <input
                  type="number"
                  step="1"
                  value={editGp}
                  onChange={(e) => setEditGp(e.target.value)}
                  placeholder="e.g. 72"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-text placeholder:text-text-dim focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Stats"}
              </button>
              {saveMsg && (
                <span
                  className={`text-sm ${saveMsg.type === "ok" ? "text-cap-under" : "text-danger"}`}
                >
                  {saveMsg.text}
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Players Missing Stats */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider">
          Players Missing Stats
        </h3>
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          {(() => {
            const missing = players.filter((p) => p.name !== "Dead Cap" && !values[p.id]);
            if (missing.length === 0) {
              return (
                <p className="px-4 py-6 text-sm text-text-dim text-center">
                  All players have stats populated.
                </p>
              );
            }
            return (
              <ul className="divide-y divide-border max-h-72 overflow-y-auto">
                {missing.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        selectPlayer(p);
                        setSearchQuery(p.name);
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-surface-light transition-colors flex items-center justify-between gap-2"
                    >
                      <span className="text-text text-sm">{p.name}</span>
                      <span className="text-xs text-text-dim">{p.team}</span>
                    </button>
                  </li>
                ))}
              </ul>
            );
          })()}
        </div>
      </section>

      {/* Logged-In Users — super-commish (whitelisted IP) only */}
      {isWhitelisted && (
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider">
            Logged-In Users
          </h3>
          <button
            type="button"
            onClick={fetchLoggedInUsers}
            disabled={usersLoading}
            className="text-xs text-text-muted hover:text-text transition-colors disabled:opacity-50"
          >
            {usersLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {logoutMsg && (
          <p className={`text-sm ${logoutMsg.type === "ok" ? "text-cap-under" : "text-danger"}`}>
            {logoutMsg.text}
          </p>
        )}
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          {loggedInUsers.length === 0 ? (
            <p className="px-4 py-6 text-sm text-text-dim text-center">
              {usersLoading ? "Loading..." : "No users currently logged in."}
            </p>
          ) : (
            <ul className="divide-y divide-border max-h-72 overflow-y-auto">
              {loggedInUsers.map((u) => (
                <li
                  key={u.team_name}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div>
                    <span className="text-text text-sm font-medium">{u.team_name}</span>
                    <span className="text-xs text-text-dim ml-2">
                      {u.ip_count} IP{u.ip_count === 1 ? "" : "s"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleLogOutUser(u.team_name)}
                    disabled={loggingOut === u.team_name}
                    className="px-3 py-1.5 rounded-lg bg-danger/10 border border-danger/40 text-danger text-xs font-medium hover:bg-danger/20 transition-colors disabled:opacity-50"
                  >
                    {loggingOut === u.team_name ? "Logging out..." : "Log Out"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      )}

      {/* Login History — super-commish only */}
      {isWhitelisted && (
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider">
            Login History
          </h3>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={showSuspiciousOnly}
                onChange={(e) => setShowSuspiciousOnly(e.target.checked)}
                className="accent-primary"
              />
              IPs on &gt;1 team only
            </label>
            <button
              type="button"
              onClick={fetchLoginHistory}
              disabled={historyLoading}
              className="text-xs text-text-muted hover:text-text transition-colors disabled:opacity-50"
            >
              {historyLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          {(() => {
            const ipTeams = new Map<string, Set<string>>();
            for (const row of loginHistory) {
              if (!ipTeams.has(row.ip)) ipTeams.set(row.ip, new Set());
              ipTeams.get(row.ip)!.add(row.team_name);
            }
            const rows = showSuspiciousOnly
              ? loginHistory.filter((r) => (ipTeams.get(r.ip)?.size ?? 0) > 1)
              : loginHistory;
            const bannedSet = new Set(bans.map((b) => b.ip));
            if (rows.length === 0) {
              return (
                <p className="px-4 py-6 text-sm text-text-dim text-center">
                  {historyLoading ? "Loading..." : "No login history."}
                </p>
              );
            }
            return (
              <ul className="divide-y divide-border max-h-96 overflow-y-auto">
                {rows.map((row) => {
                  const teamCount = ipTeams.get(row.ip)?.size ?? 1;
                  const isSuspicious = teamCount > 1;
                  const isBanned = bannedSet.has(row.ip);
                  return (
                    <li
                      key={row.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs text-text">{row.ip}</span>
                          {isSuspicious && (
                            <span className="text-[10px] text-cap-over font-semibold uppercase tracking-wider">
                              {teamCount} teams
                            </span>
                          )}
                          {isBanned && (
                            <span className="text-[10px] text-danger font-semibold uppercase tracking-wider">
                              Banned
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-text-muted mt-0.5">
                          {row.team_name}
                          <span className="text-text-dim ml-2">
                            {new Date(row.created_at).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      {!isBanned && (
                        <button
                          type="button"
                          onClick={() => handleBanIp(row.ip)}
                          disabled={banBusy === row.ip}
                          className="px-3 py-1.5 rounded-lg bg-danger/10 border border-danger/40 text-danger text-xs font-medium hover:bg-danger/20 transition-colors disabled:opacity-50 shrink-0"
                        >
                          {banBusy === row.ip ? "..." : "Ban IP"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            );
          })()}
        </div>
      </section>
      )}

      {/* Banned IPs — super-commish only */}
      {isWhitelisted && (
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider">
            Banned IPs
          </h3>
          <button
            type="button"
            onClick={fetchBans}
            disabled={bansLoading}
            className="text-xs text-text-muted hover:text-text transition-colors disabled:opacity-50"
          >
            {bansLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {banMsg && (
          <p className={`text-sm ${banMsg.type === "ok" ? "text-cap-under" : "text-danger"}`}>
            {banMsg.text}
          </p>
        )}
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          {bans.length === 0 ? (
            <p className="px-4 py-6 text-sm text-text-dim text-center">
              {bansLoading ? "Loading..." : "No banned IPs."}
            </p>
          ) : (
            <ul className="divide-y divide-border max-h-72 overflow-y-auto">
              {bans.map((b) => (
                <li
                  key={b.ip}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs text-text">{b.ip}</div>
                    <div className="text-xs text-text-muted mt-0.5">
                      {b.reason || <span className="text-text-dim italic">No reason</span>}
                      <span className="text-text-dim ml-2">
                        {new Date(b.banned_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUnbanIp(b.ip)}
                    disabled={banBusy === b.ip}
                    className="px-3 py-1.5 rounded-lg bg-surface-light border border-border text-text-muted text-xs font-medium hover:text-text transition-colors disabled:opacity-50 shrink-0"
                  >
                    {banBusy === b.ip ? "..." : "Unban"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      )}
      </div>

      {/* Fair Value sidebar */}
      <aside className="lg:w-72 lg:shrink-0 space-y-4 lg:sticky lg:top-4 self-start">
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider">
              Team Strength
            </h3>
            <p className="text-xs text-text-dim mt-0.5">
              Sum of roster fair values
            </p>
          </div>
          <ul className="divide-y divide-border max-h-[50vh] overflow-y-auto">
            {teamStrength.map(({ team, total, count }, i) => {
              const pct = (total / maxTeamTotal) * 100;
              return (
                <li key={team} className="px-3 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-text-dim font-mono w-6 shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-sm text-text truncate flex-1 min-w-0">
                      {team}
                    </span>
                    <span className="text-sm font-bold text-accent shrink-0 font-mono">
                      ${Math.round(total)}M
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-surface-light rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent/60 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-text-dim w-8 text-right shrink-0">
                      {count} plr
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wider">
              Fair Value Rankings
            </h3>
            <p className="text-xs text-text-dim mt-0.5">
              {rankedByFairValue.length} players
            </p>
          </div>
          <ul className="divide-y divide-border max-h-[80vh] overflow-y-auto">
            {rankedByFairValue.map(({ player, fairValue, age }, i) => {
              const isSelected = selectedPlayer?.id === player.id;
              return (
                <li key={player.id}>
                  <button
                    type="button"
                    onClick={() => {
                      selectPlayer(player);
                      setSearchQuery(player.name);
                    }}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
                      isSelected ? "bg-primary/10" : "hover:bg-surface-light"
                    }`}
                  >
                    <span className="text-xs text-text-dim font-mono w-6 shrink-0">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-text truncate">{player.name}</div>
                      <div className="text-xs text-text-dim truncate">
                        {player.team} &middot; Age {age}
                      </div>
                    </div>
                    <span className="text-sm font-bold text-accent shrink-0 font-mono">
                      ${fairValue}M
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>
    </div>
  );
}

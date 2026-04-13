"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { useUserTeam } from "@/lib/user-context";
import { usePlayers } from "@/lib/hooks";
import { Player, formatSalary, getCurrentSalary } from "@/lib/types";

interface PlayerValues {
  [id: number]: { fairValue: number; age: number };
}

function isCommissioner(owner: { user_name: string; team_name: string } | null): boolean {
  return owner?.user_name === "Aureus" && owner?.team_name === "Athens Olympians";
}

export default function CommissionerPage() {
  const { owner, isLoading: teamLoading } = useUserTeam();
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
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/player-values")
      .then((r) => r.json())
      .then((d) => setValues(d.values ?? {}))
      .catch(() => {})
      .finally(() => setValuesLoading(false));
  }, []);

  const loading = teamLoading || playersLoading || valuesLoading;

  // Gate: block non-commissioners
  if (!loading && !isCommissioner(owner)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-text-muted text-lg">Access denied.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
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

  async function handleSave() {
    if (!selectedPlayer) return;
    setSaving(true);
    setSaveMsg(null);

    const ppg = computedFppg;
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

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <h1 className="text-2xl font-bold text-text">Commissioner Tools</h1>

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
              Enter per-game stats — FPPG is calculated automatically.
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
                <div className="w-full px-3 py-2 rounded-lg bg-surface-light border border-border text-accent font-semibold">
                  {computedFppg != null ? computedFppg : "—"}
                </div>
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
    </div>
  );
}

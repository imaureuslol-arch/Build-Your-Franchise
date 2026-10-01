"use client";

import { useCallback, useEffect, useState } from "react";
import Select from "./Select";
import { SALARY_YEARS, getCurrentSeasonYear } from "@/lib/types";
import { refreshLeague } from "@/lib/hooks";

interface Team { id: number; name: string }
interface ContractPlayer { id: number; name: string; teamId: number | null; contracts: Record<string, number> }
interface DeadCap { id: number; team_id: number; label: string; season: number; amount: number }
interface Book { players: ContractPlayer[]; teams: Team[]; deadCap: DeadCap[] }
const field = "w-full bg-background border border-border rounded-sm px-3 py-2 text-sm";
const button = "px-4 py-2 rounded-sm bg-primary text-white text-sm disabled:opacity-40";
const seasonLabel = (year: number) => `${year - 1}–${String(year).slice(2)}`;
const money = (amount: number) => amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function ContractManager() {
  const [book, setBook] = useState<Book | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const res = await fetch("/api/commissioner/contracts", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Could not load contracts.");
    setBook(data);
  }, []);
  useEffect(() => {
    // Fetch the protected contract book when this panel mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch(e => setError(e.message));
  }, [load]);
  async function save(path: string, body: unknown, message: string) {
    setError(""); setNotice("");
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Could not save.");
    await load();
    refreshLeague();
    setNotice(message);
  }
  const selected = book?.players.find(p => p.id === selectedId);
  const matches = query.trim() ? book?.players.filter(p => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 25) : [];
  return (
    <section className="space-y-4">
      <h2 className="text-2xl">Contracts &amp; Dead Cap</h2>
      {error && <p role="alert" className="text-sm text-cap-over">{error} <button className="underline" onClick={() => load().then(() => setError("")).catch(e => setError(e.message))}>Reload</button></p>}
      {notice && <p role="status" className="text-sm text-cap-under">{notice}</p>}
      {!book ? <p className="text-sm text-text-muted">Loading contracts…</p> : <>
        <details open className="border border-border bg-surface rounded-sm p-4 space-y-4">
          <summary className="cursor-pointer font-semibold">Correct a contract</summary>
          <label className="block text-sm">Find player
            <input className={field + " mt-1"} value={query} placeholder="Player name"
              onChange={e => { setQuery(e.target.value); setSelectedId(null); }} />
          </label>
          {!selected && <ul className="max-h-56 overflow-y-auto divide-y divide-border">
            {matches?.map(p => <li key={p.id}><button className="w-full py-2 text-left text-sm flex justify-between gap-3"
              onClick={() => { setSelectedId(p.id); setQuery(p.name); setNotice(""); }}>
              <span>{p.name}</span><span className="text-text-dim">{book.teams.find(t => t.id === p.teamId)?.name ?? "Free Agency"}</span>
            </button></li>)}
          </ul>}
          {selected && <ContractForm key={JSON.stringify(selected)} player={selected} teams={book.teams}
            save={body => save("/api/commissioner/contracts", body, "Contract saved. Roster and cap totals updated.")} />}
        </details>
        <DeadCapForm entries={book.deadCap} teams={book.teams}
          save={body => save("/api/commissioner/dead-cap", body, "Dead cap saved. Cap totals updated.")} />
      </>}
    </section>
  );
}

function ContractForm({ player, teams, save }: { player: ContractPlayer; teams: Team[]; save: (body: unknown) => Promise<void> }) {
  const [teamId, setTeamId] = useState(player.teamId == null ? "" : String(player.teamId));
  const [amounts, setAmounts] = useState<Record<string, string>>(Object.fromEntries(SALARY_YEARS.map(y => [y, player.contracts[y] == null ? "" : String(player.contracts[y] / 1e6)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    const contracts = Object.fromEntries(Object.entries(amounts).filter(([, value]) => value.trim() !== "")
      .map(([year, value]) => [year, Math.round(Number(value) * 1e6)]));
    if (Object.values(contracts).some(v => !Number.isSafeInteger(v) || v < 0)) { setError("Enter non-negative salary amounts."); return; }
    if (!teamId && Object.keys(contracts).length) { setError("Clear the salary fields before moving the player to free agency."); return; }
    setBusy(true);
    try { await save({ playerId: player.id, teamId: teamId ? Number(teamId) : null, contracts,
      expected: { teamId: player.teamId, contracts: player.contracts } }); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-4 border-t border-border pt-4">
    <h3 className="text-lg">{player.name}</h3>
    <label className="block text-sm">Team
      <Select className="mt-1" ariaLabel="Team" value={teamId} onChange={setTeamId}
        options={[{ value: "", label: "Free Agency" }, ...teams.map(t => ({ value: String(t.id), label: t.name }))]} />
    </label>
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      {SALARY_YEARS.map(y => <label key={y} className="text-xs text-text-muted">{seasonLabel(y)} · $M
        <input aria-label={`Salary ${seasonLabel(y)} in millions`} type="number" min="0" max="1000000" step="0.000001" className={field + " mt-1"}
          value={amounts[y]} onChange={e => setAmounts(prev => ({ ...prev, [y]: e.target.value }))} placeholder="No contract" />
      </label>)}
    </div>
    <p className="text-xs text-text-dim">Blank removes that season’s salary. Moving a player to free agency requires clearing these salaries. Add any release penalty separately under Dead Cap. These changes only affect this site.</p>
    {error && <p role="alert" className="text-sm text-cap-over">{error}</p>}
    <button className={button} disabled={busy}>{busy ? "Saving…" : "Save contract"}</button>
  </form>;
}

function DeadCapForm({ entries, teams, save }: { entries: DeadCap[]; teams: Team[]; save: (body: unknown) => Promise<void> }) {
  const [teamId, setTeamId] = useState(teams[0] ? String(teams[0].id) : "");
  const [editing, setEditing] = useState<DeadCap | null>(null);
  const [label, setLabel] = useState("");
  const [season, setSeason] = useState(getCurrentSeasonYear());
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState("charge");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function reset() { setEditing(null); setLabel(""); setAmount(""); setKind("charge"); setError(""); }
  function edit(entry: DeadCap) {
    setEditing(entry); setLabel(entry.label); setSeason(entry.season);
    setAmount(String(Math.abs(entry.amount) / 1e6)); setKind(entry.amount < 0 ? "credit" : "charge"); setError("");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      await save({ action: "save", id: editing?.id, expected: editing, teamId: Number(teamId), label, season,
        amount: Math.round(Number(amount) * 1e6) * (kind === "credit" ? -1 : 1) });
      reset();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(false); }
  }
  async function remove(entry: DeadCap) {
    if (!confirm(`Remove "${entry.label}" (${money(entry.amount)}) for ${seasonLabel(entry.season)}?`)) return;
    setBusy(true); setError("");
    try { await save({ action: "delete", id: entry.id, expected: entry }); if (editing?.id === entry.id) reset(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not remove entry."); }
    finally { setBusy(false); }
  }
  return <details className="border border-border bg-surface rounded-sm p-4 space-y-4">
    <summary className="cursor-pointer font-semibold">Dead Cap</summary>
    <label className="block text-sm">Team
      <Select className="mt-1" ariaLabel="Team" value={teamId} onChange={v => { setTeamId(v); reset(); }}
        options={teams.map(t => ({ value: String(t.id), label: t.name }))} />
    </label>
    <ul className="divide-y divide-border max-h-64 overflow-y-auto">
      {entries.filter(e => e.team_id === Number(teamId)).map(entry => <li key={entry.id} className="py-3 flex items-center justify-between gap-3 text-sm">
        <div className="min-w-0"><p className="break-words">{entry.label}</p><p className="text-xs text-text-muted">{seasonLabel(entry.season)} · {money(entry.amount)}</p></div>
        <div className="flex gap-3 shrink-0"><button disabled={busy} className="underline" onClick={() => edit(entry)}>Edit</button>
          <button disabled={busy} className="text-cap-over underline" onClick={() => remove(entry)}>Remove</button></div>
      </li>)}
      {!entries.some(e => e.team_id === Number(teamId)) && <li className="text-sm text-text-dim py-2">No dead cap for this team.</li>}
    </ul>
    <form onSubmit={submit} className="space-y-3 border-t border-border pt-4">
      <h3 className="text-lg">{editing ? "Edit dead cap" : "Add dead cap"}</h3>
      <label className="block text-sm">Label
        <input required maxLength={160} className={field + " mt-1"} value={label} onChange={e => setLabel(e.target.value)} placeholder="Player name / reason" />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="text-sm">Season<Select className="mt-1" ariaLabel="Season" value={String(season)} onChange={v => setSeason(Number(v))}
          options={SALARY_YEARS.map(y => ({ value: String(y), label: seasonLabel(y) }))} /></label>
        <label className="text-sm">Type<Select className="mt-1" ariaLabel="Type" value={kind} onChange={setKind}
          options={[{ value: "charge", label: "Charge" }, { value: "credit", label: "Retention credit" }]} /></label>
        <label className="text-sm">Amount · $M<input required type="number" min="0.000001" max="1000000" step="0.000001" className={field + " mt-1"} value={amount} onChange={e => setAmount(e.target.value)} /></label>
      </div>
      <p className="text-xs text-text-dim">Charges increase the team’s cap total. Retention credits reduce it.</p>
      {error && <p role="alert" className="text-sm text-cap-over">{error}</p>}
      <div className="flex gap-3"><button className={button} disabled={busy}>{busy ? "Saving…" : editing ? "Save dead cap" : "Add dead cap"}</button>
        {editing && <button type="button" onClick={reset} className="text-sm underline">Cancel edit</button>}</div>
    </form>
  </details>;
}

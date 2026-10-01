"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Select from "@/components/Select";
import { usePlayers } from "@/lib/hooks";
import { useUserTeam } from "@/lib/user-context";
import { Player, FREE_AGENCY_TEAM, formatSalary, getCurrentSalary, isDeadCap, isPick } from "@/lib/types";
import { findTrades, FinderFilters, PlayerRule, ScoutInfo, SearchProgress, TradeMatch } from "@/lib/trade-finder";
import type { PickValue } from "@/lib/pick-value";
import { pickProjectionDescription } from "@/components/PickBadge";
import "./finder.css";

type PickInfo = PickValue;
const defaults: FinderFilters = { playersMin: 1, playersMax: 2, picksMin: 0, picksMax: 0, pickRound: "any", salaryMax: 80000000, valueTolerance: .25, rules: [], sort: "value" };
const options = (values: number[], suffix = "") => values.map((n) => ({ value: String(n), label: `${n}${suffix}` }));
const positions = ["PG", "SG", "SF", "PF", "C"];

export default function TradeFinderPage() {
  const { players, loading } = usePlayers();
  const { teamName, isLoading: identityLoading } = useUserTeam();
  const router = useRouter();
  const [chosenTeam, setChosenTeam] = useState("");
  const team = chosenTeam || teamName || "";
  const [info, setInfo] = useState<Record<number, ScoutInfo>>({});
  const [picks, setPicks] = useState<Player[]>([]);
  const [pickInfo, setPickInfo] = useState<Record<number, PickInfo>>({});
  const [positionsAvailable, setPositionsAvailable] = useState(true);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [offerIds, setOfferIds] = useState<number[]>([]);
  const [tab, setTab] = useState("players");
  const [rosterSearch, setRosterSearch] = useState("");
  const [filters, setFilters] = useState<FinderFilters>(defaults);
  const [preset, setPreset] = useState("custom");
  const [results, setResults] = useState<TradeMatch[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState<SearchProgress | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
  const nextRule = useRef(1);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setDataLoading(true); setError("");
      try {
        const responses = await Promise.all(["/api/trade-finder", "/api/picks"].map((url) => fetch(url, { signal: controller.signal })));
        if (responses.some((r) => !r.ok)) throw new Error("Trade Finder data could not be loaded. Please retry.");
        const [scouts, draft] = await Promise.all(responses.map((r) => r.json()));
        if (controller.signal.aborted) return;
        setInfo(scouts.players); setPositionsAvailable(scouts.positionsAvailable);
        setPicks(draft.picks); setPickInfo(draft.values ?? {});
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load trade data."); }
      finally { if (!controller.signal.aborted) setDataLoading(false); }
    }
    void load(); return () => controller.abort();
  }, [retry]);
  useEffect(() => () => searchAbort.current?.abort(), []);

  const teams = useMemo(() => [...new Set(players.filter((p) => p.team && p.team !== FREE_AGENCY_TEAM).map((p) => p.team))].sort(), [players]);
  const roster = useMemo(() => [...players.filter((p) => p.team === team && !isDeadCap(p)), ...picks.filter((p) => p.team === team)], [players, picks, team]);
  const offer = roster.filter((p) => offerIds.includes(p.id));
  const valueOf = (p: Player) => isPick(p) ? pickInfo[p.id]?.fairValue : info[p.id]?.fairValue;
  const offerValue = offer.reduce((n, p) => n + (valueOf(p) ?? 0), 0);
  const offerSalary = offer.reduce((n, p) => n + (getCurrentSalary(p) ?? 0), 0);
  const visibleAssets = roster.filter((p) => (tab === "picks" ? isPick(p) : !isPick(p)) && p.name.toLowerCase().includes(rosterSearch.toLowerCase()));
  const ready = !loading && !identityLoading && !dataLoading && !error;

  function invalidate() { searchAbort.current?.abort(); setSearching(false); setSearched(false); setResults([]); setProgress(null); }
  function updateFilters(update: Partial<FinderFilters>) { invalidate(); setPreset("custom"); setFilters((f) => ({ ...f, ...update })); }
  function updateRule(id: number, update: Partial<PlayerRule>) { updateFilters({ rules: filters.rules.map((r) => r.id === id ? { ...r, ...update } : r) }); }
  function applyPreset(value: string) {
    invalidate(); setPreset(value);
    const rule = (ageUnder: number | null, fppgOver: number | null): PlayerRule => ({ id: nextRule.current++, count: 1, position: "any", ageUnder, fppgOver });
    if (value === "young") setFilters({ ...defaults, playersMin: 2, playersMax: 3, salaryMax: 30000000, rules: [rule(25, 15)] });
    else if (value === "win") setFilters({ ...defaults, rules: [rule(null, 30)] });
    else if (value === "draft") setFilters({ ...defaults, playersMin: 0, playersMax: 1, picksMin: 1, picksMax: 2 });
    else setFilters(defaults);
  }
  async function search() {
    searchAbort.current?.abort(); const controller = new AbortController(); searchAbort.current = controller;
    setSearching(true); setSearched(false); setResults([]); setProgress(null);
    const iterator = findTrades(players, picks, info, pickInfo, team, offer, filters);
    while (!controller.signal.aborted) {
      const step = iterator.next();
      if (step.done) { setResults(step.value); setSearched(true); setSearching(false); break; }
      setProgress(step.value); await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  function openTrade(match: TradeMatch) {
    const query = new URLSearchParams({ team1: team, team1ids: offer.map((p) => p.id).join(","), team2: match.team, team2ids: match.assets.map((p) => p.id).join(",") });
    router.push(`/trades?${query}`);
  }
  function assetCard(p: Player, selectable: boolean) {
    const pick = isPick(p), selected = offerIds.includes(p.id), scout = info[p.id], valuation = valueOf(p);
    const content = <>
      <span className="finder-card-top"><span>{pick ? `${pickInfo[p.id]?.yearsAway ? "PROJ " : ""}PWR ${pickInfo[p.id]?.power ?? "—"}` : scout?.positions.join(" / ") || "PLAYER"}</span><span>{selectable ? (selected ? "✓ IN OFFER" : valuation == null ? "UNVALUED" : "+ ADD") : pick ? "PICK" : "PLAYER"}</span></span>
      <span className="finder-card-name">{p.name}</span>
      <span className="finder-card-stats">
        <span><small>{pick ? "PROJ. SLOT" : "FPPG"}</small><b>{pick ? `#${pickInfo[p.id]?.slot ?? "—"}` : p.ppg?.toFixed(1) ?? "—"}</b></span>
        <span><small>{pick ? "ROOKIE COST*" : "AGE"}</small><b>{pick ? formatSalary(pickInfo[p.id]?.salary ?? null) : scout?.age ?? "—"}</b></span>
        <span><small>COST</small><b>{pick ? "$0" : formatSalary(getCurrentSalary(p))}</b></span>
      </span>
      <span className="finder-card-value">VALUE <b>{valuation == null ? "Unavailable" : formatSalary(valuation * 1000000)}</b></span>
    </>;
    const description = pick && pickInfo[p.id] ? pickProjectionDescription(pickInfo[p.id]) : undefined;
    return selectable ? <button key={p.id} type="button" title={description} className={`finder-asset ${pick ? "finder-pick" : ""} ${selected ? "finder-selected" : ""}`} aria-pressed={selected} disabled={valuation == null || !ready} onClick={() => { invalidate(); setOfferIds((ids) => selected ? ids.filter((id) => id !== p.id) : [...ids, p.id]); }}>{content}</button>
      : <div key={p.id} title={description} className={`finder-asset ${pick ? "finder-pick" : ""}`}>{content}</div>;
  }
  const field = (label: string, value: string, onChange: (v: string) => void, opts: { value: string; label: string }[], ariaLabel = label) => <label className="finder-label">{label}<Select value={value} onChange={onChange} options={opts} ariaLabel={ariaLabel} /></label>;

  return <div className="finder-page">
    <div className="finder-title"><div><h1>Trade Finder</h1><p className="text-text-muted mt-3">Build your offer. Set your targets. Find the trade.</p></div><span className="finder-season-tag">PLAYERS + PICKS</span></div>
    <div className="finder-scoreboard" aria-label="Your offer totals">
      <div><small>YOUR OFFER</small><strong>{offer.filter((p) => !isPick(p)).length}<span> PLAYERS</span> + {offer.filter(isPick).length}<span> PICKS</span></strong></div>
      <div><small>CURRENT COST</small><strong>{formatSalary(offerSalary)}</strong></div>
      <div><small>TRADE VALUE</small><strong>{formatSalary(offerValue * 1000000)}</strong></div>
    </div>
    {error && <div className="finder-notice" role="alert">{error} <button type="button" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>}
    {!positionsAvailable && !dataLoading && <div className="finder-notice">Sleeper positions are unavailable. Position rules exclude players without position data. <button type="button" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>}
    {!loading && !players.length && <div className="finder-notice" role="alert">League rosters could not be loaded. <button type="button" onClick={() => window.location.reload()}>Reload</button></div>}
    <div className="finder-workbench">
      <section className="finder-panel">
        <div className="finder-panel-head"><span>01</span><h2>Your offer</h2><button type="button" disabled={!offer.length} onClick={() => { invalidate(); setOfferIds([]); }}>Clear</button></div>
        <div className="finder-panel-body">
          <Select value={team} onChange={(t) => { invalidate(); setChosenTeam(t); setOfferIds([]); setRosterSearch(""); }} options={teams.map((t) => ({ value: t, label: t }))} placeholder="Choose a team to search from" ariaLabel="Offering team" />
          <div className="finder-tabs" role="group" aria-label="Offer asset type">
            <button type="button" aria-pressed={tab === "players"} onClick={() => setTab("players")}>Players <span>{roster.filter((p) => !isPick(p)).length}</span></button>
            <button type="button" aria-pressed={tab === "picks"} onClick={() => setTab("picks")}>Draft picks <span>{roster.filter(isPick).length}</span></button>
          </div>
          <input aria-label="Search your assets" placeholder={tab === "picks" ? "Find a season or original team…" : "Find a player…"} value={rosterSearch} onChange={(e) => setRosterSearch(e.target.value)} className="finder-input" />
          {!!offer.length && <div className="finder-offer-tray" aria-label="Selected offer">{offer.map((p) => <button key={p.id} type="button" onClick={() => { invalidate(); setOfferIds((ids) => ids.filter((id) => id !== p.id)); }} aria-label={`Remove ${p.name} from offer`}>{p.name} <span>×</span></button>)}</div>}
          <div className="finder-roster">{!ready && !error ? <p className="finder-empty">Loading rosters, picks and scouting data…</p> : !team ? <p className="finder-empty">Choose a team, then tap cards to build an offer.</p> : !visibleAssets.length ? <p className="finder-empty">No {tab === "picks" ? "picks" : "players"} found.</p> : visibleAssets.map((p) => assetCard(p, true))}</div>
          {tab === "picks" && <p className="finder-footnote">PROJ PWR forecasts that draft year using the current roster&apos;s development, aging and retirement risk. Future value is discounted 20% per year beyond the next draft. *Rookie cost is projected; picks cost $0 now.</p>}
        </div>
      </section>
      <section className="finder-panel">
        <div className="finder-panel-head"><span>02</span><h2>Your targets</h2><button type="button" onClick={() => applyPreset("custom")}>Reset</button></div>
        <div className="finder-panel-body">
          {field("Quick setup", preset, applyPreset, [{ value: "custom", label: "Build your own" }, { value: "young", label: "Young depth · 2+ players / under $30M" }, { value: "win", label: "Win now · a player over 30 FPPG" }, { value: "draft", label: "Draft capital · 1–2 picks" }])}
          <div className="finder-filter-grid">
            {field("At least players", String(filters.playersMin), (v) => updateFilters({ playersMin: +v, playersMax: Math.max(+v, filters.playersMax) }), options([0,1,2,3,4]), "Minimum players")}
            {field("Up to players", String(filters.playersMax), (v) => updateFilters({ playersMax: +v, playersMin: Math.min(+v, filters.playersMin) }), options([0,1,2,3,4]), "Maximum players")}
            {field("At least picks", String(filters.picksMin), (v) => updateFilters({ picksMin: +v, picksMax: Math.max(+v, filters.picksMax) }), options([0,1,2,3]), "Minimum picks")}
            {field("Up to picks", String(filters.picksMax), (v) => updateFilters({ picksMax: +v, picksMin: Math.min(+v, filters.picksMin) }), options([0,1,2,3]), "Maximum picks")}
            {field("Pick round", filters.pickRound, (v) => updateFilters({ pickRound: v }), [{ value: "any", label: "Any round" }, { value: "1", label: "1st round only" }, { value: "2", label: "2nd round only" }])}
            {field("Total cost under", filters.salaryMax === null ? "any" : String(filters.salaryMax), (v) => updateFilters({ salaryMax: v === "any" ? null : +v }), [{ value: "any", label: "Any cost" }, ...[5,10,15,20,25,30,35,40,50,60,80,100,120,150,200].map((n) => ({ value: String(n * 1000000), label: `$${n}M` }))], "Total incoming cost under")}
          </div>
          <div className="finder-rules-heading"><h3>Player requirements</h3><button type="button" disabled={filters.rules.length >= 4 || filters.playersMax === 0} onClick={() => updateFilters({ rules: [...filters.rules, { id: nextRule.current++, count: 1, position: "any", ageUnder: null, fppgOver: null }] })}>+ Add rule</button></div>
          {!filters.rules.length && <p className="finder-footnote">Add a position, age or FPPG requirement. All conditions in a rule must hold for the same player.</p>}
          {filters.rules.map((r, index) => <fieldset className="finder-rule" key={r.id}>
            <legend>Rule {index + 1}</legend><button className="finder-remove-rule" type="button" aria-label={`Remove rule ${index + 1}`} onClick={() => updateFilters({ rules: filters.rules.filter((rule) => rule.id !== r.id) })}>×</button>
            <div className="finder-filter-grid">
              {field("At least", String(r.count), (v) => updateRule(r.id, { count: +v }), options([1,2,3,4], " player(s)"), `Rule ${index + 1} player count`)}
              {field("Position", r.position, (v) => updateRule(r.id, { position: v }), [{ value: "any", label: "Any position" }, ...positions.map((p) => ({ value: p, label: p }))], `Rule ${index + 1} position`)}
              {field("Younger than", r.ageUnder === null ? "any" : String(r.ageUnder), (v) => updateRule(r.id, { ageUnder: v === "any" ? null : +v }), [{ value: "any", label: "Any age" }, ...options(Array.from({ length: 23 }, (_, i) => i + 19), " years")], `Rule ${index + 1} age under`)}
              {field("FPPG higher than", r.fppgOver === null ? "any" : String(r.fppgOver), (v) => updateRule(r.id, { fppgOver: v === "any" ? null : +v }), [{ value: "any", label: "Any FPPG" }, ...options(Array.from({ length: 60 }, (_, i) => i + 1))], `Rule ${index + 1} FPPG over`)}
            </div>
            {r.count > filters.playersMax && <p className="finder-rule-warning">This rule needs more players than your package allows.</p>}
          </fieldset>)}
          {filters.rules.length > 1 && <p className="finder-footnote">Every rule must pass. A player can satisfy more than one rule.</p>}
          <div className="finder-filter-grid mt-4">
            {field("Value range", filters.valueTolerance === null ? "any" : String(filters.valueTolerance), (v) => updateFilters({ valueTolerance: v === "any" ? null : +v }), [{ value: "0.1", label: "Within 10% of your offer" }, { value: "0.25", label: "Within 25% of your offer" }, { value: "0.5", label: "Within 50% of your offer" }, { value: "any", label: "Any trade value" }], "Trade value tolerance")}
            {field("Rank matches by", filters.sort, (v) => updateFilters({ sort: v as FinderFilters["sort"] }), [{ value: "value", label: "Closest trade value" }, { value: "fppg", label: "Most combined FPPG" }, { value: "cost", label: "Lowest total cost" }])}
          </div>
          <p className="finder-footnote mt-3">FPPG uses current league stats. Age is today’s age; positions use Sleeper eligibility. Both teams must pass current cap rules, with no salary retained.</p>
          <button type="button" className={`finder-search ${searching ? "finder-scanning" : ""}`} disabled={!ready || !offer.length || filters.rules.some((r) => r.count > filters.playersMax) || (!filters.playersMax && !filters.picksMax)} onClick={() => searching ? invalidate() : void search()}>{searching ? "Stop search" : "Search trades"}<span>{searching ? "■" : "→"}</span></button>
          {!offer.length && <p className="finder-footnote text-center mt-2">Add a player or pick to your offer to search.</p>}
        </div>
      </section>
    </div>
    <section className="finder-results" aria-live="polite" aria-busy={searching}>
      <div className="finder-results-heading"><div className="finder-panel-head"><span>03</span><h2>Trade matches</h2></div><span>{searched ? `${results.length}${results.length === 50 ? " best" : ""} matches` : searching ? "SEARCHING" : "READY WHEN YOU ARE"}</span></div>
      {searching ? <div className="finder-empty"><div className="finder-progress"><div style={{ width: `${progress ? 100 * progress.teamsDone / Math.max(1, progress.teamsTotal) : 0}%` }} /></div><strong>Checking the league…</strong><p>{progress?.teamsDone ?? 0} / {progress?.teamsTotal ?? Math.max(0, teams.length - 1)} teams · {(progress?.checked ?? 0).toLocaleString()} combinations checked</p></div>
        : !searched ? <div className="finder-empty">Your matches will appear here. Try a quick setup or build your own requirements.</div>
        : !results.length ? <div className="finder-empty"><strong>No matches with these targets.</strong><p>Try a wider value range, allow picks, or loosen a player requirement.</p></div>
        : <div className="finder-match-grid">{results.map((match, i) => <article className="finder-match" key={`${match.team}:${match.assets.map((p) => p.id).join(",")}`}>
          <div className="finder-match-head"><span className="finder-rank">{String(i + 1).padStart(2, "0")}</span><h3>{match.team}</h3><span className="finder-cap-pass">CAP ✓</span></div>
          <div className="finder-match-assets">{match.assets.map((p) => assetCard(p, false))}</div>
          {match.assets.some(isPick) && <p className="finder-footnote px-3">*Rookie cost is projected; picks cost $0 now.</p>}
          <div className="finder-match-totals"><span><small>COST</small><b>{formatSalary(match.salary)}</b></span><span><small>VALUE</small><b>{formatSalary(match.value * 1000000)}</b></span><span><small>VALUE GAP</small><b>{offerValue ? `${Math.round(match.difference / offerValue * 100)}%` : formatSalary(match.difference * 1000000)}</b></span></div>
          <button type="button" className="finder-open-trade" onClick={() => openTrade(match)}>Open in Trade Machine <span>→</span></button>
        </article>)}</div>}
    </section>
  </div>;
}

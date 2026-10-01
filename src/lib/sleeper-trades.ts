/** Read accepted Sleeper trades without executing them or exposing unaccepted offers. */
import { sql } from "./db";
import { loadLeague } from "./league";
import { loadPickPlayers } from "./picks";
import { checkTrade, type TradeView } from "./trades";
import { getCurrentSalary, pickPlayerId, type Player } from "./types";

export interface SleeperTransaction {
  transaction_id: string;
  league_id: string;
  type: string;
  status: string;
  created: number;
  roster_ids: number[];
  consenter_ids: number[] | null;
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  draft_picks: unknown[] | null;
  waiver_budget: unknown[] | null;
}

export interface SleeperTradeView extends TradeView {
  check: "valid" | "invalid" | "unmapped" | "ownership_updated";
  errors: string[];
  notes: string[];
}

export class SleeperConnectionError extends Error {
  constructor(message: string, public readonly status = 502) { super(message); }
}

/** Pending alone is not enough: every team must have consented. */
export function isAcceptedSleeperTrade(t: SleeperTransaction, leagueId: string): boolean {
  return t.league_id === leagueId && t.type === "trade" && t.status === "pending"
    && Array.isArray(t.roster_ids) && t.roster_ids.length >= 2
    && new Set(t.roster_ids).size === t.roster_ids.length
    && Array.isArray(t.consenter_ids) && t.roster_ids.every(id => t.consenter_ids!.includes(id));
}

export async function fetchAcceptedSleeperTrades(): Promise<SleeperTransaction[]> {
  const token = process.env.SLEEPER_TOKEN?.trim();
  const leagueId = process.env.SLEEPER_LEAGUE_ID?.trim();
  if (!token) throw new SleeperConnectionError("Sleeper connection is not configured. Set SLEEPER_TOKEN in Vercel.", 503);
  if (!leagueId) throw new SleeperConnectionError("Sleeper league is not configured.", 503);
  let response: Response;
  try {
    response = await fetch("https://sleeper.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json", authorization: token,
        "x-sleeper-graphql-op": "league_transactions_filtered",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        operationName: "league_transactions_filtered",
        query: `query league_transactions_filtered($league_id: Snowflake!, $type_filters: [String], $status_filters: [String]) {
          league_transactions_filtered(league_id: $league_id, type_filters: $type_filters, status_filters: $status_filters) {
            transaction_id league_id type status created roster_ids consenter_ids adds drops draft_picks waiver_budget
          }
        }`,
        variables: { league_id: leagueId, type_filters: ["trade"], status_filters: ["pending"] },
      }),
    });
  } catch {
    throw new SleeperConnectionError("Sleeper could not be reached. Try refreshing shortly.");
  }
  const data = await response.json().catch(() => null);
  if (response.status === 401 || data?.errors?.some((e: { code?: string }) => e.code === "unauthorized")) {
    throw new SleeperConnectionError("Sleeper rejected the connection. Replace SLEEPER_TOKEN with a current session token.", 503);
  }
  // Never forward the raw private response, error messages, or authorization header.
  if (!response.ok || data?.errors?.length || !Array.isArray(data?.data?.league_transactions_filtered)) {
    throw new SleeperConnectionError("Sleeper did not return its review queue. Refresh or check the connected account's league access.");
  }
  const unique = new Map<string, SleeperTransaction>();
  for (const t of data.data.league_transactions_filtered as SleeperTransaction[]) {
    if (isAcceptedSleeperTrade(t, leagueId)) unique.set(t.transaction_id, t);
  }
  return [...unique.values()].sort((a, b) => b.created - a.created);
}

interface TeamMapping { id: number; name: string; sleeper_roster: number | null }
interface PlayerMapping { id: number; sleeper_id: string | null }

/** Sleeper's player IDs and original pick rosters differ from BYF's IDs. */
export function mapSleeperTrade(
  t: SleeperTransaction, teams: TeamMapping[], players: PlayerMapping[], assets: Player[],
): SleeperTradeView {
  const byRoster = new Map(teams.filter(t => t.sleeper_roster != null).map(t => [t.sleeper_roster!, t]));
  const bySleeperId = new Map(players.filter(p => p.sleeper_id != null).map(p => [p.sleeper_id!, p.id]));
  const byId = new Map(assets.map(p => [p.id, p]));
  const errors: string[] = [];
  const trade: SleeperTradeView = {
    id: t.transaction_id, revision: 0, status: "sleeper_pending", proposed_by: null,
    created_at: new Date(t.created).toISOString(), decided_at: null,
    teams: t.roster_ids.map(id => ({ team: byRoster.get(id)?.name ?? `Sleeper roster ${id}`, retained: 0, accepted: true })),
    items: [], check: "unmapped", errors, notes: [],
  };
  for (const id of t.roster_ids) {
    if (!byRoster.has(id)) errors.push(`Sleeper roster ${id} is not linked to a BYF team.`);
  }
  function addItem(playerId: number | undefined, fromId: number | undefined, toId: number | undefined, label: string) {
    const from = fromId != null ? byRoster.get(fromId)?.name : undefined;
    const to = toId != null ? byRoster.get(toId)?.name : undefined;
    const asset = playerId != null ? byId.get(playerId) : undefined;
    if (!asset) errors.push(`${label} could not be matched to a tradeable BYF asset.`);
    if (!from || !to || !t.roster_ids.includes(fromId!) || !t.roster_ids.includes(toId!)) {
      errors.push(`${label} has an unknown sending or receiving team.`);
    }
    trade.items.push({
      playerId: playerId ?? 0, player: asset?.name ?? label, salary: asset ? getCurrentSalary(asset) : null,
      from: from ?? `Sleeper roster ${fromId ?? "unknown"}`, to: to ?? `Sleeper roster ${toId ?? "unknown"}`,
    });
  }
  for (const id of new Set([...Object.keys(t.adds ?? {}), ...Object.keys(t.drops ?? {})])) {
    addItem(bySleeperId.get(id), t.drops?.[id], t.adds?.[id], `Sleeper player ${id}`);
  }
  for (const raw of t.draft_picks ?? []) {
    let p = raw;
    if (typeof p === "string") { try { p = JSON.parse(p); } catch { /* Report rather than omit. */ } }
    const pick = p as { season?: unknown; round?: unknown; roster_id?: unknown; previous_owner_id?: unknown; owner_id?: unknown } | null;
    if (!pick || typeof pick !== "object") { errors.push("A Sleeper draft pick could not be read."); continue; }
    const season = Number(pick.season), round = Number(pick.round);
    const original = byRoster.get(Number(pick.roster_id));
    const valid = Number.isInteger(season) && season >= 2000 && season <= 2100
      && Number.isInteger(round) && round >= 1 && round <= 9 && original != null;
    addItem(valid ? pickPlayerId(season, round, original!.id) : undefined,
      Number(pick.previous_owner_id), Number(pick.owner_id), `${pick.season} round ${pick.round} pick (Sleeper roster ${pick.roster_id})`);
  }
  if (t.waiver_budget?.length) trade.notes.push("Sleeper FAAB transfers are not salary retention and are excluded from the cap check.");
  if (trade.items.length === 0) errors.push("This Sleeper trade has no mapped players or picks.");
  if (!errors.length && trade.items.every(i => byId.get(i.playerId)?.team === i.to)) {
    trade.check = "ownership_updated";
    trade.notes.push("These assets are already on their receiving teams in BYF. Retention has not been verified.");
  }
  return trade;
}

export async function listSleeperTrades(): Promise<SleeperTradeView[]> {
  const transactions = await fetchAcceptedSleeperTrades();
  if (!transactions.length) return [];
  const [teams, playerIds, league, picks] = await Promise.all([
    sql`select id, name, sleeper_roster from teams`,
    sql`select id, sleeper_id from players where sleeper_id is not null`,
    loadLeague(), loadPickPlayers(),
  ]);
  return Promise.all(transactions.map(async t => {
    const view = mapSleeperTrade(t, teams as TeamMapping[], playerIds as PlayerMapping[], [...league.players, ...picks]);
    if (view.errors.length || view.check === "ownership_updated") return view;
    const result = await checkTrade({ teams: view.teams, items: view.items });
    view.check = result.ok ? "valid" : "invalid";
    view.errors = result.ok ? [] : result.errors;
    return view;
  }));
}

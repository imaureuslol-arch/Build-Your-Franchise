/**
 * Trades on the server: checking a proposal, storing it, and executing it.
 *
 * A trade is a set of teams (each may retain salary on what it sends out)
 * and a set of items, each moving one player — or, with a negative id, the
 * sending team's dead cap — from one team to another. Cap rules are the same
 * validateTrade the Trade Machine runs in the browser, re-run here against
 * the live book so nothing can be approved on stale numbers.
 */

import { sql } from "./db";
import { loadLeague } from "./league";
import {
  getCurrentSalary,
  getCurrentSeasonYear,
  isDeadCap,
  validateTrade,
  FREE_AGENCY_TEAM,
  type Player,
  type TradeTeam,
} from "./types";

export const MAX_RETAINED_SHARE = 0.25;

export interface TradeInput {
  teams: { team: string; retained: number }[];
  items: { playerId: number; from: string; to: string }[];
}

export type TradeCheck =
  | { ok: true; teams: TradeTeam[]; teamIds: Map<string, number>; players: Map<number, Player> }
  | { ok: false; errors: string[] };

/** Check a trade against the current book. Pure read; changes nothing. */
export async function checkTrade(input: TradeInput): Promise<TradeCheck> {
  const errors: string[] = [];
  const names = input.teams.map((t) => t.team);
  if (names.length < 2 || names.length > 4) errors.push("A trade needs 2 to 4 teams.");
  if (new Set(names).size !== names.length) errors.push("A team is in the trade twice.");
  if (input.items.length === 0) errors.push("Nobody is being traded.");

  const [{ players }, teamRows] = await Promise.all([loadLeague(), sql`select id, name from teams`]);
  const teamIds = new Map<string, number>(teamRows.map((t) => [t.name as string, t.id as number]));
  for (const n of names) if (!teamIds.has(n)) errors.push(`Unknown team: ${n}`);

  const byId = new Map(players.map((p) => [p.id, p]));
  const seen = new Set<number>();
  for (const item of input.items) {
    const p = byId.get(item.playerId);
    if (!p || p.team === FREE_AGENCY_TEAM) errors.push("A player in this trade is no longer on a roster.");
    else if (p.team !== item.from) errors.push(`${p.name} is no longer on ${item.from}.`);
    if (!names.includes(item.from) || !names.includes(item.to) || item.from === item.to) {
      errors.push("Every player must go to another team in the trade.");
    }
    if (seen.has(item.playerId)) errors.push("A player is in the trade twice.");
    seen.add(item.playerId);
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)] };

  const teams: TradeTeam[] = input.teams.map(({ team, retained }) => {
    const playersOut = input.items.filter((i) => i.from === team).map((i) => byId.get(i.playerId)!);
    const playersIn = input.items.filter((i) => i.to === team).map((i) => byId.get(i.playerId)!);
    return { team, playersOut, playersIn, retainedSalary: Math.max(0, Math.round(retained || 0)), incomingRetained: 0 };
  });

  for (const t of teams) {
    const realOut = t.playersOut.filter((p) => !isDeadCap(p)).reduce((s, p) => s + (getCurrentSalary(p) || 0), 0);
    if ((t.retainedSalary ?? 0) > Math.floor(realOut * MAX_RETAINED_SHARE)) {
      errors.push(`${t.team} can retain at most 25% of the salary it sends out.`);
    }
  }
  // Salary a team retains is credited to the teams receiving its players,
  // split by how much of the outgoing salary each one takes.
  for (const t of teams) {
    t.incomingRetained = retentionShares(t.team, teams, input.items, byId).reduce((s, r) => s + r.amount, 0);
  }

  const cap = validateTrade(teams, players.filter((p) => p.team !== FREE_AGENCY_TEAM));
  errors.push(...cap.errors);
  if (errors.length) return { ok: false, errors };
  return { ok: true, teams, teamIds, players: byId };
}

/** What each sending team retains on players going to `receiver`. */
function retentionShares(
  receiver: string,
  teams: TradeTeam[],
  items: TradeInput["items"],
  byId: Map<number, Player>
): { from: string; amount: number }[] {
  const shares: { from: string; amount: number }[] = [];
  for (const sender of teams) {
    if (sender.team === receiver || !sender.retainedSalary) continue;
    const real = (i: TradeInput["items"][number]) => {
      const p = byId.get(i.playerId);
      return p && !isDeadCap(p) ? getCurrentSalary(p) || 0 : 0;
    };
    const out = items.filter((i) => i.from === sender.team);
    const total = out.reduce((s, i) => s + real(i), 0);
    const toReceiver = out.filter((i) => i.to === receiver).reduce((s, i) => s + real(i), 0);
    if (total > 0 && toReceiver > 0) {
      shares.push({ from: sender.team, amount: Math.round(sender.retainedSalary * (toReceiver / total)) });
    }
  }
  return shares;
}

export async function createTrade(
  input: TradeInput,
  check: Extract<TradeCheck, { ok: true }>,
  proposedBy: number | null,
  status: "proposed" | "accepted"
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await sql.transaction([
    sql`insert into trades (id, status, proposed_by, season)
        values (${id}, ${status}, ${proposedBy}, ${getCurrentSeasonYear()})`,
    ...input.teams.map((t) => {
      const teamId = check.teamIds.get(t.team)!;
      const accepted = status === "accepted" || teamId === proposedBy ? now : null;
      return sql`insert into trade_teams (trade_id, team_id, retained, accepted_at)
                 values (${id}, ${teamId}, ${Math.max(0, Math.round(t.retained || 0))}, ${accepted})`;
    }),
    ...input.items.map((i) => sql`
      insert into trade_items (trade_id, player_id, from_team, to_team)
      values (${id}, ${i.playerId > 0 ? i.playerId : null}, ${check.teamIds.get(i.from)!}, ${check.teamIds.get(i.to)!})`),
  ]);
  return id;
}

/** Rebuild the TradeInput of a stored trade. */
export async function loadTradeInput(tradeId: string): Promise<TradeInput> {
  const [teams, items] = await Promise.all([
    sql`select t.name, tt.retained from trade_teams tt join teams t on t.id = tt.team_id where tt.trade_id = ${tradeId}`,
    sql`select ti.player_id, ti.from_team, f.name as from_name, d.name as to_name
        from trade_items ti join teams f on f.id = ti.from_team join teams d on d.id = ti.to_team
        where ti.trade_id = ${tradeId}`,
  ]);
  return {
    teams: teams.map((t) => ({ team: t.name, retained: Number(t.retained) })),
    items: items.map((i) => ({ playerId: i.player_id ?? -i.from_team, from: i.from_name, to: i.to_name })),
  };
}

/**
 * Apply a trade to the book: move players, hand over dead cap, and book
 * retention for the current season. Re-checks first; returns the errors
 * instead of executing if the book has changed underneath it.
 */
export async function executeTrade(tradeId: string): Promise<string[]> {
  const input = await loadTradeInput(tradeId);
  const check = await checkTrade(input);
  if (!check.ok) return check.errors;

  const season = getCurrentSeasonYear();
  const q = [];
  for (const i of input.items) {
    const from = check.teamIds.get(i.from)!;
    const to = check.teamIds.get(i.to)!;
    if (i.playerId > 0) {
      q.push(sql`update players set team_id = ${to} where id = ${i.playerId}`);
    } else {
      q.push(sql`update dead_cap set team_id = ${to} where team_id = ${from}`);
    }
  }
  for (const receiver of check.teams) {
    for (const share of retentionShares(receiver.team, check.teams, input.items, check.players)) {
      const names = input.items
        .filter((i) => i.from === share.from && i.to === receiver.team && i.playerId > 0)
        .map((i) => check.players.get(i.playerId)!.name)
        .join(", ");
      q.push(sql`insert into dead_cap (team_id, label, season, amount)
                 values (${check.teamIds.get(share.from)!}, ${`Retained: ${names}`}, ${season}, ${share.amount})`);
      q.push(sql`insert into dead_cap (team_id, label, season, amount)
                 values (${check.teamIds.get(receiver.team)!}, ${`Retention credit: ${names}`}, ${season}, ${-share.amount})`);
    }
  }
  q.push(sql`update trades set status = 'approved', decided_at = now() where id = ${tradeId}`);
  await sql.transaction(q);
  return [];
}

export interface TradeView {
  id: string;
  status: string;
  created_at: string;
  decided_at: string | null;
  proposed_by: string | null;
  teams: { team: string; retained: number; accepted: boolean }[];
  items: { player: string; salary: number | null; from: string; to: string }[];
}

/** Trades for display, newest first. */
export async function listTrades(statuses: string[]): Promise<TradeView[]> {
  const trades = await sql`
    select tr.id, tr.status, tr.created_at, tr.decided_at, t.name as proposed_by
    from trades tr left join teams t on t.id = tr.proposed_by
    where tr.status = any(${statuses}) order by tr.created_at desc limit 100`;
  if (trades.length === 0) return [];
  const ids = trades.map((t) => t.id);
  const [teams, items] = await Promise.all([
    sql`select tt.trade_id, t.name, tt.retained, tt.accepted_at from trade_teams tt
        join teams t on t.id = tt.team_id where tt.trade_id = any(${ids})`,
    sql`select ti.trade_id, coalesce(p.name, 'Dead Cap') as player, f.name as from_name, d.name as to_name,
               (select amount from contracts c where c.player_id = ti.player_id and c.season = tr.season) as salary
        from trade_items ti join trades tr on tr.id = ti.trade_id
        join teams f on f.id = ti.from_team join teams d on d.id = ti.to_team
        left join players p on p.id = ti.player_id where ti.trade_id = any(${ids})`,
  ]);
  return trades.map((t) => ({
    id: t.id,
    status: t.status,
    created_at: t.created_at,
    decided_at: t.decided_at,
    proposed_by: t.proposed_by,
    teams: teams.filter((x) => x.trade_id === t.id).map((x) => ({ team: x.name, retained: Number(x.retained), accepted: !!x.accepted_at })),
    items: items.filter((x) => x.trade_id === t.id).map((x) => ({
      player: x.player, salary: x.salary == null ? null : Number(x.salary), from: x.from_name, to: x.to_name,
    })),
  }));
}

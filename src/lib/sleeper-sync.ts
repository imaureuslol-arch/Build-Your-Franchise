/**
 * Pull the league from Sleeper and reconcile it with the contract book.
 *
 * Applied automatically:
 *   - team owner, display name (Sleeper's team name, else "Team <owner>")
 *     and conference (the roster's Sleeper division: East / West)
 *   - new NBA players and their birthdate / NBA team
 * Flagged in sync_issues for the commissioner, never auto-applied, because
 * each has contract consequences:
 *   - no_contract           on a Sleeper roster with no salary in the book
 *   - not_on_sleeper_roster the book puts him on a team, Sleeper doesn't
 *   - wrong_team            Sleeper has him on a different team than the book
 */

import { sql } from "./db";
import { applyPicks, pickDifferences, seedPicks, sleeperPicks, type MovedPick } from "./picks";
import { conferencesFromSleeper } from "./sleeper-conferences";

const API = "https://api.sleeper.app/v1";

interface SleeperUser {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string };
}
interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
  settings?: { division?: number };
}

interface SleeperPlayer {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  team?: string | null;
  birth_date?: string | null;
  active?: boolean;
  years_exp?: number | null;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`Sleeper ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export interface SyncResult {
  teamsUpdated: number;
  playersAdded: number;
  issues: number;
}

export async function syncFromSleeper(leagueId: string): Promise<SyncResult> {
  const [league, users, rosters, catalogue] = await Promise.all([
    get<{ metadata?: Record<string, string> }>(`/league/${leagueId}`),
    get<SleeperUser[]>(`/league/${leagueId}/users`),
    get<SleeperRoster[]>(`/league/${leagueId}/rosters`),
    get<Record<string, SleeperPlayer>>(`/players/nba`),
  ]);
  const userById = new Map(users.map((u) => [u.user_id, u]));
  const conferences = conferencesFromSleeper(league, rosters);

  // Teams: owner changes flow through; an ownerless roster keeps its name.
  const teams = await sql`select id, sleeper_roster, name from teams`;
  const teamByRoster = new Map(teams.map((t) => [t.sleeper_roster as number, t]));
  let teamsUpdated = 0;
  for (const r of rosters) {
    const team = teamByRoster.get(r.roster_id);
    if (!team) continue;
    const u = r.owner_id ? userById.get(r.owner_id) : undefined;
    const name = u ? u.metadata?.team_name?.trim() || `Team ${u.display_name}` : team.name;
    // Conference = the roster's Sleeper division (league.metadata.division_N).
    const conference = conferences.get(r.roster_id) ?? null;
    const res = await sql`
      update teams set owner_name = ${u?.display_name ?? null},
                       sleeper_user_id = ${u?.user_id ?? null},
                       name = ${name},
                       conference = coalesce(${conference}, conference)
      where id = ${team.id}
        and (owner_name is distinct from ${u?.display_name ?? null} or name <> ${name}
             or conference is distinct from coalesce(${conference}, conference))
      returning id`;
    teamsUpdated += res.length;
  }

  // Players: make sure every rostered player and every active NBA player exists.
  const rostered = new Map<string, number>(); // sleeper_id -> team id
  for (const r of rosters) {
    const team = teamByRoster.get(r.roster_id);
    if (!team) continue;
    for (const pid of r.players ?? []) rostered.set(pid, team.id);
  }
  const wanted = Object.entries(catalogue).filter(
    ([id, p]) => rostered.has(id) || (p.active && p.team)
  );
  const ids = wanted.map(([id]) => id);
  const names = wanted.map(([, p]) => p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim());
  const nbaTeams = wanted.map(([, p]) => p.team ?? null);
  const births = wanted.map(([, p]) => p.birth_date || null);
  const experience = wanted.map(([, p]) => Number.isSafeInteger(p.years_exp) && p.years_exp! >= 0 ? p.years_exp! : null);
  const inserted = await sql`
    insert into players (sleeper_id, name, nba_team, birthdate, nba_experience)
    select * from unnest(${ids}::text[], ${names}::text[], ${nbaTeams}::text[], ${births}::date[], ${experience}::int[])
    on conflict (sleeper_id) do update
      set nba_team = excluded.nba_team,
          birthdate = coalesce(players.birthdate, excluded.birthdate)
          , nba_experience = coalesce(excluded.nba_experience, players.nba_experience)
    returning (xmax = 0) as inserted`;
  const playersAdded = inserted.filter((r) => r.inserted).length;

  // New pickups with no contract join their Sleeper team straight away;
  // anything already in the book is only flagged (by checkRosters below).
  await sql`
    update players p set team_id = r.team_id
    from unnest(${[...rostered.keys()]}::text[], ${[...rostered.values()]}::int[]) as r(sleeper_id, team_id)
    where p.sleeper_id = r.sleeper_id and p.team_id is null
      and not exists (select 1 from contracts c where c.player_id = p.id)`;

  // New draft years appear here; pick owners are only flagged until applied.
  await seedPicks(await sleeperPicks(leagueId));

  const issues = await checkRosters(leagueId, rosters);
  return { teamsUpdated, playersAdded, issues };
}

/**
 * Compare Sleeper's rosters with the book and rewrite sync_issues. Cheap (one
 * small Sleeper call), so it also runs after every approved trade and each
 * time the commissioner opens the list. Returns the number of issues.
 */
export async function checkRosters(leagueId: string, rosters?: SleeperRoster[]): Promise<number> {
  const live = rosters ?? (await get<SleeperRoster[]>(`/league/${leagueId}/rosters`));
  const teams = await sql`select id, sleeper_roster, name from teams`;
  const teamByRoster = new Map(teams.map((t) => [t.sleeper_roster as number, t]));
  const teamName = new Map(teams.map((t) => [t.id as number, t.name as string]));

  const rostered = new Map<string, number>(); // sleeper_id -> team id
  for (const r of live) {
    const team = teamByRoster.get(r.roster_id);
    if (!team) continue;
    for (const pid of r.players ?? []) rostered.set(pid, team.id);
  }

  const book = await sql`
    select p.id, p.sleeper_id, p.name, p.team_id,
           exists (select 1 from contracts c where c.player_id = p.id) as has_contract
    from players p where p.sleeper_id = any(${[...rostered.keys()]}) or p.team_id is not null`;

  const issues: { kind: string; player_id: number | null; team_id: number | null; detail: string }[] = [];
  for (const p of book) {
    const sleeperTeam = p.sleeper_id ? rostered.get(p.sleeper_id) : undefined;
    if (sleeperTeam != null && !p.has_contract) {
      issues.push({ kind: "no_contract", player_id: p.id, team_id: sleeperTeam, detail: `${p.name} is on a Sleeper roster with no contract` });
    }
    if (sleeperTeam == null && p.team_id != null) {
      issues.push({ kind: "not_on_sleeper_roster", player_id: p.id, team_id: p.team_id, detail: `${p.name} has a contract but is on no Sleeper roster` });
    }
    if (sleeperTeam != null && p.team_id != null && sleeperTeam !== p.team_id) {
      issues.push({
        kind: "wrong_team",
        player_id: p.id,
        team_id: p.team_id,
        detail: `${p.name}: ${teamName.get(p.team_id)} here, ${teamName.get(sleeperTeam)} in Sleeper`,
      });
    }
  }

  issues.push(...(await pickDifferences(await sleeperPicks(leagueId))));

  await sql.transaction([
    sql`delete from sync_issues`,
    sql`insert into sync_issues (kind, player_id, team_id, detail)
        select * from unnest(${issues.map((i) => i.kind)}::text[], ${issues.map((i) => i.player_id)}::int[],
                             ${issues.map((i) => i.team_id)}::int[], ${issues.map((i) => i.detail)}::text[])`,
  ]);
  return issues.length;
}

export interface ApplyResult {
  moved: { player: string; from: string; to: string }[];
  picksMoved: MovedPick[];
  released: string[];
  joined: string[];
  tradesUndone: number;
}

/**
 * Make the book match Sleeper's rosters. Sleeper is the authority: trades
 * made directly in Sleeper arrive here, and a trade approved on the site but
 * never made in Sleeper is reverted, which is how an approval is undone.
 *
 *   on another team in Sleeper   moves there, contract and all
 *   on no Sleeper roster         released: contract for this season and
 *                                later erased, no dead cap
 *   picked up, not in the book   joins the team with no contract (flagged)
 *
 * A site trade whose players have all been put back where they started is
 * marked 'undone' and the retained salary it booked is removed. Every change
 * is written to the audit log. Only "Sync now" calls this; the nightly run
 * only flags differences.
 */
export async function applySleeperRosters(leagueId: string, currentSeason: number): Promise<ApplyResult> {
  await sql`select byf_refresh_rfas(${currentSeason}::int)`;
  const rosters = await get<SleeperRoster[]>(`/league/${leagueId}/rosters`);
  const teams = await sql`select id, sleeper_roster, name from teams`;
  const teamByRoster = new Map(teams.map((t) => [t.sleeper_roster as number, t.id as number]));
  const teamName = new Map(teams.map((t) => [t.id as number, t.name as string]));

  const rostered = new Map<string, number>(); // sleeper_id -> team id
  for (const r of rosters) {
    const team = teamByRoster.get(r.roster_id);
    if (team == null) continue;
    for (const pid of r.players ?? []) rostered.set(pid, team);
  }

  const book = await sql`
    select id, sleeper_id, name, team_id,
      exists(select 1 from restricted_free_agents r where r.player_id=players.id) as restricted
    from players
    where team_id is not null or sleeper_id = any(${[...rostered.keys()]})`;

  const result: ApplyResult = { moved: [], picksMoved: [], released: [], joined: [], tradesUndone: 0 };
  const movedIds: number[] = [];
  const q = [];
  for (const p of book) {
    const target = p.sleeper_id ? rostered.get(p.sleeper_id) : undefined;
    if (target != null && p.team_id != null && target !== p.team_id) {
      q.push(sql`update players set team_id = ${target} where id = ${p.id}`);
      movedIds.push(p.id);
      result.moved.push({ player: p.name, from: teamName.get(p.team_id)!, to: teamName.get(target)! });
    } else if (target == null && p.team_id != null) {
      q.push(sql`update players set team_id = null where id = ${p.id}`);
      q.push(sql`delete from contracts where player_id = ${p.id} and season >= ${currentSeason}`);
      result.released.push(`${p.name} (${teamName.get(p.team_id)})`);
    } else if (target != null && p.team_id == null && !p.restricted) {
      q.push(sql`update players set team_id = ${target} where id = ${p.id}`);
      result.joined.push(`${p.name} (${teamName.get(target)})`);
    }
  }
  if (q.length) {
    q.push(sql`insert into audit_log (action, detail) values ('sleeper_rosters_applied', ${JSON.stringify(result)})`);
    await sql.transaction(q);
  }

  result.picksMoved = await applyPicks(await sleeperPicks(leagueId));
  if (result.picksMoved.length) {
    await sql`insert into audit_log (action, detail) values ('sleeper_picks_applied', ${JSON.stringify(result.picksMoved)})`;
  }

  // Site trades this sync fully reversed: every player is back with the team
  // that sent him, and at least one of them was moved just now (a trade
  // reversed by a later site trade is left alone). Mark them undone and drop
  // the retention they booked.
  const reversed = await sql`
    select tr.id from trades tr
    where tr.status = 'approved'
      and exists (
        select 1 from trade_items ti where ti.trade_id = tr.id
          and (ti.player_id = any(${movedIds})
               or (ti.kind = 'pick' and (ti.pick_season, ti.pick_round, ti.pick_original) in (
                 select * from unnest(${result.picksMoved.map((m) => m.season)}::int[],
                                      ${result.picksMoved.map((m) => m.round)}::int[],
                                      ${result.picksMoved.map((m) => m.originalTeam)}::int[])))))
      and not exists (
        select 1 from trade_items ti join players p on p.id = ti.player_id
        where ti.trade_id = tr.id and p.team_id is distinct from ti.from_team)
      and not exists (
        select 1 from trade_items ti join draft_picks d
          on d.season = ti.pick_season and d.round = ti.pick_round and d.original_team = ti.pick_original
        where ti.trade_id = tr.id and ti.kind = 'pick' and d.owner_team <> ti.from_team)`;
  for (const t of reversed) {
    await sql.transaction([
      sql`update trades set status = 'undone', decided_at = now() where id = ${t.id}`,
      sql`delete from dead_cap where trade_id = ${t.id}`,
      sql`insert into audit_log (action, detail) values ('trade_undone_by_sleeper', ${JSON.stringify({ id: t.id })})`,
    ]);
  }
  result.tradesUndone = reversed.length;

  await checkRosters(leagueId, rosters);
  return result;
}

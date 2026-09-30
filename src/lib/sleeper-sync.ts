/**
 * Pull the league from Sleeper and reconcile it with the contract book.
 *
 * Applied automatically:
 *   - team owner and display name (Sleeper's team name, else "Team <owner>")
 *   - new NBA players and their birthdate / NBA team
 * Flagged in sync_issues for the commissioner, never auto-applied, because
 * each has contract consequences:
 *   - no_contract           on a Sleeper roster with no salary in the book
 *   - not_on_sleeper_roster the book puts him on a team, Sleeper doesn't
 *   - wrong_team            Sleeper has him on a different team than the book
 */

import { sql } from "./db";

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
}
interface SleeperPlayer {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  team?: string | null;
  birth_date?: string | null;
  active?: boolean;
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
  const [users, rosters, catalogue] = await Promise.all([
    get<SleeperUser[]>(`/league/${leagueId}/users`),
    get<SleeperRoster[]>(`/league/${leagueId}/rosters`),
    get<Record<string, SleeperPlayer>>(`/players/nba`),
  ]);
  const userById = new Map(users.map((u) => [u.user_id, u]));

  // Teams: owner changes flow through; an ownerless roster keeps its name.
  const teams = await sql`select id, sleeper_roster, name from teams`;
  const teamByRoster = new Map(teams.map((t) => [t.sleeper_roster as number, t]));
  let teamsUpdated = 0;
  for (const r of rosters) {
    const team = teamByRoster.get(r.roster_id);
    if (!team) continue;
    const u = r.owner_id ? userById.get(r.owner_id) : undefined;
    const name = u ? u.metadata?.team_name?.trim() || `Team ${u.display_name}` : team.name;
    const res = await sql`
      update teams set owner_name = ${u?.display_name ?? null},
                       sleeper_user_id = ${u?.user_id ?? null},
                       name = ${name}
      where id = ${team.id}
        and (owner_name is distinct from ${u?.display_name ?? null} or name <> ${name})
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
  const inserted = await sql`
    insert into players (sleeper_id, name, nba_team, birthdate)
    select * from unnest(${ids}::text[], ${names}::text[], ${nbaTeams}::text[], ${births}::date[])
    on conflict (sleeper_id) do update
      set nba_team = excluded.nba_team,
          birthdate = coalesce(players.birthdate, excluded.birthdate)
    returning (xmax = 0) as inserted`;
  const playersAdded = inserted.filter((r) => r.inserted).length;

  // New pickups with no contract join their Sleeper team straight away;
  // anything already in the book is only flagged.
  const book = await sql`
    select p.id, p.sleeper_id, p.name, p.team_id,
           exists (select 1 from contracts c where c.player_id = p.id) as has_contract
    from players p where p.sleeper_id = any(${[...rostered.keys()]}) or p.team_id is not null`;

  const issues: { kind: string; player_id: number; team_id: number | null; detail: string }[] = [];
  for (const p of book) {
    const sleeperTeam = p.sleeper_id ? rostered.get(p.sleeper_id) : undefined;
    if (sleeperTeam != null && p.team_id == null && !p.has_contract) {
      await sql`update players set team_id = ${sleeperTeam} where id = ${p.id}`;
      p.team_id = sleeperTeam;
    }
    if (sleeperTeam != null && !p.has_contract) {
      issues.push({ kind: "no_contract", player_id: p.id, team_id: sleeperTeam, detail: `${p.name} is on a Sleeper roster with no contract` });
    }
    if (sleeperTeam == null && p.team_id != null) {
      issues.push({ kind: "not_on_sleeper_roster", player_id: p.id, team_id: p.team_id, detail: `${p.name} has a contract but is on no Sleeper roster` });
    }
    if (sleeperTeam != null && p.team_id != null && sleeperTeam !== p.team_id) {
      issues.push({ kind: "wrong_team", player_id: p.id, team_id: sleeperTeam, detail: `${p.name} is on a different team in Sleeper` });
    }
  }

  await sql.transaction([
    sql`delete from sync_issues`,
    sql`insert into sync_issues (kind, player_id, team_id, detail)
        select * from unnest(${issues.map((i) => i.kind)}::text[], ${issues.map((i) => i.player_id)}::int[],
                             ${issues.map((i) => i.team_id)}::int[], ${issues.map((i) => i.detail)}::text[])`,
  ]);

  return { teamsUpdated, playersAdded, issues: issues.length };
}

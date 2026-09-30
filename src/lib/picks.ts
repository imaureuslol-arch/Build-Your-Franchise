/**
 * Draft picks. Sleeper is the authority on who owns which pick, as it is for
 * rosters: the nightly sync adds new draft years and flags differences,
 * "Sync to Sleeper" applies Sleeper's ownership, and a site-approved trade
 * moves picks until then.
 *
 * Tradeable picks are the next three drafts after the last completed one,
 * every round, one per team.
 */

import { sql } from "./db";
import { pickPlayerId, type Player } from "./types";

const API = "https://api.sleeper.app/v1";
const FUTURE_DRAFTS = 3;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`Sleeper ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export function roundLabel(round: number): string {
  return round === 1 ? "1st" : round === 2 ? "2nd" : round === 3 ? "3rd" : `${round}th`;
}

/** "2028 1st (Alabama Blues)" */
export function pickLabel(season: number, round: number, originalTeam: string): string {
  return `${season} ${roundLabel(round)} (${originalTeam})`;
}

export interface SleeperPick {
  season: number;
  round: number;
  originalTeam: number;
  ownerTeam: number;
}

/** Every tradeable pick with its owner according to Sleeper. */
export async function sleeperPicks(leagueId: string): Promise<SleeperPick[]> {
  const [league, drafts, traded, teams] = await Promise.all([
    get<{ season: string; settings: { draft_rounds?: number } }>(`/league/${leagueId}`),
    get<{ season: string; status: string }[]>(`/league/${leagueId}/drafts`),
    get<{ season: string; round: number; roster_id: number; owner_id: number }[]>(`/league/${leagueId}/traded_picks`),
    sql`select id, sleeper_roster from teams where sleeper_roster is not null`,
  ]);
  const teamByRoster = new Map(teams.map((t) => [t.sleeper_roster as number, t.id as number]));
  const rounds = league.settings.draft_rounds ?? 2;
  const done = drafts.filter((d) => d.status === "complete").map((d) => Number(d.season));
  const first = done.length ? Math.max(...done) + 1 : Number(league.season);
  const seasons = Array.from({ length: FUTURE_DRAFTS }, (_, i) => first + i);

  const owner = new Map<string, number>();
  for (const t of traded) {
    const orig = teamByRoster.get(t.roster_id);
    const now = teamByRoster.get(t.owner_id);
    if (orig != null && now != null) owner.set(`${t.season}:${t.round}:${orig}`, now);
  }

  const picks: SleeperPick[] = [];
  for (const season of seasons) {
    for (let round = 1; round <= rounds; round++) {
      for (const team of teamByRoster.values()) {
        picks.push({ season, round, originalTeam: team, ownerTeam: owner.get(`${season}:${round}:${team}`) ?? team });
      }
    }
  }
  return picks;
}

const cols = (picks: SleeperPick[]) => [
  picks.map((p) => p.season),
  picks.map((p) => p.round),
  picks.map((p) => p.originalTeam),
  picks.map((p) => p.ownerTeam),
];

/**
 * Add picks for new draft years (owned as in Sleeper) and drop drafts that
 * have happened. Existing picks keep their site owner; that is flagged, not
 * changed, until "Sync to Sleeper".
 */
export async function seedPicks(picks: SleeperPick[]): Promise<void> {
  if (picks.length === 0) return;
  const [s, r, o, w] = cols(picks);
  await sql.transaction([
    sql`delete from draft_picks where season < ${Math.min(...s)}`,
    sql`insert into draft_picks (season, round, original_team, owner_team)
        select * from unnest(${s}::int[], ${r}::int[], ${o}::int[], ${w}::int[])
        on conflict do nothing`,
  ]);
}

/** Make every pick's owner match Sleeper. Returns the labels of picks that moved. */
export interface MovedPick { label: string; from: string; to: string; season: number; round: number; originalTeam: number }

export async function applyPicks(picks: SleeperPick[]): Promise<MovedPick[]> {
  await seedPicks(picks);
  const [s, r, o, w] = cols(picks);
  const moved = await sql`
    with target as (
      select * from unnest(${s}::int[], ${r}::int[], ${o}::int[], ${w}::int[]) as t(season, round, original_team, owner_team)
    ), before as (
      select d.season, d.round, d.original_team, d.owner_team as old_owner, t.owner_team as new_owner
      from draft_picks d join target t using (season, round, original_team)
      where d.owner_team <> t.owner_team
    ), upd as (
      update draft_picks d set owner_team = b.new_owner
      from before b where d.season = b.season and d.round = b.round and d.original_team = b.original_team
      returning d.season
    )
    select b.season, b.round, b.original_team, orig.name as original, f.name as from_team, t.name as to_team
    from before b join teams orig on orig.id = b.original_team
    join teams f on f.id = b.old_owner join teams t on t.id = b.new_owner`;
  return moved.map((m) => ({
    label: pickLabel(m.season, m.round, m.original),
    from: m.from_team,
    to: m.to_team,
    season: m.season,
    round: m.round,
    originalTeam: m.original_team,
  }));
}

/** Picks owned by a different team here than in Sleeper, as sync issues. */
export async function pickDifferences(picks: SleeperPick[]) {
  const [s, r, o, w] = cols(picks);
  const rows = await sql`
    select d.season, d.round, orig.name as original, here.name as here, there.name as there, d.owner_team
    from draft_picks d
    join unnest(${s}::int[], ${r}::int[], ${o}::int[], ${w}::int[]) as t(season, round, original_team, owner_team)
      using (season, round, original_team)
    join teams orig on orig.id = d.original_team
    join teams here on here.id = d.owner_team
    join teams there on there.id = t.owner_team
    where d.owner_team <> t.owner_team`;
  return rows.map((p) => ({
    kind: "pick_owner",
    player_id: null as number | null,
    team_id: p.owner_team as number,
    detail: `${pickLabel(p.season, p.round, p.original)}: ${p.here} here, ${p.there} in Sleeper`,
  }));
}

/**
 * Every tradeable pick as a salary-free Player (see pickPlayerId in types),
 * owned by the team that holds it on the site.
 */
export async function loadPickPlayers(): Promise<Player[]> {
  const rows = await sql`
    select d.season, d.round, d.original_team, orig.name as original, own.name as owner
    from draft_picks d join teams orig on orig.id = d.original_team join teams own on own.id = d.owner_team
    order by d.season, d.round, orig.name`;
  return rows.map((r) => ({
    id: pickPlayerId(r.season, r.round, r.original_team),
    name: pickLabel(r.season, r.round, r.original),
    team: r.owner,
    salaries: {},
    ppg: null,
    avg_gp: null,
  }));
}

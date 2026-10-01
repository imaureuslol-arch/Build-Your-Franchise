import { sql } from "./db";
import { DEAD_CAP_NAME, FREE_AGENCY_TEAM, getSalaryYears, type Player, type TeamOwner } from "./types";

/**
 * Every player (rostered and free agents) with contracts flattened to
 * salaries for the current season window, plus the teams. Dead cap is folded into one
 * "Dead Cap" row per team with id = -team_id, which is the shape the pages
 * and validateTrade expect.
 */
export async function loadLeague(): Promise<{ players: Player[]; owners: TeamOwner[] }> {
  const [players, contracts, deadCap, teams] = await Promise.all([
    sql`select p.id, p.name, t.name as team, p.ppg, p.avg_gp
        from players p left join teams t on t.id = p.team_id
        -- Free agents must be on an NBA team (Sleeper's team field).
        where p.team_id is not null or (p.active and p.nba_team is not null)`,
    sql`select player_id, season, amount from contracts`,
    sql`select t.id as team_id, t.name as team, d.season, sum(d.amount)::bigint as amount
        from dead_cap d join teams t on t.id = d.team_id
        group by t.id, t.name, d.season`,
    sql`select name, owner_name, conference from teams order by name`,
  ]);

  const years = getSalaryYears();
  const inRange = (season: number) => years.includes(season);
  const blank = (id: number, name: string, team: string): Player => ({
    id, name, team,
    salaries: {},
    ppg: null, avg_gp: null,
  });

  const byId = new Map<number, Player>();
  for (const p of players) {
    byId.set(p.id, { ...blank(p.id, p.name, p.team ?? FREE_AGENCY_TEAM), ppg: p.ppg, avg_gp: p.avg_gp });
  }
  for (const c of contracts) {
    const p = byId.get(c.player_id);
    if (p && inRange(c.season)) p.salaries[c.season] = Number(c.amount);
  }

  const deadRows = new Map<string, Player>();
  for (const d of deadCap) {
    if (!deadRows.has(d.team)) deadRows.set(d.team, blank(-d.team_id, DEAD_CAP_NAME, d.team));
    if (inRange(d.season) && Number(d.amount) !== 0) {
      deadRows.get(d.team)!.salaries[d.season] = Number(d.amount);
    }
  }

  const owners: TeamOwner[] = teams.map((t) => ({
    team_name: t.name,
    user_name: t.owner_name ?? "(no owner)",
    conference: t.conference,
  }));

  const all = [...byId.values(), ...deadRows.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { players: all, owners };
}

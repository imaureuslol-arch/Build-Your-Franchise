import { sql } from "./db";
import { DEAD_CAP_NAME, FREE_AGENCY_TEAM, getSalaryYears, type Player, type TeamOwner } from "./types";
import { loadSleeperConferences } from "./sleeper-conferences";
import { enforceHardCap } from "./cap-enforcement";

/**
 * Every player (rostered and free agents) with contracts flattened to
 * salaries for the current season window, plus the teams. Dead cap is folded into one
 * "Dead Cap" row per team with id = -team_id, which is the shape the pages
 * and validateTrade expect.
 */
export async function loadLeague(): Promise<{ players: Player[]; owners: TeamOwner[] }> {
  await enforceHardCap();
  const [players, contracts, deadCap, teams, conferences] = await Promise.all([
    sql`select p.id, p.name, t.name as team, p.ppg, p.avg_gp, p.nba_experience, p.contract_version
        from players p left join teams t on t.id = p.team_id
        -- Free agents must be on an NBA team (Sleeper's team field).
        where p.team_id is not null or (p.active and p.nba_team is not null)`,
    sql`select player_id, season, amount from contracts`,
    sql`select t.id as team_id, t.name as team, d.season, sum(d.amount)::bigint as amount
        from dead_cap d join teams t on t.id = d.team_id
        group by t.id, t.name, d.season`,
    sql`select t.id, t.name, t.owner_name, t.sleeper_user_id, t.conference, t.sleeper_roster, c.deadline,
        case when c.deadline is not null then byf_cap_release_preview(t.id,c.season) else '[]'::jsonb end as drops
        from teams t left join team_cap_status c on c.team_id=t.id order by t.name`,
    // Page reads use Sleeper's split directly; stored assignments are an outage fallback.
    loadSleeperConferences(process.env.SLEEPER_LEAGUE_ID ?? "").catch(() => new Map<number, string | null>()),
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
    byId.set(p.id, { ...blank(p.id, p.name, p.team ?? FREE_AGENCY_TEAM), ppg: p.ppg, avg_gp: p.avg_gp, nbaExperience: p.nba_experience, contractVersion:p.contract_version });
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
    owner_key: t.sleeper_user_id != null ? `sleeper:${t.sleeper_user_id}` : `team:${t.id}`,
    conference: conferences.has(t.sleeper_roster) ? conferences.get(t.sleeper_roster)! : t.conference,
    capDeadline: t.deadline ?? null,
    capDropPlayers: t.drops ?? [],
  }));

  const all = [...byId.values(), ...deadRows.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { players: all, owners };
}

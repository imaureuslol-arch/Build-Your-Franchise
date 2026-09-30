import { sql } from "@/lib/db";
import { DEAD_CAP_NAME, FREE_AGENCY_TEAM, SALARY_YEARS, type Player, type TeamOwner } from "@/lib/types";

/**
 * GET /api/league — every player (rostered and free agents) with contracts
 * flattened to contract_27..contract_30, plus the teams. Dead cap is folded
 * into one "Dead Cap" row per team, which is what the pages already expect.
 */
export async function GET() {
  const [players, contracts, deadCap, teams] = await Promise.all([
    sql`select p.id, p.name, t.name as team, p.ppg, p.avg_gp
        from players p left join teams t on t.id = p.team_id
        where p.team_id is not null or p.active`,
    sql`select player_id, season, amount from contracts`,
    sql`select t.name as team, d.season, sum(d.amount)::bigint as amount
        from dead_cap d join teams t on t.id = d.team_id group by t.name, d.season`,
    sql`select name, owner_name, conference from teams order by name`,
  ]);

  const key = (season: number) => `contract_${String(season).slice(2)}` as keyof Player;
  const byId = new Map<number, Player>();
  const blank = (id: number, name: string, team: string): Player => ({
    id, name, team,
    contract_27: null, contract_28: null, contract_29: null, contract_30: null,
    ppg: null, avg_gp: null,
  });

  for (const p of players) {
    byId.set(p.id, { ...blank(p.id, p.name, p.team ?? FREE_AGENCY_TEAM), ppg: p.ppg, avg_gp: p.avg_gp });
  }
  for (const c of contracts) {
    const p = byId.get(c.player_id);
    if (p && (SALARY_YEARS as readonly number[]).includes(c.season)) {
      (p[key(c.season)] as number | null) = Number(c.amount);
    }
  }

  const deadRows = new Map<string, Player>();
  let deadId = -1;
  for (const d of deadCap) {
    if (!deadRows.has(d.team)) deadRows.set(d.team, blank(deadId--, DEAD_CAP_NAME, d.team));
    const row = deadRows.get(d.team)!;
    if ((SALARY_YEARS as readonly number[]).includes(d.season)) {
      (row[key(d.season)] as number | null) = Number(d.amount);
    }
  }

  const owners: TeamOwner[] = teams.map((t) => ({
    team_name: t.name,
    user_name: t.owner_name ?? "(no owner)",
    conference: t.conference,
  }));

  const all = [...byId.values(), ...deadRows.values()].sort((a, b) => a.name.localeCompare(b.name));
  return Response.json({ players: all, owners });
}

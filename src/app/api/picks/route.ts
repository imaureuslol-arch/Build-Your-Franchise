import { sql } from "@/lib/db";
import { loadPickPlayers, teamPowerRatings } from "@/lib/picks";
import { valuePicks } from "@/lib/pick-value";
import { futureTeamPower } from "@/lib/team-projection";
import { decodePickId } from "@/lib/types";

/**
 * GET /api/picks — every tradeable draft pick as a salary-free Player whose
 * `team` is its current owner (see pickPlayerId in src/lib/types.ts), each
 * team's power rating (1-100) keyed by team name, and each pick's value
 * (fair value, projected slot, rookie-scale salary) keyed by pick id.
 */
export async function GET() {
  const leagueId = process.env.SLEEPER_LEAGUE_ID ?? "";
  const [picks, power, teams, roster] = await Promise.all([
    loadPickPlayers(),
    teamPowerRatings(leagueId),
    sql`select id, name from teams`,
    sql`select t.name as team, coalesce(p.proj_fppg, p.ppg, 0)::float8 as fppg,
               date_part('year', age(p.birthdate))::int as age
        from players p join teams t on t.id = p.team_id`,
  ]);
  const teamIds = new Map(teams.map((t) => [t.id as number, t.name as string]));
  const seasons = picks.map((p) => decodePickId(p.id).season);
  const nextDraft = seasons.length ? Math.min(...seasons) : new Date().getFullYear() + 1;
  const projectedPower = futureTeamPower(roster.map((p) => ({
    team: p.team as string, fppg: Number(p.fppg), age: p.age == null ? null : Number(p.age),
  })), power, nextDraft, seasons);
  const values = valuePicks(picks, power, teamIds, nextDraft, undefined, projectedPower);
  return Response.json({ picks, power, values, projectedPower });
}

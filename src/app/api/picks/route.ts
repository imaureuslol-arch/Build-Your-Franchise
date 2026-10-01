import { sql } from "@/lib/db";
import { loadPickPlayers, teamPowerRatings } from "@/lib/picks";
import { valuePicks } from "@/lib/pick-value";

/**
 * GET /api/picks — every tradeable draft pick as a salary-free Player whose
 * `team` is its current owner (see pickPlayerId in src/lib/types.ts), each
 * team's power rating (1-100) keyed by team name, and each pick's value
 * (fair value, projected slot, rookie-scale salary) keyed by pick id.
 */
export async function GET() {
  const leagueId = process.env.SLEEPER_LEAGUE_ID ?? "";
  const [picks, power, teams] = await Promise.all([
    loadPickPlayers(),
    teamPowerRatings(leagueId),
    sql`select id, name from teams`,
  ]);
  const teamIds = new Map(teams.map((t) => [t.id as number, t.name as string]));
  const nextDraft = Math.min(...picks.map((p) => Number(p.name.slice(0, 4))));
  const values = valuePicks(picks, power, teamIds, nextDraft);
  return Response.json({ picks, power, values });
}

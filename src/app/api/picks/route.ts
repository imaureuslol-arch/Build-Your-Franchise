import { loadPickPlayers, teamPowerRatings } from "@/lib/picks";

/**
 * GET /api/picks — every tradeable draft pick as a salary-free Player whose
 * `team` is its current owner (see pickPlayerId in src/lib/types.ts), plus
 * each team's power rating (1-100) keyed by team name.
 */
export async function GET() {
  const [picks, power] = await Promise.all([loadPickPlayers(), teamPowerRatings()]);
  return Response.json({ picks, power });
}

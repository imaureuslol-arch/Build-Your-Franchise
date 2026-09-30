import { loadPickPlayers } from "@/lib/picks";

/**
 * GET /api/picks — every tradeable draft pick as a salary-free Player whose
 * `team` is its current owner (see pickPlayerId in src/lib/types.ts).
 */
export async function GET() {
  return Response.json({ picks: await loadPickPlayers() });
}

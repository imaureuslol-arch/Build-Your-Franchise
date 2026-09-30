import { loadLeague } from "@/lib/league";

/** GET /api/league — every player with contracts, plus the teams. */
export async function GET() {
  return Response.json(await loadLeague());
}

import { loadLeague } from "@/lib/league";
import { after } from "next/server";
import { sendCapWarnings } from "@/lib/cap-notifications";

export const maxDuration = 300;

/** GET /api/league — every player with contracts, plus the teams. */
export async function GET() {
  after(sendCapWarnings);
  return Response.json(await loadLeague());
}

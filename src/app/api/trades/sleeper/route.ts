import { getViewer, notLoggedIn } from "@/lib/auth";
import { listSleeperTrades, SleeperConnectionError } from "@/lib/sleeper-trades";

/** Accepted review-queue trades only. Reading this endpoint never moves assets. */
export async function GET() {
  if (!await getViewer()) return notLoggedIn();
  const headers = { "Cache-Control": "private, no-store" };
  try {
    return Response.json({ trades: await listSleeperTrades(), checkedAt: new Date().toISOString() }, { headers });
  } catch (error) {
    return Response.json({
      error: error instanceof SleeperConnectionError ? error.message : "Sleeper trades could not be checked. Try refreshing shortly.",
    }, { status: error instanceof SleeperConnectionError ? error.status : 500, headers });
  }
}

import { NextRequest, after } from "next/server";
import { audit } from "@/lib/auth";
import { syncFromSleeper } from "@/lib/sleeper-sync";
import { syncStats } from "@/lib/stats-sync";
import { refreshFairValues } from "@/lib/valuation";
import { getCurrentSeasonYear } from "@/lib/types";
import { sql } from "@/lib/db";
import { enforceHardCap } from "@/lib/cap-enforcement";
import { sendCapWarnings } from "@/lib/cap-notifications";

export const maxDuration = 300;

/**
 * Daily Sleeper sync, called by Vercel Cron (see vercel.json). Vercel sends
 * `Authorization: Bearer $CRON_SECRET` on its own.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const leagueId = process.env.SLEEPER_LEAGUE_ID;
  if (!leagueId) return Response.json({ error: "SLEEPER_LEAGUE_ID is not set" }, { status: 500 });

  // Cap deadlines still run when the external Sleeper service is unavailable.
  const cap = await enforceHardCap();
  after(sendCapWarnings);
  const rosters = await syncFromSleeper(leagueId);
  await sql`select byf_refresh_rfas(${getCurrentSeasonYear()}::int)`;
  const stats = await syncStats(leagueId);
  const valued = await refreshFairValues(getCurrentSeasonYear());
  const result = { ...rosters, cap, statsUpdated: stats.updated, statsSeason: stats.season, valued };
  await audit(null, "sleeper_sync", { ...result, fromCron: true });
  return Response.json(result);
}

import { NextRequest } from "next/server";
import { audit } from "@/lib/auth";
import { syncFromSleeper } from "@/lib/sleeper-sync";

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

  const result = await syncFromSleeper(leagueId);
  await audit(null, "sleeper_sync", { ...result, fromCron: true });
  return Response.json(result);
}

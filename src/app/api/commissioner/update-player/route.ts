import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { audit, forbidden, getViewer, isAnyCommish } from "@/lib/auth";
import { refreshFairValues } from "@/lib/valuation";
import { getCurrentSeasonYear } from "@/lib/types";

export async function POST(request: NextRequest) {
  // Stat edits are open to both commish tiers, matching the UI.
  const viewer = await getViewer();
  if (!isAnyCommish(viewer)) return forbidden();

  const { playerId, ppg, avg_gp, birthdate, gp_override } = (await request.json()) as {
    playerId: number;
    ppg?: number | null;
    avg_gp?: number | null;
    birthdate?: string | null;
    /** Expected games per season for fair value; null clears it. */
    gp_override?: number | null;
  };

  if (!playerId) {
    return Response.json({ error: "playerId is required" }, { status: 400 });
  }
  if (ppg === undefined && avg_gp === undefined && birthdate === undefined && gp_override === undefined) {
    return Response.json({ error: "No fields to update" }, { status: 400 });
  }

  // Each field is only written when the caller sent it.
  await sql`
    update players set
      ppg       = case when ${ppg !== undefined} then ${ppg ?? null}::real else ppg end,
      avg_gp    = case when ${avg_gp !== undefined} then ${avg_gp ?? null}::real else avg_gp end,
      birthdate = case when ${birthdate !== undefined} then ${birthdate ?? null}::date else birthdate end,
      gp_override = case when ${gp_override !== undefined} then ${gp_override ?? null}::real else gp_override end,
      -- Hand-entered stats survive the nightly sync while Sleeper has nothing for him.
      stats_manual = stats_manual or ${ppg !== undefined || avg_gp !== undefined}
    where id = ${playerId}`;
  await audit(viewer, "player_stats_updated", { playerId, ppg, avg_gp, birthdate, gp_override });
  // Values are relative to each other, so everyone's are recomputed.
  await refreshFairValues(getCurrentSeasonYear());

  return Response.json({ success: true });
}

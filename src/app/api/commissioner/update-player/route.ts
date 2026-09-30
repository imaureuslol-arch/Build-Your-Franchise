import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { audit, forbidden, getViewer, isAnyCommish } from "@/lib/auth";

export async function POST(request: NextRequest) {
  // Stat edits are open to both commish tiers, matching the UI.
  const viewer = await getViewer();
  if (!isAnyCommish(viewer)) return forbidden();

  const { playerId, ppg, avg_gp, birthdate } = (await request.json()) as {
    playerId: number;
    ppg?: number | null;
    avg_gp?: number | null;
    birthdate?: string | null;
  };

  if (!playerId) {
    return Response.json({ error: "playerId is required" }, { status: 400 });
  }
  if (ppg === undefined && avg_gp === undefined && birthdate === undefined) {
    return Response.json({ error: "No fields to update" }, { status: 400 });
  }

  // Each field is only written when the caller sent it.
  await sql`
    update players set
      ppg       = case when ${ppg !== undefined} then ${ppg ?? null}::real else ppg end,
      avg_gp    = case when ${avg_gp !== undefined} then ${avg_gp ?? null}::real else avg_gp end,
      birthdate = case when ${birthdate !== undefined} then ${birthdate ?? null}::date else birthdate end
    where id = ${playerId}`;
  await audit(viewer, "player_stats_updated", { playerId, ppg, avg_gp, birthdate });

  return Response.json({ success: true });
}

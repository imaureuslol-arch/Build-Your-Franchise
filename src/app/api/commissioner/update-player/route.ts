import { NextRequest } from "next/server";
import {
  getSupabaseServer,
  isCommissioner,
  isSubCommissioner,
} from "@/lib/server-auth";
import type { PlayersRow } from "@/lib/database.types";

export async function POST(request: NextRequest) {
  const supabase = getSupabaseServer();

  // Stat edits are open to both commish tiers, matching the UI.
  const allowed =
    (await isCommissioner(supabase, request)) ||
    (await isSubCommissioner(supabase, request));
  if (!allowed) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { playerId, ppg, avg_gp, birthdate } = body as {
    playerId: number;
    ppg: number | null;
    avg_gp: number | null;
    birthdate: string | null;
  };

  if (!playerId) {
    return Response.json({ error: "playerId is required" }, { status: 400 });
  }

  const updates: Partial<PlayersRow> = {};
  if (ppg !== undefined) updates.ppg = ppg;
  if (avg_gp !== undefined) updates.avg_gp = avg_gp;
  if (birthdate !== undefined) updates.birthdate = birthdate;

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "No fields to update" }, { status: 400 });
  }

  const { error } = await supabase
    .from("players")
    .update(updates)
    .eq("id", playerId);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}

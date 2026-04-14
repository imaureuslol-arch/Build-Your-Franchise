import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "edge";

function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(request: NextRequest) {
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

  const supabase = getSupabaseServer();

  const updates: Record<string, number | string | null> = {};
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

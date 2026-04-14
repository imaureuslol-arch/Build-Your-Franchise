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

/** GET — fetch all extensions (optionally filtered by team_name) */
export async function GET(request: NextRequest) {
  const teamName = request.nextUrl.searchParams.get("team");
  const supabase = getSupabaseServer();

  let query = supabase.from("extensions").select("*");
  if (teamName) query = query.eq("team_name", teamName);

  const { data, error } = await query;
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ extensions: data });
}

/** POST — save a completed extension negotiation */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { player_id, player_name, team_name, user_name, years, amounts, total_value, accepted } = body;

  if (
    player_id == null ||
    !player_name ||
    !team_name ||
    !user_name ||
    !Array.isArray(years) ||
    !amounts ||
    total_value == null ||
    accepted == null
  ) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  // Check if player already has an extension
  const { data: existing } = await supabase
    .from("extensions")
    .select("id")
    .eq("player_id", player_id)
    .maybeSingle();

  if (existing) {
    return Response.json(
      { error: "This player already has an extension on record." },
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from("extensions")
    .insert({
      player_id,
      player_name,
      team_name,
      user_name,
      years,
      amounts,
      total_value,
      accepted,
    })
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ extension: data }, { status: 201 });
}

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** GET — list distinct team_names currently mapped to IPs, with counts */
export async function GET() {
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from("ip_team_mappings")
    .select("team_name");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const name = row.team_name as string;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  const users = Array.from(counts.entries())
    .map(([team_name, ip_count]) => ({ team_name, ip_count }))
    .sort((a, b) => a.team_name.localeCompare(b.team_name));

  return Response.json({ users });
}

/** DELETE — drop all IP mappings for a given team_name */
export async function DELETE(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const team_name =
    body && typeof body === "object" && "team_name" in body
      ? (body as Record<string, unknown>).team_name
      : undefined;

  if (!team_name || typeof team_name !== "string") {
    return Response.json({ error: "team_name required" }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  const { error, count } = await supabase
    .from("ip_team_mappings")
    .delete({ count: "exact" })
    .eq("team_name", team_name);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true, removed: count ?? 0 });
}

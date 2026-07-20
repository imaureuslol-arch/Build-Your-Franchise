import { NextRequest } from "next/server";
import {
  getSupabaseServer,
  isCommissioner,
  currentEpoch,
} from "@/lib/server-auth";

/** GET — list distinct team_names currently mapped to IPs, with counts */
export async function GET(request: NextRequest) {
  const supabase = getSupabaseServer();

  if (!(await isCommissioner(supabase, request))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

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

/**
 * DELETE — fully log a team out: drop its IP whitelist entries AND bump its
 * session epoch, which invalidates any session cookie already issued. Dropping
 * the IP rows alone would leave cookie-holding browsers logged in.
 */
export async function DELETE(request: NextRequest) {
  const supabase = getSupabaseServer();

  if (!(await isCommissioner(supabase, request))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

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

  const { error, count } = await supabase
    .from("ip_team_mappings")
    .delete({ count: "exact" })
    .eq("team_name", team_name);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const epoch = await currentEpoch(supabase, team_name);
  const { error: epochError } = await supabase
    .from("team_pins")
    .update({ session_epoch: epoch + 1 })
    .eq("team_name", team_name);

  if (epochError) {
    return Response.json({ error: epochError.message }, { status: 500 });
  }

  return Response.json({ success: true, removed: count ?? 0 });
}

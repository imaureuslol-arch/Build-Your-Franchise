import { NextRequest } from "next/server";
import { getSupabaseServer, extractIp, isCommissioner } from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  const supabase = getSupabaseServer();

  if (!(await isCommissioner(supabase, request))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("banned_ips")
    .select("ip, reason, banned_at")
    .order("banned_at", { ascending: false });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ bans: data ?? [] });
}

export async function POST(request: NextRequest) {
  const callerIp = extractIp(request);
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

  const ip =
    body && typeof body === "object" && "ip" in body
      ? (body as Record<string, unknown>).ip
      : undefined;
  const reason =
    body && typeof body === "object" && "reason" in body
      ? (body as Record<string, unknown>).reason
      : null;

  if (!ip || typeof ip !== "string") {
    return Response.json({ error: "ip required" }, { status: 400 });
  }

  if (ip === callerIp) {
    return Response.json({ error: "Refusing to self-ban" }, { status: 400 });
  }

  const { error } = await supabase
    .from("banned_ips")
    .upsert(
      { ip, reason: typeof reason === "string" ? reason : null },
      { onConflict: "ip" }
    );

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}

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

  const ip =
    body && typeof body === "object" && "ip" in body
      ? (body as Record<string, unknown>).ip
      : undefined;

  if (!ip || typeof ip !== "string") {
    return Response.json({ error: "ip required" }, { status: 400 });
  }

  const { error } = await supabase.from("banned_ips").delete().eq("ip", ip);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}

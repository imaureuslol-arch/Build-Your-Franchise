import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function extractIp(request: NextRequest): string {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

async function requireCommissioner(
  supabase: ReturnType<typeof getSupabaseServer>,
  ip: string
): Promise<boolean> {
  const { data } = await supabase
    .from("commissioner_ips")
    .select("ip")
    .eq("ip", ip)
    .maybeSingle();
  return !!data;
}

export async function GET(request: NextRequest) {
  const ip = extractIp(request);
  const supabase = getSupabaseServer();

  if (!(await requireCommissioner(supabase, ip))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("ip_login_history")
    .select("id, ip, team_name, user_agent, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ history: data ?? [] });
}

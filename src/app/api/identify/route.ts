import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  // Prefer service role key (server-only) so RLS doesn't block writes.
  // Falls back to anon key if the service key isn't set.
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function extractIp(request: NextRequest): string {
  // Cloudflare sets cf-connecting-ip; Vercel sets x-forwarded-for
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

export async function GET(request: NextRequest) {
  const ip = extractIp(request);
  const supabase = getSupabaseServer();

  const { data, error } = await supabase
    .from("ip_team_mappings")
    .select("team_name")
    .eq("ip", ip)
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ team: data?.team_name ?? null });
}

export async function POST(request: NextRequest) {
  const ip = extractIp(request);

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

  const { error } = await supabase
    .from("ip_team_mappings")
    .upsert({ ip, team_name }, { onConflict: "ip" });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true, team: team_name });
}

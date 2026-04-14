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
  // Cloudflare sets cf-connecting-ip; Vercel sets x-forwarded-for
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

/** GET — returns whether the caller's IP is in the commissioner_ips whitelist */
export async function GET(request: NextRequest) {
  const ip = extractIp(request);
  const supabase = getSupabaseServer();

  const { data, error } = await supabase
    .from("commissioner_ips")
    .select("ip")
    .eq("ip", ip)
    .maybeSingle();

  if (error) {
    return Response.json({ whitelisted: false, error: error.message }, { status: 500 });
  }

  return Response.json({ whitelisted: !!data });
}

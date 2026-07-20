import { NextRequest } from "next/server";
import { getSupabaseServer, isCommissioner } from "@/lib/server-auth";

/**
 * GET — is the caller a super-commissioner?
 * True for a signed session cookie with the commish role, or an IP in the
 * commissioner_ips whitelist.
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabaseServer();
  return Response.json({ whitelisted: await isCommissioner(supabase, request) });
}

import { NextRequest } from "next/server";
import { getSupabaseServer, isSubCommissioner } from "@/lib/server-auth";

/**
 * GET — is the caller a sub-commissioner?
 * True for a signed session cookie with the subcommish role, or an IP in the
 * subcommissioner_ips whitelist.
 */
export async function GET(request: NextRequest) {
  const supabase = getSupabaseServer();
  return Response.json({ subcommish: await isSubCommissioner(supabase, request) });
}

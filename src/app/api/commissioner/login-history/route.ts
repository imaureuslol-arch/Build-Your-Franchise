import { NextRequest } from "next/server";
import { getSupabaseServer, isCommissioner } from "@/lib/server-auth";

export async function GET(request: NextRequest) {
  const supabase = getSupabaseServer();

  if (!(await isCommissioner(supabase, request))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("ip_login_history")
    .select("id, ip, team_name, user_agent, country, success, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ history: data ?? [] });
}

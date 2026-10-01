import { NextRequest } from "next/server";
import { sql } from "@/lib/db";

/** GET — every extension on record (optionally filtered by ?team=). */
export async function GET(request: NextRequest) {
  const team = request.nextUrl.searchParams.get("team");
  const extensions = await sql`
    select e.id, e.player_id, p.name as player_name, t.name as team_name,
           coalesce(t.owner_name, t.name) as user_name,
           e.years, e.amounts, e.total_value, e.accepted, e.created_at, e.owner_key, e.contract_version
    from extensions e
    join players p on p.id = e.player_id
    join teams t on t.id = e.team_id
    where ${team}::text is null or t.name = ${team}
    order by e.created_at desc`;
  return Response.json({ extensions });
}

// Offers and signings go through /api/extensions/negotiate, which runs the
// negotiation on the server.

import { sql } from "@/lib/db";
import { getViewer, isAnyCommish } from "@/lib/auth";

/**
 * GET — how many open trades are waiting on the logged-in viewer: proposals
 * his team hasn't answered, plus (for commissioners) trades every team has
 * accepted that need approval. Drives the badge next to Trades in the menu.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ count: 0 });
  const [row] = await sql`
    select
      (select count(*) from trades tr join trade_teams tt on tt.trade_id = tr.id
        where tr.status = 'proposed' and tt.team_id = ${viewer.teamId} and tt.accepted_at is null)::int
      + (case when ${isAnyCommish(viewer)} then
          (select count(*) from trades where status = 'accepted') else 0 end)::int as count`;
  return Response.json({ count: row.count });
}

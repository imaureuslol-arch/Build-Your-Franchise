import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { audit, forbidden, getViewer, isAnyCommish, notLoggedIn } from "@/lib/auth";
import { executeTrade } from "@/lib/trades";

type Action = "accept" | "decline" | "cancel" | "approve" | "reject";

/**
 * POST { action } on one trade.
 *   accept / decline  a team in the trade (not yet accepted)
 *   cancel            the team that proposed it
 *   approve / reject  a commissioner, once every team has accepted
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/trades/[id]">) {
  const viewer = await getViewer();
  if (!viewer) return notLoggedIn();
  const { id } = await ctx.params;
  const { action } = (await request.json()) as { action: Action };

  const [trade] = await sql`select id, status, proposed_by from trades where id = ${id}`;
  if (!trade) return Response.json({ error: "Trade not found" }, { status: 404 });
  const teams = await sql`select team_id, accepted_at from trade_teams where trade_id = ${id}`;
  const mine = teams.find((t) => t.team_id === viewer.teamId);

  switch (action) {
    case "accept": {
      if (trade.status !== "proposed" || !mine) return forbidden();
      await sql.transaction([
        sql`update trade_teams set accepted_at = now() where trade_id = ${id} and team_id = ${viewer.teamId}`,
        sql`update trades set status = 'accepted'
            where id = ${id} and status = 'proposed'
              and not exists (select 1 from trade_teams where trade_id = ${id} and accepted_at is null)`,
      ]);
      break;
    }
    case "decline":
      if (trade.status !== "proposed" || !mine) return forbidden();
      await sql`update trades set status = 'declined', decided_at = now() where id = ${id}`;
      break;
    case "cancel":
      if (!["proposed", "accepted"].includes(trade.status) || trade.proposed_by !== viewer.teamId) return forbidden();
      await sql`update trades set status = 'cancelled', decided_at = now() where id = ${id}`;
      break;
    case "approve": {
      if (trade.status !== "accepted" || !isAnyCommish(viewer)) return forbidden();
      const errors = await executeTrade(id);
      if (errors.length) return Response.json({ errors }, { status: 422 });
      break;
    }
    case "reject":
      if (!["proposed", "accepted"].includes(trade.status) || !isAnyCommish(viewer)) return forbidden();
      await sql`update trades set status = 'rejected', decided_at = now() where id = ${id}`;
      break;
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  await audit(viewer, `trade_${action}`, { id });
  return Response.json({ ok: true });
}

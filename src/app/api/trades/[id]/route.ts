import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { audit, forbidden, getViewer, isAnyCommish, notLoggedIn } from "@/lib/auth";
import { checkTrade, executeTrade, type TradeInput } from "@/lib/trades";
import { decodePickId, isPickId } from "@/lib/types";
import { adminError } from "@/lib/admin-errors";
import { checkRosters } from "@/lib/sleeper-sync";

type Action = "accept" | "decline" | "cancel" | "approve" | "reject" | "counter";

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
  const body = await request.json().catch(() => null) as { action: Action; revision: number; trade?: TradeInput } | null;
  if (!body) return Response.json({error:"Choose a trade response."}, {status:400});
  const { action } = body;

  const [trade] = await sql`select id, status, proposed_by from trades where id = ${id}`;
  if (!trade) return Response.json({ error: "Trade not found" }, { status: 404 });
  const teams = await sql`select team_id, accepted_at from trade_teams where trade_id = ${id}`;
  const mine = teams.find((t) => t.team_id === viewer.teamId);

  if (["accept", "decline", "cancel", "counter"].includes(action)) {
    if (!mine) return forbidden();
    if (!Number.isSafeInteger(body.revision) || body.revision < 0) {
      return Response.json({error:"Refresh the trade before responding."}, {status:409});
    }
    try {
      let counter = null;
      if (action === "counter") {
        const input = body.trade;
        if (!input || !Array.isArray(input.teams) || !Array.isArray(input.items)
          || !input.teams.every(t => typeof t.team === "string" && Number.isSafeInteger(t.retained) && t.retained >= 0)
          || !input.items.every(i => Number.isSafeInteger(i.playerId) && typeof i.from === "string" && typeof i.to === "string")) {
          return Response.json({error:"Choose the teams and items for your counteroffer."}, {status:400});
        }
        const checked = await checkTrade(input);
        if (!checked.ok) return Response.json({errors:checked.errors}, {status:422});
        counter = {
          teams: input.teams.map(t => ({teamId:checked.teamIds.get(t.team), retained:t.retained})),
          items: input.items.map(i => {
            const pick = isPickId(i.playerId) ? decodePickId(i.playerId) : null;
            return {playerId:i.playerId > 0 ? i.playerId : null, fromTeam:checked.teamIds.get(i.from), toTeam:checked.teamIds.get(i.to),
              kind:i.playerId > 0 ? "player" : pick ? "pick" : "dead_cap", pickSeason:pick?.season, pickRound:pick?.round, pickOriginal:pick?.originalTeamId};
          }),
        };
      }
      const [result] = await sql`select byf_trade_reply(${id}::uuid, ${viewer.teamId}::int, ${body.revision}::int,
        ${action}, ${JSON.stringify(counter)}::jsonb) as result`;
      await audit(viewer, `trade_${action}`, {id, revision:body.revision, ...(counter ? {counter} : {})});
      return Response.json(result.result);
    } catch (error) { return adminError(error); }
  }

  switch (action) {
    case "approve": {
      if (trade.status !== "accepted" || !isAnyCommish(viewer)) return forbidden();
      const errors = await executeTrade(id);
      if (errors.length) return Response.json({ errors }, { status: 422 });
      // The book now differs from Sleeper until the trade is made there too.
      if (process.env.SLEEPER_LEAGUE_ID) await checkRosters(process.env.SLEEPER_LEAGUE_ID).catch(() => {});
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

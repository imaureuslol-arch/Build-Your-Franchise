import { NextRequest } from "next/server";
import { audit, getViewer, isAnyCommish, notLoggedIn } from "@/lib/auth";
import { checkTrade, createTrade, executeTrade, listTrades, type TradeInput } from "@/lib/trades";
import { checkRosters } from "@/lib/sleeper-sync";
import { notifyTradeOffer } from "@/lib/trade-notifications";

/** GET — open proposals and the approved history. Public: trades are league news. */
export async function GET() {
  const [open, history] = await Promise.all([
    listTrades(["proposed", "accepted"]),
    listTrades(["approved"]),
  ]);
  return Response.json({ open, history });
}

/**
 * POST { trade, record? } — propose a trade that includes the caller's team.
 * With record: true a commissioner books it straight away (for trades
 * already made in Sleeper).
 */
export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return notLoggedIn();
  const { trade, record } = (await request.json()) as { trade: TradeInput; record?: boolean };

  if (record && !isAnyCommish(viewer)) {
    return Response.json({ error: "Only commissioners can record a trade directly." }, { status: 403 });
  }
  if (!record && !trade.teams.some((t) => t.team === viewer.teamName)) {
    return Response.json({ error: "You can only propose trades that include your team." }, { status: 403 });
  }

  const check = await checkTrade(trade);
  if (!check.ok) return Response.json({ errors: check.errors }, { status: 422 });

  const id = await createTrade(trade, check, record ? null : viewer.teamId, record ? "accepted" : "proposed");
  if (record) {
    const errors = await executeTrade(id);
    if (errors.length) return Response.json({ errors }, { status: 422 });
    if (process.env.SLEEPER_LEAGUE_ID) await checkRosters(process.env.SLEEPER_LEAGUE_ID).catch(() => {});
  }
  await audit(viewer, record ? "trade_recorded" : "trade_proposed", { id, trade });
  const notifications = !record && viewer.teamId != null
    ? await notifyTradeOffer(id, 0, viewer.teamId, trade, check.players) : undefined;
  return Response.json({ id, notifications }, { status: 201 });
}

import { NextRequest } from "next/server";
import { checkTrade, type TradeInput } from "@/lib/trades";

/** POST { trade } — run the server-side checks without saving anything. */
export async function POST(request: NextRequest) {
  const { trade } = (await request.json()) as { trade: TradeInput };
  const check = await checkTrade(trade);
  return Response.json(check.ok ? { valid: true, errors: [] } : { valid: false, errors: check.errors });
}

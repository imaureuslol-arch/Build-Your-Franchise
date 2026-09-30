import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { audit, forbidden, getViewer, notLoggedIn } from "@/lib/auth";
import { getExtensionYears, type Player } from "@/lib/types";

/** GET — every extension on record (optionally filtered by ?team=). */
export async function GET(request: NextRequest) {
  const team = request.nextUrl.searchParams.get("team");
  const extensions = await sql`
    select e.id, e.player_id, p.name as player_name, t.name as team_name,
           coalesce(t.owner_name, t.name) as user_name,
           e.years, e.amounts, e.total_value, e.accepted, e.created_at
    from extensions e
    join players p on p.id = e.player_id
    join teams t on t.id = e.team_id
    where ${team}::text is null or t.name = ${team}
    order by e.created_at desc`;
  return Response.json({ extensions });
}

/**
 * POST — record a finished negotiation. The team comes from the session, not
 * the body. An accepted extension writes its contract years straight into
 * the book.
 */
export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return notLoggedIn();
  if (viewer.teamId == null) return forbidden();

  let body: { player_id?: number; years?: number[]; amounts?: Record<string, number>; accepted?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { player_id, years, amounts, accepted } = body;
  if (player_id == null || !Array.isArray(years) || !amounts || accepted == null) {
    return Response.json({ error: "Missing required fields" }, { status: 400 });
  }

  const [player] = await sql`select id, name, team_id from players where id = ${player_id}`;
  if (!player || player.team_id !== viewer.teamId) {
    return Response.json({ error: "That player isn't on your team." }, { status: 403 });
  }

  // Only years after the current contract ends may be extended.
  const contracts = await sql`select season, amount from contracts where player_id = ${player_id}`;
  const asPlayer = { id: player.id, name: player.name, team: "", ppg: null, avg_gp: null,
    contract_27: null, contract_28: null, contract_29: null, contract_30: null } as Player;
  for (const c of contracts) {
    (asPlayer as unknown as Record<string, number>)[`contract_${String(c.season).slice(2)}`] = Number(c.amount);
  }
  const allowed = new Set(getExtensionYears(asPlayer));
  if (!years.every((y) => allowed.has(y))) {
    return Response.json({ error: "Those years can't be extended." }, { status: 400 });
  }

  const [existing] = await sql`select id from extensions where player_id = ${player_id}`;
  if (existing) {
    return Response.json({ error: "This player already has an extension on record." }, { status: 409 });
  }

  const cleanAmounts: Record<number, number> = {};
  for (const y of years) cleanAmounts[y] = Math.round(Number(amounts[y]) || 0);
  const total = Object.values(cleanAmounts).reduce((s, v) => s + v, 0);

  await sql.transaction([
    sql`insert into extensions (player_id, team_id, years, amounts, total_value, accepted)
        values (${player_id}, ${viewer.teamId}, ${years}, ${JSON.stringify(cleanAmounts)}, ${total}, ${accepted})`,
    ...(accepted
      ? years.map((y) => sql`insert into contracts (player_id, season, amount)
                             values (${player_id}, ${y}, ${cleanAmounts[y]})
                             on conflict (player_id, season) do update set amount = excluded.amount`)
      : []),
  ]);
  await audit(viewer, accepted ? "extension_signed" : "extension_rejected", { player: player.name, amounts: cleanAmounts });

  return Response.json({ ok: true }, { status: 201 });
}

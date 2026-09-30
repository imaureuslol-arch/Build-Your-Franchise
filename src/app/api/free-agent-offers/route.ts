import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { audit, forbidden, getViewer, isAnyCommish, notLoggedIn } from "@/lib/auth";

/** GET — every open bid, newest first. */
export async function GET() {
  const offers = await sql`
    select o.id, o.player_id::text as player_id, p.name as player_name,
           coalesce(t.owner_name, t.name) as user_name, t.name as team_name,
           o.years, o.amounts, o.total_value, o.created_at
    from free_agent_offers o
    join players p on p.id = o.player_id
    join teams t on t.id = o.team_id
    order by o.created_at desc`;
  return Response.json({ offers });
}

/** POST — place a bid for the logged-in team. */
export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return notLoggedIn();
  if (viewer.teamId == null) return forbidden();

  const { player_id, years, amounts } = (await request.json()) as {
    player_id: number;
    years: number[];
    amounts: Record<string, number>;
  };
  const [player] = await sql`select id, name, team_id from players where id = ${player_id}`;
  if (!player || player.team_id != null) {
    return Response.json({ error: "That player isn't a free agent." }, { status: 400 });
  }

  const clean: Record<number, number> = {};
  for (const y of years) clean[y] = Math.round(Number(amounts[y]) || 0);
  const total = Object.values(clean).reduce((s, v) => s + v, 0);

  const [row] = await sql`
    insert into free_agent_offers (player_id, team_id, years, amounts, total_value)
    values (${player_id}, ${viewer.teamId}, ${years}, ${JSON.stringify(clean)}, ${total})
    returning id, created_at`;
  await audit(viewer, "fa_bid", { player: player.name, amounts: clean });

  return Response.json({
    offer: {
      id: row.id,
      player_id: String(player_id),
      player_name: player.name,
      user_name: "",
      team_name: viewer.teamName,
      years,
      amounts: clean,
      total_value: total,
      created_at: row.created_at,
    },
  });
}

/** DELETE ?player_id= — clear all bids on a player. Either commish tier. */
export async function DELETE(request: NextRequest) {
  const viewer = await getViewer();
  if (!isAnyCommish(viewer)) return forbidden();
  const playerId = Number(request.nextUrl.searchParams.get("player_id"));
  await sql`delete from free_agent_offers where player_id = ${playerId}`;
  await audit(viewer, "fa_bids_cleared", { playerId });
  return Response.json({ ok: true });
}

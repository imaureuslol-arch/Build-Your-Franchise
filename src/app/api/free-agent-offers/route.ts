import { NextRequest } from 'next/server';
import { sql } from '@/lib/db';
import { forbidden, getViewer, isAnyCommish, notLoggedIn } from '@/lib/auth';
import { adminError, validId } from '@/lib/admin-errors';
import { getCurrentSeasonYear } from '@/lib/types';

export async function GET() {
  await sql`select byf_refresh_rfas(${getCurrentSeasonYear()}::int)`;
  const [row] = await sql`select jsonb_build_object(
    'round', to_jsonb(r), 'serverNow', clock_timestamp(),
    'auctions', coalesce((select jsonb_agg(a) from (
      select a.*, t.name as rfa_team_name, matched.name as matched_team_name from fa_player_auctions a
      left join teams t on coalesce('sleeper:' || t.sleeper_user_id, 'team:' || t.id) = a.rfa_owner_key
      left join teams matched on matched.id = a.matched_team_id where a.round_id = r.id) a), '[]'),
    'restrictedPlayers', coalesce((select jsonb_agg(jsonb_build_object('player_id',rf.player_id,'owner_key',rf.owner_key,'team_name',t.name))
      from restricted_free_agents rf left join teams t on coalesce('sleeper:' || t.sleeper_user_id,'team:' || t.id)=rf.owner_key), '[]'),
    'offers', coalesce((select jsonb_agg(b order by b.created_at, b.id) from (
      select o.*, p.name as player_name,
        coalesce(t.owner_name, t.name) as user_name, t.name as team_name
      from free_agent_offers o join players p on p.id = o.player_id join teams t on t.id = o.team_id
      where o.round_id = r.id) b), '[]'),
    'awards', coalesce((select jsonb_agg(a order by a.awarded_at desc) from (
      select a.*, p.name as player_name, t.name as team_name from fa_awards a
      join players p on p.id = a.player_id left join teams t on t.id = a.team_id
      where a.round_id = r.id) a), '[]')
    ) as data from fa_rounds r order by r.id desc limit 1`;
  return Response.json(row.data);
}

export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return notLoggedIn();
  if (viewer.teamId == null) return forbidden();
  const body = await request.json().catch(() => null);
  if (!body || !validId(body.player_id) || !validId(body.roundId) || !Array.isArray(body.years)
    || !body.years.every(Number.isSafeInteger) || !body.amounts || typeof body.amounts !== 'object' || Array.isArray(body.amounts)) {
    return Response.json({ error: 'Choose a player, seasons and bid amounts.' }, { status: 400 });
  }
  try {
    const payload = { action: 'bid', roundId: body.roundId, playerId: body.player_id, years: body.years, amounts: body.amounts };
    const [row] = await sql`select byf_fa_action(${JSON.stringify(payload)}::jsonb, ${viewer.sessionId}::uuid,
      ${viewer.teamId}::int, ${getCurrentSeasonYear()}::int) as result`;
    const bid = row.result.offer;
    const [player] = await sql`select name from players where id = ${bid.player_id}`;
    return Response.json({ offer: { ...bid, player_name: player.name, user_name: '', team_name: viewer.teamName } }, { status: 201 });
  } catch (error) { return adminError(error); }
}

export async function DELETE(request: NextRequest) {
  const viewer = await getViewer();
  if (!isAnyCommish(viewer)) return forbidden();
  const payload = { action: 'clear', roundId: Number(request.nextUrl.searchParams.get('round_id')),
    playerId: Number(request.nextUrl.searchParams.get('player_id')) };
  if (!validId(payload.roundId) || !validId(payload.playerId)) return Response.json({ error: 'Invalid player or round.' }, { status: 400 });
  try {
    const [row] = await sql`select byf_fa_action(${JSON.stringify(payload)}::jsonb, ${viewer!.sessionId}::uuid,
      ${viewer!.teamId}::int, ${getCurrentSeasonYear()}::int) as result`;
    return Response.json(row.result);
  } catch (error) { return adminError(error); }
}


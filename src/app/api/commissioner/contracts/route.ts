import { sql } from '@/lib/db';
import { forbidden, getViewer, isAnyCommish } from '@/lib/auth';
import { adminError, validId } from '@/lib/admin-errors';
export async function GET() {
  if (!isAnyCommish(await getViewer())) return forbidden();
  const [players, teams, deadCap] = await Promise.all([
    sql`select p.id, p.name, p.team_id as "teamId", coalesce(
      (select jsonb_object_agg(c.season::text, c.amount) from contracts c
       where c.player_id = p.id and c.season between byf_current_season() and byf_current_season() + 3), '{}') as contracts
      from players p order by p.name`,
    sql`select id, name from teams order by name`,
    sql`select id, team_id, label, season, amount::float8 as amount from dead_cap order by team_id, season, label`,
  ]);
  return Response.json({ players, teams, deadCap });
}
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!isAnyCommish(viewer)) return forbidden();
  const body = await request.json().catch(() => null);
  if (!body || !validId(body.playerId) || !(body.teamId === null || validId(body.teamId))
    || !body.expected || !body.contracts || Array.isArray(body.contracts)) {
    return Response.json({ error: 'Choose a player, team and contract amounts.' }, { status: 400 });
  }
  try {
    const [row] = await sql`select byf_contract_edit(${JSON.stringify(body)}::jsonb, ${viewer!.sessionId}::uuid, ${viewer!.teamId}::int) as result`;
    return Response.json(row.result);
  } catch (error) { return adminError(error); }
}

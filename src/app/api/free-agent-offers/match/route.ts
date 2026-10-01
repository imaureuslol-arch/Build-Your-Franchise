import { sql } from '@/lib/db';
import { forbidden, getViewer, notLoggedIn } from '@/lib/auth';
import { adminError, validId } from '@/lib/admin-errors';
import { getCurrentSeasonYear } from '@/lib/types';

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return notLoggedIn();
  if (viewer.teamId == null) return forbidden();
  const body = await request.json().catch(() => null);
  if (!body || !validId(body.roundId) || !validId(body.playerId)
    || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(body.offerId ?? '')) {
    return Response.json({error:'Choose a winning contract to match.'}, {status:400});
  }
  try {
    const payload = {action:'match',roundId:body.roundId,playerId:body.playerId,offerId:body.offerId};
    const [row] = await sql`select byf_fa_action(${JSON.stringify(payload)}::jsonb, ${viewer.sessionId}::uuid,
      ${viewer.teamId}::int, ${getCurrentSeasonYear()}::int) as result`;
    return Response.json(row.result);
  } catch (error) { return adminError(error); }
}

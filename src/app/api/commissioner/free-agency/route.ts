import { sql } from '@/lib/db';
import { forbidden, getViewer, isAnyCommish } from '@/lib/auth';
import { adminError, validId } from '@/lib/admin-errors';
import { getCurrentSeasonYear } from '@/lib/types';
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!isAnyCommish(viewer)) return forbidden();
  const body = await request.json().catch(() => null);
  if (!body || !validId(body.roundId) || !['deadline', 'new_round', 'award', 'dismiss'].includes(body.action)) {
    return Response.json({ error: 'Invalid free-agency action.' }, { status: 400 });
  }
  if (['deadline', 'new_round'].includes(body.action) && (typeof body.closesAt !== 'string' || !Number.isFinite(Date.parse(body.closesAt)))) {
    return Response.json({ error: 'Choose a date and time.' }, { status: 400 });
  }
  if (['award', 'dismiss'].includes(body.action) && !validId(body.playerId)) {
    return Response.json({ error: 'Choose a player.' }, { status: 400 });
  }
  if (body.action === 'award' && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(body.offerId ?? '')) {
    return Response.json({ error: 'Choose a winning bid.' }, { status: 400 });
  }
  if (body.action === 'dismiss' && (typeof body.note !== 'string' || !body.note.trim() || body.note.trim().length > 500)) {
    return Response.json({ error: 'Enter a reason for dismissing these bids.' }, { status: 400 });
  }
  try {
    const [row] = await sql`select byf_fa_action(${JSON.stringify(body)}::jsonb, ${viewer!.sessionId}::uuid,
      ${viewer!.teamId}::int, ${getCurrentSeasonYear()}::int) as result`;
    return Response.json(row.result);
  } catch (error) { return adminError(error); }
}

import { sql } from '@/lib/db';
import { forbidden, getViewer, isAnyCommish } from '@/lib/auth';
import { adminError, validId } from '@/lib/admin-errors';
import { getSalaryYears } from '@/lib/types';
export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!isAnyCommish(viewer)) return forbidden();
  const body = await request.json().catch(() => null);
  const valid = body && (body.action === 'delete'
    ? validId(body.id) && body.expected
    : body.action === 'save' && (body.id == null || (validId(body.id) && body.expected))
      && validId(body.teamId) && getSalaryYears().includes(body.season)
      && Number.isSafeInteger(body.amount) && body.amount !== 0 && Math.abs(body.amount) <= 1e12
      && typeof body.label === 'string' && body.label.trim().length > 0 && body.label.trim().length <= 160);
  if (!valid) return Response.json({ error: 'Enter a team, season, label and non-zero whole dollar amount.' }, { status: 400 });
  try {
    const [row] = await sql`select byf_dead_cap_edit(${JSON.stringify(body)}::jsonb, ${viewer!.sessionId}::uuid, ${viewer!.teamId}::int) as result`;
    return Response.json(row.result);
  } catch (error) { return adminError(error); }
}

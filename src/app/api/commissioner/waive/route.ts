import { sql } from "@/lib/db";
import { forbidden, getViewer, isAnyCommish } from "@/lib/auth";
import { adminError, validId } from "@/lib/admin-errors";

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!isAnyCommish(viewer)) return forbidden();
  const body = await request.json().catch(() => null);
  if (!body || !validId(body.playerId) || !validId(body.expected?.teamId)
    || !validId(body.expected?.contractVersion)
    || !validId(body.expectedSeason) || !Number.isSafeInteger(body.expectedDeadCap) || body.expectedDeadCap < 0
    || !body.expected?.contracts || typeof body.expected.contracts !== "object" || Array.isArray(body.expected.contracts)) {
    return Response.json({ error: "Select a rostered player and reload their contract." }, { status: 400 });
  }
  try {
    const [row] = await sql`select byf_waive_player(${JSON.stringify(body)}::jsonb,
      ${viewer!.sessionId}::uuid, ${viewer!.teamId}::int) as result`;
    return Response.json(row.result);
  } catch (error) { return adminError(error); }
}

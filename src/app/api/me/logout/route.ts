import { cookies } from "next/headers";
import { getViewer, revokeSession, SESSION_COOKIE } from "@/lib/auth";

/** POST /api/me/logout — end this device's session only. */
export async function POST() {
  const viewer = await getViewer();
  if (viewer) await revokeSession(viewer.sessionId);
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}

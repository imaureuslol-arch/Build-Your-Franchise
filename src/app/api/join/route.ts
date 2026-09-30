import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { redeemLink, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

/**
 * POST /api/join { token } — trade a login link for a session cookie.
 * A POST rather than the link itself, so chat apps that preview URLs
 * can't use up a one-time device link.
 */
export async function POST(request: NextRequest) {
  const { token } = (await request.json().catch(() => ({}))) as { token?: string };
  if (!token) return Response.json({ error: "Missing token" }, { status: 400 });
  const session = await redeemLink(
    token,
    request.headers.get("user-agent"),
    request.headers.get("x-vercel-ip-country")
  );
  if (!session) {
    return Response.json(
      { error: "This link doesn't work any more. Ask the commissioner for a new one." },
      { status: 410 }
    );
  }
  (await cookies()).set(SESSION_COOKIE, session, sessionCookieOptions);
  return Response.json({ ok: true });
}

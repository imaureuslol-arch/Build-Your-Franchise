import { NextRequest } from "next/server";
import {
  getSupabaseServer,
  extractIp,
  isBannedIp,
  readSession,
  buildSessionCookie,
  jsonWithCookie,
  recentFailures,
  recordAttempt,
  clearFailures,
  lockoutResponse,
  MAX_FAILED_ATTEMPTS,
} from "@/lib/server-auth";
import type { SessionRole } from "@/lib/server-auth";
import {
  timingSafeEqual,
  COMMISH_PIN_DIGITS,
  SUBCOMMISH_PIN_DIGITS,
} from "@/lib/pin";

/**
 * POST — elevate to commissioner or sub-commissioner with a PIN.
 *
 * The two PINs live in env vars (COMMISSIONER_PIN, SUBCOMMISSIONER_PIN) rather
 * than the database — there are only two of them and they're handed out by
 * hand. Length picks the role: 8 digits = commish, 6 = sub-commish.
 *
 * On success the IP is added to commissioner_ips / subcommissioner_ips, which
 * is what the existing guards already read, so the PIN is asked for once.
 */
export async function POST(request: NextRequest) {
  const ip = extractIp(request);
  const userAgent = request.headers.get("user-agent") ?? null;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const pin = (body as Record<string, unknown> | null)?.pin;

  if (typeof pin !== "string" || !/^\d+$/.test(pin)) {
    return Response.json({ error: "Incorrect PIN." }, { status: 401 });
  }

  const supabase = getSupabaseServer();

  if (await isBannedIp(supabase, ip)) {
    return Response.json({ error: "Access revoked" }, { status: 403 });
  }

  if ((await recentFailures(supabase, ip)) >= MAX_FAILED_ATTEMPTS) {
    return lockoutResponse();
  }

  const commishPin = process.env.COMMISSIONER_PIN ?? "";
  const subCommishPin = process.env.SUBCOMMISSIONER_PIN ?? "";

  let role: SessionRole | null = null;
  if (
    pin.length === COMMISH_PIN_DIGITS &&
    commishPin.length === COMMISH_PIN_DIGITS &&
    timingSafeEqual(pin, commishPin)
  ) {
    role = "commish";
  } else if (
    pin.length === SUBCOMMISH_PIN_DIGITS &&
    subCommishPin.length === SUBCOMMISH_PIN_DIGITS &&
    timingSafeEqual(pin, subCommishPin)
  ) {
    role = "subcommish";
  }

  if (!role) {
    await recordAttempt(supabase, ip, "__commish__", false);
    const failures = await recentFailures(supabase, ip);
    return Response.json(
      {
        error: "Incorrect PIN.",
        attemptsLeft: Math.max(0, MAX_FAILED_ATTEMPTS - failures),
      },
      { status: 401 }
    );
  }

  const table = role === "commish" ? "commissioner_ips" : "subcommissioner_ips";
  const { error } = await supabase
    .from(table)
    .upsert({ ip }, { onConflict: "ip" });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await recordAttempt(supabase, ip, `__${role}__`, true);
  await clearFailures(supabase, ip);

  await supabase.from("ip_login_history").insert({
    ip,
    team_name: role === "commish" ? "(commissioner)" : "(sub-commissioner)",
    user_agent: userAgent,
    country: request.headers.get("cf-ipcountry") ?? null,
    success: true,
  });

  // Keep whatever team this browser already proved.
  const session = await readSession(request);
  const cookie = await buildSessionCookie({
    t: session?.t,
    e: session?.e,
    r: role,
    iat: Math.floor(Date.now() / 1000),
  });

  return jsonWithCookie({ success: true, role }, cookie);
}

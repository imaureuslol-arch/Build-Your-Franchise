import { NextRequest } from "next/server";
import {
  getSupabaseServer,
  extractIp,
  isBannedIp,
  readSession,
  sessionTeam,
  currentEpoch,
  buildSessionCookie,
  clearSessionCookie,
  jsonWithCookie,
  recentFailures,
  recordAttempt,
  clearFailures,
  lockoutResponse,
  MAX_FAILED_ATTEMPTS,
} from "@/lib/server-auth";
import { verifyPin, isValidPinFormat, TEAM_PIN_DIGITS } from "@/lib/pin";

/**
 * GET — who is this browser?
 *
 * Checks the signed session cookie first, then falls back to the IP whitelist
 * in `ip_team_mappings`. Either one means the owner already entered their PIN
 * on this device, so they're never asked again.
 */
export async function GET(request: NextRequest) {
  const ip = extractIp(request);
  const supabase = getSupabaseServer();

  if (await isBannedIp(supabase, ip)) {
    return Response.json({ team: null, banned: true });
  }

  const cookieTeam = await sessionTeam(supabase, request);
  if (cookieTeam) {
    // Re-whitelist a roaming IP, but never steal an IP another team already
    // holds — two owners behind one carrier NAT would otherwise fight over it.
    const { data: existing } = await supabase
      .from("ip_team_mappings")
      .select("team_name")
      .eq("ip", ip)
      .maybeSingle();

    if (!existing) {
      await supabase
        .from("ip_team_mappings")
        .upsert({ ip, team_name: cookieTeam }, { onConflict: "ip" });
    }

    return Response.json({ team: cookieTeam, banned: false });
  }

  // A cookie that failed the epoch check means the commissioner logged this
  // team out — drop it so the browser stops presenting it.
  const staleSession = await readSession(request);
  if (staleSession?.t) {
    return jsonWithCookie({ team: null, banned: false }, clearSessionCookie());
  }

  const { data, error } = await supabase
    .from("ip_team_mappings")
    .select("team_name")
    .eq("ip", ip)
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ team: data?.team_name ?? null, banned: false });
}

/**
 * POST — claim a team by entering its PIN.
 *
 * On success the caller's IP is written to `ip_team_mappings` (the whitelist
 * that skips the PIN next time) and a signed session cookie is issued.
 */
export async function POST(request: NextRequest) {
  const ip = extractIp(request);
  const userAgent = request.headers.get("user-agent") ?? null;
  // Cloudflare populates this on every request routed through their edge.
  const country = request.headers.get("cf-ipcountry") ?? null;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fields = (body ?? {}) as Record<string, unknown>;
  const team_name = fields.team_name;
  const pin = fields.pin;

  if (!team_name || typeof team_name !== "string") {
    return Response.json({ error: "team_name required" }, { status: 400 });
  }

  if (!isValidPinFormat(pin, TEAM_PIN_DIGITS)) {
    return Response.json(
      { error: `Enter your ${TEAM_PIN_DIGITS}-digit PIN.` },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServer();

  if (await isBannedIp(supabase, ip)) {
    return Response.json({ error: "Access revoked" }, { status: 403 });
  }

  // Rate limit before hashing — a locked-out IP shouldn't cost us PBKDF2 cycles.
  if ((await recentFailures(supabase, ip)) >= MAX_FAILED_ATTEMPTS) {
    return lockoutResponse();
  }

  const { data: pinRow, error: pinError } = await supabase
    .from("team_pins")
    .select("pin_hash")
    .eq("team_name", team_name)
    .maybeSingle();

  // team_pins is the one RLS-locked table, so a read failure here almost
  // always means SUPABASE_SERVICE_ROLE_KEY is missing and we fell back to the
  // anon key. Say so instead of telling every owner their PIN is wrong.
  if (pinError) {
    console.error("team_pins read failed:", pinError.message);
    return Response.json(
      { error: "Login is misconfigured — tell the commissioner." },
      { status: 500 }
    );
  }

  // Same generic message whether the team has no PIN, doesn't exist, or the
  // PIN is simply wrong — don't confirm which teams are claimable.
  const ok = pinRow?.pin_hash
    ? await verifyPin(pin, pinRow.pin_hash as string)
    : false;

  if (!ok) {
    await recordAttempt(supabase, ip, team_name, false);
    await supabase
      .from("ip_login_history")
      .insert({ ip, team_name, user_agent: userAgent, country, success: false });

    const failures = await recentFailures(supabase, ip);
    return Response.json(
      {
        error: "Incorrect PIN.",
        attemptsLeft: Math.max(0, MAX_FAILED_ATTEMPTS - failures),
      },
      { status: 401 }
    );
  }

  // Correct PIN — whitelist this IP so the PIN isn't needed again.
  const { error } = await supabase
    .from("ip_team_mappings")
    .upsert({ ip, team_name }, { onConflict: "ip" });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  await recordAttempt(supabase, ip, team_name, true);
  await clearFailures(supabase, ip);

  // Append-only login trail for auditing — never updates, every claim is a new row.
  await supabase
    .from("ip_login_history")
    .insert({ ip, team_name, user_agent: userAgent, country, success: true });

  // Preserve any elevated role already proven on this browser.
  const session = await readSession(request);
  const cookie = await buildSessionCookie({
    t: team_name,
    e: await currentEpoch(supabase, team_name),
    r: session?.r,
    iat: Math.floor(Date.now() / 1000),
  });

  return jsonWithCookie({ success: true, team: team_name }, cookie);
}

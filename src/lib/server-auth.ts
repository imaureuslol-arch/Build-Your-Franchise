/**
 * Shared server-side auth helpers: Supabase service client, client IP
 * extraction, the signed session cookie, PIN attempt rate limiting, and the
 * commissioner / sub-commissioner guards.
 *
 * Recognition works on two independent signals:
 *   1. the caller's IP, whitelisted in `ip_team_mappings` / `commissioner_ips`
 *      / `subcommissioner_ips` after a successful PIN entry
 *   2. a signed, HttpOnly cookie set at the same moment
 *
 * The cookie survives a changed IP, and disambiguates two owners sharing one
 * egress IP (mobile CGNAT), where the `ip` primary key can only hold one team.
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type SupabaseServer = ReturnType<typeof createClient<Database>>;

let warnedAboutKey = false;

export function getSupabaseServer(): SupabaseServer {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceKey && !warnedAboutKey) {
    warnedAboutKey = true;
    console.warn(
      "[auth] SUPABASE_SERVICE_ROLE_KEY is not set — falling back to the anon " +
        "key. team_pins and pin_attempts are RLS-locked, so every PIN login " +
        "will fail until this is configured."
    );
  }

  const key = serviceKey ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

export function extractIp(request: NextRequest): string {
  // Local dev has no proxy headers, so every request would share one identity
  // ("unknown") and you could never test two owners on one machine. DEV_FAKE_IP
  // in .env.local overrides it. Guarded by NODE_ENV, which is "production" on
  // Vercel (including preview deploys), so this can never apply in the wild.
  if (process.env.NODE_ENV !== "production" && process.env.DEV_FAKE_IP) {
    return process.env.DEV_FAKE_IP.trim();
  }

  // Vercel sets x-forwarded-for; Cloudflare sets cf-connecting-ip.
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

/* ------------------------------------------------------------------ */
/* Signed session cookie                                               */
/* ------------------------------------------------------------------ */

export const SESSION_COOKIE = "byf_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export type SessionRole = "commish" | "subcommish";

export interface Session {
  /** Team name this browser proved ownership of */
  t?: string;
  /** team_pins.session_epoch at issue time — stale cookies are rejected */
  e?: number;
  /** Elevated role this browser proved with the commish/sub-commish PIN */
  r?: SessionRole;
  /** Issued-at, epoch seconds */
  iat: number;
}

function getSecret(): string | null {
  return process.env.SESSION_SECRET || null;
}

function b64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );
  return b64urlEncode(new Uint8Array(sig));
}

function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Read and verify the session cookie. Returns null when absent, tampered
 * with, or when SESSION_SECRET is unset (in which case the app falls back to
 * IP-only recognition).
 */
export async function readSession(request: NextRequest): Promise<Session | null> {
  const secret = getSecret();
  if (!secret) return null;

  const raw = request.cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;

  const payload = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);

  const expected = await sign(payload, secret);
  if (!constantTimeEqual(signature, expected)) return null;

  try {
    const json = new TextDecoder().decode(b64urlDecode(payload));
    const parsed = JSON.parse(json) as Session;
    if (typeof parsed?.iat !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Build the `Set-Cookie` header value for a session. Returns null when
 * SESSION_SECRET is unset so callers can skip setting it.
 */
export async function buildSessionCookie(session: Session): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;

  const payload = b64urlEncode(
    new TextEncoder().encode(JSON.stringify(session))
  );
  const signature = await sign(payload, secret);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  return `${SESSION_COOKIE}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure}`;
}

/** `Set-Cookie` value that deletes the session. */
export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/** JSON response with a Set-Cookie header attached (cookie may be null). */
export function jsonWithCookie(
  body: unknown,
  cookie: string | null,
  init?: ResponseInit
): Response {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(JSON.stringify(body), { ...init, headers });
}

/* ------------------------------------------------------------------ */
/* Role guards                                                         */
/* ------------------------------------------------------------------ */

export async function isCommissioner(
  supabase: SupabaseServer,
  request: NextRequest
): Promise<boolean> {
  const session = await readSession(request);
  if (session?.r === "commish") return true;

  const { data } = await supabase
    .from("commissioner_ips")
    .select("ip")
    .eq("ip", extractIp(request))
    .maybeSingle();
  return !!data;
}

export async function isSubCommissioner(
  supabase: SupabaseServer,
  request: NextRequest
): Promise<boolean> {
  const session = await readSession(request);
  if (session?.r === "subcommish") return true;

  const { data } = await supabase
    .from("subcommissioner_ips")
    .select("ip")
    .eq("ip", extractIp(request))
    .maybeSingle();
  return !!data;
}

/** Current session epoch for a team (0 when the team has no PIN row yet). */
export async function currentEpoch(
  supabase: SupabaseServer,
  teamName: string
): Promise<number> {
  const { data } = await supabase
    .from("team_pins")
    .select("session_epoch")
    .eq("team_name", teamName)
    .maybeSingle();
  return (data?.session_epoch as number | undefined) ?? 0;
}

/**
 * The team this browser's cookie proves, or null when there is no cookie or
 * the commissioner has logged that team out (epoch bumped) since it was issued.
 */
export async function sessionTeam(
  supabase: SupabaseServer,
  request: NextRequest
): Promise<string | null> {
  const session = await readSession(request);
  if (!session?.t) return null;
  const epoch = await currentEpoch(supabase, session.t);
  return (session.e ?? 0) === epoch ? session.t : null;
}

export async function isBannedIp(
  supabase: SupabaseServer,
  ip: string
): Promise<boolean> {
  const { data } = await supabase
    .from("banned_ips")
    .select("ip")
    .eq("ip", ip)
    .maybeSingle();
  return !!data;
}

/* ------------------------------------------------------------------ */
/* PIN attempt rate limiting                                           */
/* ------------------------------------------------------------------ */

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

/**
 * Failed PIN attempts from this IP inside the lockout window. Callers should
 * bail out before hashing when this hits MAX_FAILED_ATTEMPTS — that also keeps
 * a flood of guesses from burning PBKDF2 cycles.
 */
export async function recentFailures(
  supabase: SupabaseServer,
  ip: string
): Promise<number> {
  const since = new Date(Date.now() - LOCKOUT_MINUTES * 60_000).toISOString();
  const { count } = await supabase
    .from("pin_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .eq("success", false)
    .gte("created_at", since);
  return count ?? 0;
}

export async function recordAttempt(
  supabase: SupabaseServer,
  ip: string,
  scope: string,
  success: boolean
): Promise<void> {
  await supabase.from("pin_attempts").insert({ ip, scope, success });
}

/** Wipe an IP's failure streak — called after a correct PIN. */
export async function clearFailures(
  supabase: SupabaseServer,
  ip: string
): Promise<void> {
  await supabase.from("pin_attempts").delete().eq("ip", ip).eq("success", false);
}

export function lockoutResponse(): Response {
  return Response.json(
    {
      error: `Too many incorrect PINs. Try again in ${LOCKOUT_MINUTES} minutes.`,
      lockedOut: true,
    },
    { status: 429 }
  );
}

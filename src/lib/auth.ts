/**
 * Login links and sessions.
 *
 * The commissioner generates one permanent link per team and sends it to the
 * owner (a Sleeper DM works). Opening it creates a session: a random token in
 * an HttpOnly cookie, stored server-side only as a SHA-256 hash. Owners can
 * make one-time 10-minute links to add their other devices. Revoking a team
 * kills its link and every session it spawned.
 *
 * Commissioner access is the same mechanism: a link carrying role 'commish'
 * or 'subcommish'. The first one is minted with scripts/make-link.mjs.
 */

import { cookies } from "next/headers";
import { sql } from "./db";

export const SESSION_COOKIE = "byf_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 365; // 1 year
const DEVICE_LINK_TTL_MS = 10 * 60 * 1000;
// last_seen is only written when it is older than this, so page loads
// don't each cost a write.
const LAST_SEEN_RESOLUTION_MS = 60 * 60 * 1000;

export type Role = "commish" | "subcommish";

export interface Viewer {
  sessionId: string;
  teamId: number | null;
  teamName: string | null;
  role: Role | null;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

/**
 * Replace a team's permanent link. The old link stops working; sessions it
 * already created stay logged in unless `logOutDevices` is set.
 */
export async function createTeamLink(
  teamId: number | null,
  role: Role | null,
  logOutDevices: boolean
): Promise<string> {
  const token = randomToken();
  const hash = await hashToken(token);
  // A commissioner link that also carries a team is left alone when that
  // team's owner link is replaced.
  const scope = teamId != null ? sql`team_id = ${teamId} and role is null` : sql`role = ${role}`;
  await sql.transaction([
    sql`update login_links set revoked_at = now()
        where kind = 'team' and revoked_at is null and ${scope}`,
    ...(logOutDevices
      ? [sql`update sessions set revoked_at = now() where revoked_at is null and ${scope}`]
      : []),
    sql`insert into login_links (token_hash, team_id, role, kind)
        values (${hash}, ${teamId}, ${role}, 'team')`,
  ]);
  return token;
}

/** One-time link, valid 10 minutes, carrying the same team and role as the caller. */
export async function createDeviceLink(viewer: Viewer): Promise<string> {
  const token = randomToken();
  const hash = await hashToken(token);
  const expires = new Date(Date.now() + DEVICE_LINK_TTL_MS).toISOString();
  await sql`insert into login_links (token_hash, team_id, role, kind, expires_at)
            values (${hash}, ${viewer.teamId}, ${viewer.role}, 'device', ${expires})`;
  return token;
}

/** Log out every device of a team and disable its link, without issuing a new one. */
export async function revokeTeam(teamId: number): Promise<void> {
  await sql.transaction([
    sql`update login_links set revoked_at = now() where team_id = ${teamId} and revoked_at is null`,
    sql`update sessions set revoked_at = now() where team_id = ${teamId} and revoked_at is null`,
  ]);
}

export async function revokeSession(sessionId: string): Promise<void> {
  await sql`update sessions set revoked_at = now() where id = ${sessionId}`;
}

/**
 * Trade a link token for a session token. Returns null if the link is
 * unknown, revoked, expired, or (for device links) already used.
 */
export async function redeemLink(
  token: string,
  userAgent: string | null,
  country: string | null
): Promise<string | null> {
  const hash = await hashToken(token);
  const links = await sql`
    select id, team_id, role, kind from login_links
    where token_hash = ${hash} and revoked_at is null
      and (expires_at is null or expires_at > now())
      and (kind = 'team' or used_at is null)`;
  const link = links[0];
  if (!link) return null;

  const sessionToken = randomToken();
  const sessionHash = await hashToken(sessionToken);
  await sql.transaction([
    sql`update login_links set used_at = coalesce(used_at, now()) where id = ${link.id}`,
    sql`insert into sessions (token_hash, team_id, role, link_id, user_agent, country)
        values (${sessionHash}, ${link.team_id}, ${link.role}, ${link.id}, ${userAgent}, ${country})`,
  ]);
  return sessionToken;
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE,
};

/* ------------------------------------------------------------------ */
/* Current viewer                                                      */
/* ------------------------------------------------------------------ */

export async function getViewer(): Promise<Viewer | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const hash = await hashToken(token);
  const rows = await sql`
    select s.id, s.team_id, s.role, s.last_seen, t.name as team_name
    from sessions s left join teams t on t.id = s.team_id
    where s.token_hash = ${hash} and s.revoked_at is null`;
  const s = rows[0];
  if (!s) return null;

  if (Date.now() - new Date(s.last_seen).getTime() > LAST_SEEN_RESOLUTION_MS) {
    await sql`update sessions set last_seen = now() where id = ${s.id}`;
  }
  return { sessionId: s.id, teamId: s.team_id, teamName: s.team_name, role: s.role };
}

export function isCommish(v: Viewer | null): boolean {
  return v?.role === "commish";
}

export function isAnyCommish(v: Viewer | null): boolean {
  return v?.role === "commish" || v?.role === "subcommish";
}

export async function audit(
  viewer: Viewer | null,
  action: string,
  detail: unknown
): Promise<void> {
  await sql`insert into audit_log (session_id, team_id, action, detail)
            values (${viewer?.sessionId ?? null}, ${viewer?.teamId ?? null}, ${action}, ${JSON.stringify(detail)})`;
}

export const forbidden = () => Response.json({ error: "Forbidden" }, { status: 403 });
export const notLoggedIn = () =>
  Response.json({ error: "Open your login link first — ask the commissioner if you don't have one." }, { status: 401 });

import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import {
  audit,
  createTeamLink,
  forbidden,
  getViewer,
  isCommish,
  revokeSession,
  revokeTeam,
  type Role,
} from "@/lib/auth";

/** GET — every team with its link status and logged-in devices. Commish only. */
export async function GET() {
  if (!isCommish(await getViewer())) return forbidden();

  const [teams, sessions, roleLinks] = await Promise.all([
    sql`select t.id, t.name, t.owner_name,
               (select max(created_at) from login_links l
                 where l.team_id = t.id and l.kind = 'team' and l.revoked_at is null) as link_created
        from teams t order by t.name`,
    sql`select id, team_id, role, user_agent, country, created_at, last_seen
        from sessions where revoked_at is null order by last_seen desc`,
    sql`select role, max(created_at) as link_created from login_links
        where team_id is null and kind = 'team' and revoked_at is null group by role`,
  ]);

  return Response.json({ teams, sessions, roleLinks });
}

type Body =
  | { action: "new_link"; teamId: number; logOutDevices?: boolean }
  | { action: "new_role_link"; role: Role }
  | { action: "revoke_team"; teamId: number }
  | { action: "end_session"; sessionId: string };

/** POST — issue or revoke links and sessions. Returns { url } for new links. */
export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  if (!isCommish(viewer)) return forbidden();
  const body = (await request.json()) as Body;
  const origin = request.nextUrl.origin;

  switch (body.action) {
    case "new_link": {
      const token = await createTeamLink(body.teamId, null, !!body.logOutDevices);
      await audit(viewer, "team_link_created", { teamId: body.teamId, logOutDevices: !!body.logOutDevices });
      return Response.json({ url: `${origin}/join/${token}` });
    }
    case "new_role_link": {
      const token = await createTeamLink(null, body.role, false);
      await audit(viewer, "role_link_created", { role: body.role });
      return Response.json({ url: `${origin}/join/${token}` });
    }
    case "revoke_team":
      await revokeTeam(body.teamId);
      await audit(viewer, "team_revoked", { teamId: body.teamId });
      return Response.json({ ok: true });
    case "end_session":
      await revokeSession(body.sessionId);
      await audit(viewer, "session_ended", { sessionId: body.sessionId });
      return Response.json({ ok: true });
    default:
      return Response.json({ error: "Unknown action" }, { status: 400 });
  }
}

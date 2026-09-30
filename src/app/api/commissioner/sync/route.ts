import { sql } from "@/lib/db";
import { audit, forbidden, getViewer, isAnyCommish } from "@/lib/auth";
import { syncFromSleeper } from "@/lib/sleeper-sync";

/** GET — open roster issues from the last sync. Either commish tier. */
export async function GET() {
  if (!isAnyCommish(await getViewer())) return forbidden();
  const issues = await sql`
    select i.id, i.kind, i.detail, i.created_at, p.name as player, t.name as team
    from sync_issues i
    left join players p on p.id = i.player_id
    left join teams t on t.id = i.team_id
    order by i.kind, t.name, p.name`;
  return Response.json({ issues });
}

/** POST — run the Sleeper sync now. The daily run is /api/cron/sleeper-sync. */
export async function POST() {
  const viewer = await getViewer();
  if (!isAnyCommish(viewer)) return forbidden();

  const leagueId = process.env.SLEEPER_LEAGUE_ID;
  if (!leagueId) return Response.json({ error: "SLEEPER_LEAGUE_ID is not set" }, { status: 500 });

  const result = await syncFromSleeper(leagueId);
  await audit(viewer, "sleeper_sync", result);
  return Response.json(result);
}

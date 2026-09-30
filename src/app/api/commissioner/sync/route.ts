import { sql } from "@/lib/db";
import { audit, forbidden, getViewer, isAnyCommish } from "@/lib/auth";
import { applySleeperRosters, checkRosters, syncFromSleeper } from "@/lib/sleeper-sync";
import { syncStats } from "@/lib/stats-sync";
import { refreshFairValues } from "@/lib/valuation";
import { getCurrentSeasonYear } from "@/lib/types";

/**
 * GET — roster issues, re-checked against Sleeper on every call so the list
 * is never stale. Either commish tier. If Sleeper is unreachable the last
 * stored list is returned.
 */
export async function GET() {
  if (!isAnyCommish(await getViewer())) return forbidden();
  const leagueId = process.env.SLEEPER_LEAGUE_ID;
  if (leagueId) await checkRosters(leagueId).catch(() => {});
  const issues = await sql`
    select i.id, i.kind, i.detail, i.created_at, p.name as player, t.name as team
    from sync_issues i
    left join players p on p.id = i.player_id
    left join teams t on t.id = i.team_id
    order by i.kind, t.name, p.name`;
  return Response.json({ issues });
}

/**
 * POST — "Sync now": pull Sleeper, make rosters match it (moving, releasing
 * and undoing trades as needed), then refresh stats and values. The daily
 * run (/api/cron/sleeper-sync) does everything except moving players.
 */
export async function POST() {
  const viewer = await getViewer();
  if (!isAnyCommish(viewer)) return forbidden();

  const leagueId = process.env.SLEEPER_LEAGUE_ID;
  if (!leagueId) return Response.json({ error: "SLEEPER_LEAGUE_ID is not set" }, { status: 500 });

  const rosters = await syncFromSleeper(leagueId);
  // "Sync now" makes the book match Sleeper; the nightly run only flags.
  const applied = await applySleeperRosters(leagueId, getCurrentSeasonYear());
  const stats = await syncStats(leagueId);
  const valued = await refreshFairValues(getCurrentSeasonYear());
  const result = { ...rosters, applied, issues: await sql`select count(*)::int as n from sync_issues`.then((r) => r[0].n), statsUpdated: stats.updated, statsSeason: stats.season, valued };
  await audit(viewer, "sleeper_sync", result);
  return Response.json(result);
}

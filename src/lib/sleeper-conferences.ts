export interface DivisionLeague { metadata?: Record<string, string> }
export interface DivisionRoster { roster_id: number; settings?: { division?: number } }

/** Sleeper division labels are authoritative; sheet divisions are not conferences. */
export function conferenceName(division: string | undefined): string | null {
  const name = division?.trim();
  if (!name) return null;
  if (/^east(?:ern)?(?:\s+conference)?$/i.test(name)) return "East";
  if (/^west(?:ern)?(?:\s+conference)?$/i.test(name)) return "West";
  return name;
}

export function conferencesFromSleeper(league: DivisionLeague, rosters: DivisionRoster[]): Map<number, string | null> {
  return new Map(rosters.map((roster) => {
    const division = roster.settings?.division;
    return [roster.roster_id, conferenceName(division == null ? undefined : league.metadata?.[`division_${division}`])];
  }));
}

/** Refresh the split at least every minute without running a roster/contract sync. */
export async function loadSleeperConferences(leagueId: string): Promise<Map<number, string | null>> {
  if (!leagueId) return new Map();
  const get = async (path: string) => {
    const response = await fetch(`https://api.sleeper.app/v1/league/${leagueId}${path}`, {
      next: { revalidate: 60 }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Sleeper conferences: ${response.status}`);
    return response.json();
  };
  const [league, rosters] = await Promise.all([get(""), get("/rosters")]);
  return conferencesFromSleeper(league, rosters);
}

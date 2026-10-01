import { unstable_cache } from "next/cache";
import { sql } from "@/lib/db";
import type { ScoutInfo } from "@/lib/trade-finder";

// Cache only the small position map, not Sleeper's entire player catalogue.
const loadPositions = unstable_cache(async () => {
  const response = await fetch("https://api.sleeper.app/v1/players/nba", { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Sleeper positions unavailable");
  const catalogue: Record<string, { position?: string; fantasy_positions?: string[] }> = await response.json();
  const positions: Record<string, string[]> = {};
  for (const [id, p] of Object.entries(catalogue)) {
    positions[id] = [...new Set([...(p.fantasy_positions ?? []), ...(p.position ? [p.position] : [])])]
      .filter((position) => ["PG", "SG", "SF", "PF", "C"].includes(position));
  }
  return positions;
}, ["trade-finder-sleeper-positions-v1"], { revalidate: 86400 });

export async function GET() {
  try {
    const [rows, positions] = await Promise.all([
      sql`select id, sleeper_id, fair_value, date_part('year', age(birthdate))::int as age from players`,
      loadPositions().catch(() => null),
    ]);
    const players: Record<number, ScoutInfo> = {};
    for (const row of rows) players[row.id] = {
      fairValue: row.fair_value == null ? null : Number(row.fair_value),
      age: row.age == null ? null : Number(row.age),
      positions: positions?.[row.sleeper_id] ?? [],
    };
    return Response.json({ players, positionsAvailable: positions !== null });
  } catch {
    return Response.json({ error: "Trade Finder data could not be loaded. Please retry." }, { status: 503 });
  }
}

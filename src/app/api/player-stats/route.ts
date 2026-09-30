import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { calcFairValue, ageFromBirthdate } from "@/lib/fair-value";

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name");
  if (!name) return Response.json({ error: "name required" }, { status: 400 });

  const rows = await sql`
    select ppg, avg_gp, birthdate::text as birthdate from players
    where name = ${name} order by team_id nulls last limit 1`;
  const dbPlayer = rows[0];

  const ppg: number | null = dbPlayer?.ppg ?? null;
  const avgGamesPlayed: number | null = dbPlayer?.avg_gp ?? null;
  const birthdate: string | null = dbPlayer?.birthdate ?? null;

  if (ppg == null || avgGamesPlayed == null) {
    return Response.json(
      { error: "Stats missing for this player — contact the commissioner to update." },
      { status: 404 }
    );
  }

  if (!birthdate) {
    return Response.json(
      { error: "Birthdate missing for this player — contact the commissioner to update." },
      { status: 404 }
    );
  }

  const age = ageFromBirthdate(birthdate);
  if (age == null) {
    return Response.json(
      { error: "Invalid birthdate stored for this player — contact the commissioner." },
      { status: 500 }
    );
  }

  const fairValueMillions = calcFairValue(age, ppg, avgGamesPlayed);

  return Response.json({
    fairValue: Math.round(fairValueMillions * 10) / 10,
    age,
    ppg: Math.round(ppg * 10) / 10,
    avgGamesPlayed: Math.round(avgGamesPlayed),
  });
}

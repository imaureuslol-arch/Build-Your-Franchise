import { NextRequest } from "next/server";
import { sql } from "@/lib/db";

/** GET ?name= — a player's fair value and the numbers behind it, for the extension page. */
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name");
  if (!name) return Response.json({ error: "name required" }, { status: 400 });

  const [p] = await sql`
    select fair_value, ppg, proj_fppg, coalesce(gp_override, avg_gp) as gp,
           date_part('year', age(birthdate))::int as age
    from players where name = ${name} order by team_id nulls last limit 1`;

  if (!p || p.fair_value == null || p.age == null) {
    return Response.json(
      { error: "No value for this player yet — contact the commissioner to update." },
      { status: 404 }
    );
  }

  return Response.json({
    fairValue: p.fair_value,
    age: p.age,
    // Shown as "FPPG": last seasons if he has played, else his projection.
    ppg: Math.round((p.ppg ?? p.proj_fppg ?? 0) * 10) / 10,
    avgGamesPlayed: p.gp != null ? Math.round(p.gp) : null,
  });
}

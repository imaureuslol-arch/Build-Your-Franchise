import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calcFairValue, ageFromBirthdate } from "@/lib/fair-value";

function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name");
  if (!name) return Response.json({ error: "name required" }, { status: 400 });

  const supabase = getSupabaseServer();
  const { data: dbPlayer, error: dbError } = await supabase
    .from("players")
    .select("ppg, avg_gp, birthdate")
    .eq("name", name)
    .maybeSingle();

  if (dbError) {
    return Response.json(
      { error: `Database error: ${dbError.message}` },
      { status: 500 }
    );
  }

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

// Rebuild the historical draft-slot value curve used by src/lib/pick-value.ts.
//
//   npx tsx scripts/pick-slot-history.mts
//
// For every NBA draft whose class has four seasons of Sleeper stats (draft
// order saved from basketball-reference in scripts/v2-import/
// nba_drafts_2014_2022.json), each pick's first four seasons are scored with
// the league's current Sleeper settings and turned into fair-value dollars
// on the same scale as current players. Busts and overseas stashes count as
// $0. Averages by slot are fitted to V(slot) = A e^(-k (slot-1)); copy A and k
// into HISTORICAL_CURVE. Add a class to the JSON once its fourth season ends.
process.loadEnvFile(".env.local");
import fs from "fs";
const { neon } = await import("@neondatabase/serverless");
const { availability } = await import("../src/lib/valuation.ts");
const { fitCurve } = await import("../src/lib/pick-value.ts");
const sql = neon(process.env.DATABASE_URL!);
const g = async (p: string) => (await fetch("https://api.sleeper.app/v1" + p)).json();
const drafts: Record<string, [number, string][]> = JSON.parse(fs.readFileSync("scripts/v2-import/nba_drafts_2014_2022.json", "utf8"));
const [lg, cat] = await Promise.all([g("/league/" + process.env.SLEEPER_LEAGUE_ID), g("/players/nba")]);
const scoring: Record<string, number> = lg.scoring_settings;
const lastClass = Math.max(...Object.keys(drafts).map(Number));
const seasons: Record<number, Record<string, Record<string, number>>> = {};
for (let y = 2014; y <= lastClass + 3; y++) seasons[y] = await g(`/stats/nba/regular/${y}`);
const norm = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[.'’`-]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();
const byName = new Map<string, string[]>();
for (const [id, p] of Object.entries<{ full_name?: string; first_name?: string; last_name?: string }>(cat)) {
  const k = norm(p.full_name ?? `${p.first_name} ${p.last_name}`);
  byName.set(k, [...(byName.get(k) ?? []), id]);
}
const fppg = (l: Record<string, number>) => Object.entries(scoring).reduce((t, [k, w]) => t + (l[k] ?? 0) * w, 0) / l.gp;
const production = (f: number) => Math.max(0, f - 8) ** 1.7;

// Dollar scale: current fair value ÷ the same model, for prime-age players.
const cur = await sql`select ppg, proj_fppg, avg_gp, fair_value from players
  where fair_value > 5 and ppg is not null and proj_fppg is not null
    and date_part('year', age(birthdate)) between 26 and 29`;
const ratios = cur.map((r) => r.fair_value / (production(0.7 * r.proj_fppg + 0.3 * r.ppg) * availability(r.avg_gp))).sort((a, b) => a - b);
const scale = ratios[Math.floor(ratios.length / 2)];

const bySlot = new Map<number, number[]>();
for (const [yr, picks] of Object.entries(drafts)) {
  for (const [slot, name] of picks) {
    // Same name, several Sleeper ids: take the one who played most in these seasons.
    let id = "", most = -1;
    for (const cand of byName.get(norm(name)) ?? []) {
      const games = [0, 1, 2, 3].reduce((s, i) => s + (seasons[+yr + i]?.[cand]?.gp ?? 0), 0);
      if (games > most) { most = games; id = cand; }
    }
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const l = id ? seasons[+yr + i]?.[id] : undefined;
      if (l?.gp) value += scale * production(fppg(l)) * availability(l.gp);
    }
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), value / 4]);
  }
}
const points: [number, number][] = [...bySlot].filter(([s]) => s <= 48)
  .map(([s, v]) => [s, v.reduce((a, b) => a + b, 0) / v.length]);
const curve = fitCurve(points);
console.log(`HISTORICAL_CURVE = { A: ${curve.A}, k: ${curve.k.toFixed(3)} }`);
console.log([1, 3, 5, 8, 12, 16, 24, 30, 48].map((n) => `#${n} $${(curve.A * Math.exp(-curve.k * (n - 1))).toFixed(1)}M`).join("  "));

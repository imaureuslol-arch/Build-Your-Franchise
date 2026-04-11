// Populate ppg and avg_gp for every player in Supabase using the
// locally-running Postgame Stats API.
//
// Usage:
//   1. In one terminal, start the Flask API:
//        cd "../Postgame-Stats-Api/Postgame Stats"
//        pip install -r requirement.txt
//        python app.py
//      → it should be listening on http://127.0.0.1:5000
//
//   2. Make sure your .env.local has:
//        NEXT_PUBLIC_SUPABASE_URL=...
//        NEXT_PUBLIC_SUPABASE_ANON_KEY=...
//      (and ideally SUPABASE_SERVICE_ROLE_KEY=... for writes)
//
//   3. Run from the project root:
//        node scripts/populate-stats.mjs 

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// ── Load .env.local manually (no extra deps) ──
try {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf-8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
} catch {
  console.error("Could not read .env.local");
  process.exit(1);
}

// ── Config ──
const API_BASE = "http://127.0.0.1:5000";
const USERNAME = "stats-loader";
const PASSWORD = "stats-loader-pw";
// Last 3 completed NBA seasons
const RECENT_SEASONS = ["2022-23", "2023-24", "2024-25"];
// Delay between requests so we don't hammer stats.nba.com (which the API proxies)
const DELAY_MS = 1200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Supabase client ──
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase env vars");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// ── Auth: register (idempotent) + login → JWT ──
async function getToken() {
  // Try to register; ignore "already exists"
  await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  }).catch(() => {});

  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });

  if (!res.ok) {
    throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  }
  const { token } = await res.json();
  return token;
}

// Fantasy points formula:
//   pts*0.6 + reb*0.9 + ast*1 + stl*2 + blk*2.5 + fg3m*0.5 - tov*1 - pf*2
function fantasyPerGame(row) {
  if (!row.GP || row.GP <= 0) return 0;
  const pts = (row.PTS ?? 0) / row.GP;
  const reb = (row.REB ?? 0) / row.GP;
  const ast = (row.AST ?? 0) / row.GP;
  const stl = (row.STL ?? 0) / row.GP;
  const blk = (row.BLK ?? 0) / row.GP;
  const tov = (row.TOV ?? 0) / row.GP;
  const pf = (row.PF ?? 0) / row.GP;
  const fg3m = (row.FG3M ?? 0) / row.GP;

  return (
    pts * 0.6 +
    reb * 0.9 +
    ast * 1 +
    stl * 2 +
    blk * 2.5 +
    fg3m * 0.5 -
    tov * 1 -
    pf * 2
  );
}

// ── Fetch career season totals for one player ──
// Returns { ppg, avg_gp, birthdate } where ppg = fantasy PPG from the 2024-25
// season (current season isn't complete), avg_gp = average games played across
// the last 3 completed seasons, and birthdate is an ISO date from the NBA's
// CommonPlayerInfo endpoint exposed by the Postgame Stats API as /playerInfo.
const FPPG_SEASON = "2024-25";

async function getCareerStats(token, playerName) {
  const res = await fetch(`${API_BASE}/api/nba/player/careerSeasonTotal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ playerName }),
  });

  if (!res.ok) {
    throw new Error(`careerSeasonTotal ${res.status}: ${(await res.text()).slice(0, 120)}`);
  }

  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("no career data");
  }

  // Each row: { SEASON_ID: "2024-25", GP, PTS, REB, AST, STL, BLK, TOV, PF, FG3M, ... }
  // Lock FPPG to the 2024-25 season (current season isn't complete).
  // If a player has multiple rows for 2024-25 (trades → one per team + TOT),
  // prefer the TOT/combined row (largest GP).
  const season2425 = rows
    .filter((r) => r.SEASON_ID === FPPG_SEASON)
    .sort((a, b) => (b.GP ?? 0) - (a.GP ?? 0));

  if (season2425.length === 0) {
    throw new Error(`no ${FPPG_SEASON} data`);
  }

  const fppg = fantasyPerGame(season2425[0]);

  // Avg GP across the recent seasons that exist (one row per season; prefer
  // the combined row if the player was traded mid-year).
  const gpBySeason = new Map();
  for (const r of rows) {
    if (!RECENT_SEASONS.includes(r.SEASON_ID)) continue;
    const prev = gpBySeason.get(r.SEASON_ID) ?? 0;
    if ((r.GP ?? 0) > prev) gpBySeason.set(r.SEASON_ID, r.GP ?? 0);
  }
  if (gpBySeason.size === 0) {
    throw new Error("no recent seasons");
  }
  const avgGp =
    [...gpBySeason.values()].reduce((sum, gp) => sum + gp, 0) / gpBySeason.size;

  return {
    ppg: Math.round(fppg * 10) / 10, // stored in `ppg` column but it's now fantasy PPG
    avg_gp: Math.round(avgGp),
  };
}

async function getPlayerInfo(token, playerName) {
  const res = await fetch(`${API_BASE}/api/nba/player/playerInfo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ playerName }),
  });

  if (!res.ok) {
    throw new Error(`playerInfo ${res.status}: ${(await res.text()).slice(0, 120)}`);
  }

  const info = await res.json();
  if (!info || !info.birthdate) {
    throw new Error("no birthdate from playerInfo");
  }
  return { birthdate: info.birthdate };
}

async function getStatsForPlayer(token, playerName) {
  // Sequential, not parallel — both calls go to the same upstream that wraps
  // stats.nba.com, which gets cranky when hit too fast.
  const career = await getCareerStats(token, playerName);
  await sleep(DELAY_MS);
  const info = await getPlayerInfo(token, playerName);
  return { ...career, birthdate: info.birthdate };
}

// ── Main ──
async function main() {
  console.log("Logging in to Postgame Stats API…");
  const token = await getToken();
  console.log("✓ Got JWT");

  console.log("Fetching players from Supabase…");
  const { data: players, error } = await supabase
    .from("players")
    .select("id, name")
    .order("name");

  if (error) throw error;
  console.log(`✓ ${players.length} players to process`);

  let success = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const tag = `[${i + 1}/${players.length}] ${p.name}`;

    try {
      const stats = await getStatsForPlayer(token, p.name);

      const { error: updateErr } = await supabase
        .from("players")
        .update({
          ppg: stats.ppg,
          avg_gp: stats.avg_gp,
          birthdate: stats.birthdate,
        })
        .eq("id", p.id);

      if (updateErr) throw updateErr;

      console.log(
        `${tag}  →  ${stats.ppg} FPPG / ${stats.avg_gp} GP / DOB ${stats.birthdate}`
      );
      success++;
    } catch (err) {
      console.warn(`${tag}  ✗  ${err.message}`);
      failed++;
      failures.push({ name: p.name, reason: err.message });
    }

    await sleep(DELAY_MS);
  }

  console.log("\n──────────");
  console.log(`Success: ${success}`);
  console.log(`Failed:  ${failed}`);
  if (failures.length > 0) {
    console.log("\nFailed players (you'll need to fill these manually):");
    for (const f of failures) console.log(`  - ${f.name}: ${f.reason}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

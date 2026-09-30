// One-time build of the V2 database from:
//   contracts_from_sheet.csv  salaries, parsed from the league's Google sheet
//   Sleeper API               teams, owners, rosters, player catalogue
//   supabase-backup/players.json  fantasy PPG / games played from the old site
//
// Usage (from the project root, DATABASE_URL in .env.local):
//   node scripts/v2-import/import.mjs           refuses if teams already exist
//   node scripts/v2-import/import.mjs --reset   wipes league data first (keeps nothing)
//
// Writes scripts/v2-import/to-review.csv: every player the commissioner needs
// to look at, and fills sync_issues so the same list shows on /commissioner.

import { neon } from "@neondatabase/serverless";
import { readFileSync, writeFileSync } from "node:fs";

const HERE = new URL(".", import.meta.url);
const LEAGUE_ID = "1339222801806024704";
const SEASONS = [2027, 2028, 2029, 2030];

for (const line of readFileSync(new URL("../../.env.local", HERE), "utf-8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL missing from .env.local");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

// ── helpers ──────────────────────────────────────────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x !== ""));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.replace(/^﻿/, ""), r[i] ?? ""])));
}
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));

function norm(s) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[.'’`-]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();
}
function loose(s) {
  const n = norm(s).split(" ");
  return `${n[0]?.slice(0, 3)}|${n.at(-1)}`;
}
/** Find a name among candidates: exact, then first-3-letters + surname. */
function findName(candidates, name) {
  const exact = candidates.filter(([, n]) => norm(n) === norm(name));
  if (exact.length === 1) return exact[0][0];
  const near = candidates.filter(([, n]) => loose(n) === loose(name));
  return near.length === 1 ? near[0][0] : null;
}
async function sleeper(path) {
  const r = await fetch(`https://api.sleeper.app/v1${path}`);
  if (!r.ok) throw new Error(`Sleeper ${path}: ${r.status}`);
  return r.json();
}
const pname = (p) => p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();

// ── load sources ─────────────────────────────────────────────────────
const sheet = parseCsv(readFileSync(new URL("contracts_from_sheet.csv", HERE), "utf-8"))
  .filter((r) => r.player !== "Total Salary" && r.player !== "Cap Space");
const oldPlayers = JSON.parse(readFileSync(new URL("supabase-backup/players.json", HERE), "utf-8"));
const oldStats = new Map();
for (const p of oldPlayers) if (p.ppg != null) oldStats.set(norm(p.name), p);

console.log("Fetching Sleeper…");
const [users, rosters, catalogue] = await Promise.all([
  sleeper(`/league/${LEAGUE_ID}/users`),
  sleeper(`/league/${LEAGUE_ID}/rosters`),
  sleeper(`/players/nba`),
]);
const userById = new Map(users.map((u) => [u.user_id, u]));

// ── link each sheet team to the Sleeper roster holding most of its players ──
const sheetTeams = [...new Set(sheet.map((r) => r.team))];
const rosterNames = new Map(
  rosters.map((r) => [r.roster_id, (r.players ?? []).filter((id) => catalogue[id]).map((id) => [id, pname(catalogue[id])])])
);
const teamRoster = new Map();
for (const t of sheetTeams) {
  const names = sheet.filter((r) => r.team === t).map((r) => r.player);
  let best = null, bestScore = -1;
  for (const [rid, cands] of rosterNames) {
    const score = names.filter((n) => findName(cands, n)).length;
    if (score > bestScore) { best = rid; bestScore = score; }
  }
  teamRoster.set(t, best);
}
if (new Set(teamRoster.values()).size !== sheetTeams.length) {
  console.error("Two sheet teams matched the same Sleeper roster — check the sheet.", teamRoster);
  process.exit(1);
}

// ── reset / guard ────────────────────────────────────────────────────
const [{ n }] = await sql`select count(*)::int as n from teams`;
if (n > 0 && !process.argv.includes("--reset")) {
  console.error(`Database already has ${n} teams. Re-run with --reset to wipe and rebuild.`);
  process.exit(1);
}
if (process.argv.includes("--reset")) {
  await sql`truncate sync_issues, audit_log, sessions, login_links, free_agent_offers,
            extensions, dead_cap, contracts, players, teams restart identity cascade`;
}

// ── teams ────────────────────────────────────────────────────────────
const teamId = new Map(); // sheet team name -> db id
for (const t of sheetTeams) {
  const rid = teamRoster.get(t);
  const roster = rosters.find((r) => r.roster_id === rid);
  const u = roster.owner_id ? userById.get(roster.owner_id) : null;
  const name = u ? u.metadata?.team_name?.trim() || `Team ${u.display_name}` : t;
  const conference = sheet.find((r) => r.team === t).conference;
  const [row] = await sql`
    insert into teams (sleeper_roster, name, owner_name, sleeper_user_id, conference)
    values (${rid}, ${name}, ${u?.display_name ?? null}, ${u?.user_id ?? null}, ${conference})
    returning id`;
  teamId.set(t, row.id);
}
console.log(`Teams: ${teamId.size}`);

// ── players: every rostered player plus every active NBA player ──────
const rosteredTeam = new Map(); // sleeper id -> db team id
for (const t of sheetTeams) {
  const roster = rosters.find((r) => r.roster_id === teamRoster.get(t));
  for (const id of roster.players ?? []) rosteredTeam.set(id, teamId.get(t));
}
const wanted = Object.entries(catalogue).filter(([id, p]) => rosteredTeam.has(id) || (p.active && p.team));
const cols = { sid: [], name: [], team: [], nba: [], birth: [], ppg: [], gp: [] };
for (const [id, p] of wanted) {
  const st = oldStats.get(norm(pname(p)));
  cols.sid.push(id);
  cols.name.push(pname(p));
  cols.team.push(rosteredTeam.get(id) ?? null);
  cols.nba.push(p.team ?? null);
  cols.birth.push(p.birth_date || st?.birthdate || null);
  cols.ppg.push(st?.ppg ?? null);
  cols.gp.push(st?.avg_gp ?? null);
}
await sql`
  insert into players (sleeper_id, name, team_id, nba_team, birthdate, ppg, avg_gp)
  select * from unnest(${cols.sid}::text[], ${cols.name}::text[], ${cols.team}::int[], ${cols.nba}::text[],
                       ${cols.birth}::date[], ${cols.ppg}::real[], ${cols.gp}::real[])`;
const dbPlayers = await sql`select id, sleeper_id, name, team_id from players`;
const bySleeper = new Map(dbPlayers.map((p) => [p.sleeper_id, p]));
console.log(`Players: ${dbPlayers.length} (${rosteredTeam.size} rostered)`);

// ── contracts ────────────────────────────────────────────────────────
const review = [];
const contractRows = { pid: [], season: [], amount: [] };
const dead = { team: [], label: [], season: [], amount: [] };
const contracted = new Set();
const amountsOf = (r) => SEASONS.map((s) => [s, r[`c${s}`] === "" ? null : Number(r[`c${s}`])]).filter(([, a]) => a);

for (const r of sheet) {
  const tid = teamId.get(r.team);
  const money = amountsOf(r);
  const salaryText = money.map(([s, a]) => `${s}: $${(a / 1e6).toFixed(1)}M`).join(", ");

  // Cap holds and retained salary both count against the cap without a player.
  if (r.player === "Cap Hold" && money.length === 0) continue;
  if (r.player === "Cap Hold" || /retention|dead cap/i.test(r.player)) {
    for (const [s, a] of money) { dead.team.push(tid); dead.label.push(r.player); dead.season.push(s); dead.amount.push(a); }
    continue;
  }

  // Look on the team's own Sleeper roster first, then the whole catalogue.
  const roster = rosters.find((x) => x.roster_id === teamRoster.get(r.team));
  const onRoster = findName((roster.players ?? []).filter((id) => catalogue[id]).map((id) => [id, pname(catalogue[id])]), r.player);
  let player = onRoster ? bySleeper.get(onRoster) : null;
  if (!player) {
    const anywhere = findName(dbPlayers.map((p) => [p.sleeper_id, p.name]), r.player);
    player = anywhere ? bySleeper.get(anywhere) : null;
    if (!player) {
      const st = oldStats.get(norm(r.player));
      [player] = await sql`insert into players (name, team_id, birthdate, ppg, avg_gp)
                           values (${r.player}, ${tid}, ${st?.birthdate ?? null}, ${st?.ppg ?? null}, ${st?.avg_gp ?? null})
                           returning id, sleeper_id, name, team_id`;
    } else {
      await sql`update players set team_id = ${tid} where id = ${player.id}`;
    }
    const where = player.sleeper_id && rosteredTeam.has(player.sleeper_id)
      ? "on a different team in Sleeper" : "on no Sleeper roster";
    review.push({ issue: "has contract, " + where, team: r.team, player: r.player, salary: salaryText, player_id: player.id, team_id: tid,
      kind: where.startsWith("on a different") ? "wrong_team" : "not_on_sleeper_roster" });
  } else if (norm(player.name) !== norm(r.player)) {
    review.push({ issue: `name differs in Sleeper: "${player.name}" (matched anyway)`, team: r.team, player: r.player, salary: salaryText, player_id: player.id, team_id: tid, kind: null });
  }

  contracted.add(player.id);
  for (const [s, a] of money) { contractRows.pid.push(player.id); contractRows.season.push(s); contractRows.amount.push(a); }
  if (money.length === 0) {
    review.push({ issue: "in the sheet with no salary", team: r.team, player: r.player, salary: "", player_id: player.id, team_id: tid, kind: "no_contract" });
  }
}

await sql`insert into contracts (player_id, season, amount)
          select * from unnest(${contractRows.pid}::int[], ${contractRows.season}::int[], ${contractRows.amount}::bigint[])
          on conflict do nothing`;
if (dead.team.length) {
  await sql`insert into dead_cap (team_id, label, season, amount)
            select * from unnest(${dead.team}::int[], ${dead.label}::text[], ${dead.season}::int[], ${dead.amount}::bigint[])`;
}

// Rostered in Sleeper, nothing in the sheet.
const sheetTeamOf = new Map([...teamId].map(([k, v]) => [v, k]));
for (const [sid, tid] of rosteredTeam) {
  const p = bySleeper.get(sid);
  if (p && !contracted.has(p.id)) {
    review.push({ issue: "on Sleeper roster, not in the sheet", team: sheetTeamOf.get(tid), player: p.name, salary: "", player_id: p.id, team_id: tid, kind: "no_contract" });
  }
}
console.log(`Contracts: ${contractRows.pid.length} season rows, dead cap rows: ${dead.team.length}`);

// ── outputs ──────────────────────────────────────────────────────────
const issues = review.filter((r) => r.kind);
await sql`insert into sync_issues (kind, player_id, team_id, detail)
          select * from unnest(${issues.map((i) => i.kind)}::text[], ${issues.map((i) => i.player_id)}::int[],
                               ${issues.map((i) => i.team_id)}::int[], ${issues.map((i) => i.issue)}::text[])
          on conflict do nothing`;

review.sort((a, b) => a.issue.localeCompare(b.issue) || a.team.localeCompare(b.team) || a.player.localeCompare(b.player));
const out = ["issue,team,player,sheet salary", ...review.map((r) => [r.issue, r.team, r.player, r.salary].map(csvCell).join(","))];
writeFileSync(new URL("to-review.csv", HERE), "﻿" + out.join("\r\n"));
console.log(`\n${review.length} rows to review -> scripts/v2-import/to-review.csv`);
for (const r of review) console.log(`  ${r.issue.padEnd(44)} ${r.team.padEnd(26)} ${r.player}  ${r.salary}`);

// Bulk team PIN seeding.
//
// There is no team list in this file — teams are read live from `team_owners`,
// so people joining or leaving the league never requires editing code. For
// day-to-day changes prefer the Team PINs panel in the commissioner view; this
// script is for seeding everyone at once.
//
// Usage:
//   node scripts/set-pins.mjs                    generate PINs for teams that have none
//   node scripts/set-pins.mjs --all              regenerate every team's PIN
//   node scripts/set-pins.mjs --team "X" --pin 1234    set one team by hand
//
// Requires .env.local with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// (team_pins is RLS-locked; the anon key cannot touch it), and
// scripts/pins-schema.sql already run.
//
// Generated PINs are printed once and only the hash is stored. Copy them.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";

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

// ── Hashing — must stay byte-identical to src/lib/pin.ts ──
const ITERATIONS = 150_000;

const toB64 = (bytes) => Buffer.from(bytes).toString("base64");

async function derive(pin, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256
  );
  return toB64(new Uint8Array(bits));
}

async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${await derive(pin, salt, ITERATIONS)}`;
}

async function verifyPin(pin, stored) {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const salt = Buffer.from(parts[2], "base64");
  return (await derive(pin, salt, Number(parts[1]))) === parts[3];
}

// ── PIN generation ──
/** Rejects 0000/1111-style repeats and 1234/9876-style runs. */
function isWeakPin(pin) {
  if (/^(\d)\1*$/.test(pin)) return true;
  let ascending = true;
  let descending = true;
  for (let i = 1; i < pin.length; i++) {
    const delta = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
    if (delta !== 1) ascending = false;
    if (delta !== -1) descending = false;
  }
  return ascending || descending;
}

function randomPin() {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, "0");
}

/**
 * A PIN that is not weak, not already handed out in this run, and not already
 * in use by another team. Hashes are salted, so checking against existing teams
 * means verifying the candidate against each stored hash.
 */
async function uniquePin(usedPlaintext, existingHashes) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = randomPin();
    if (isWeakPin(candidate) || usedPlaintext.has(candidate)) continue;

    let taken = false;
    for (const hash of existingHashes) {
      if (await verifyPin(candidate, hash)) {
        taken = true;
        break;
      }
    }
    if (taken) continue;

    usedPlaintext.add(candidate);
    return candidate;
  }
  throw new Error("Could not find an unused PIN after 50 attempts");
}

// ── Args ──
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const resetAll = argv.includes("--all");
const oneTeam = flag("--team");
const onePin = flag("--pin");

if (onePin !== undefined && !/^\d{4}$/.test(onePin)) {
  console.error("--pin must be exactly 4 digits");
  process.exit(1);
}
if (onePin !== undefined && !oneTeam) {
  console.error("--pin requires --team");
  process.exit(1);
}

// ── Supabase client ──
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
  );
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
});

// ── Run ──
const { data: owners, error: ownersErr } = await supabase
  .from("team_owners")
  .select("team_name, user_name")
  .order("team_name");
if (ownersErr) {
  console.error("Could not read team_owners:", ownersErr.message);
  process.exit(1);
}

const { data: pinRows, error: pinsErr } = await supabase
  .from("team_pins")
  .select("team_name, pin_hash");
if (pinsErr) {
  console.error("Could not read team_pins:", pinsErr.message);
  console.error("Did you run scripts/pins-schema.sql, and is this the service_role key?");
  process.exit(1);
}

const hashByTeam = new Map((pinRows ?? []).map((r) => [r.team_name, r.pin_hash]));

let targets;
if (oneTeam) {
  if (!owners.some((o) => o.team_name === oneTeam)) {
    console.error(`"${oneTeam}" is not in team_owners. Teams are:`);
    for (const o of owners) console.error(`  - ${o.team_name}`);
    process.exit(1);
  }
  targets = [oneTeam];
} else if (resetAll) {
  targets = owners.map((o) => o.team_name);
} else {
  targets = owners.filter((o) => !hashByTeam.has(o.team_name)).map((o) => o.team_name);
}

if (targets.length === 0) {
  console.log("Every team already has a PIN. Use --all to regenerate, or");
  console.log("--team \"Name\" to change one. Nothing to do.");
  process.exit(0);
}

// PINs belonging to teams we're NOT touching still have to stay unique.
const untouchedHashes = [...hashByTeam.entries()]
  .filter(([team]) => !targets.includes(team))
  .map(([, hash]) => hash);

const used = new Set();
const assigned = [];
for (const team of targets) {
  const pin = oneTeam && onePin ? onePin : await uniquePin(used, untouchedHashes);
  const { error } = await supabase
    .from("team_pins")
    .upsert(
      { team_name: team, pin_hash: await hashPin(pin), updated_at: new Date().toISOString() },
      { onConflict: "team_name" }
    );
  if (error) {
    console.error(`Failed to set PIN for ${team}: ${error.message}`);
    process.exit(1);
  }
  assigned.push([team, pin]);
}

const nameFor = new Map(owners.map((o) => [o.team_name, o.user_name]));
const width = Math.max(...assigned.map(([team]) => team.length));

console.log("\n  PIN    TEAM" + " ".repeat(Math.max(0, width - 4)) + "  OWNER");
console.log("  " + "-".repeat(width + 24));
for (const [team, pin] of assigned) {
  console.log(`  ${pin}   ${team.padEnd(width)}  ${nameFor.get(team) ?? ""}`);
}
console.log(`\n${assigned.length} PIN(s) set. Only the hash is stored — copy these now.\n`);

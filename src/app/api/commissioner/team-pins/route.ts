/**
 * Team PIN management for the commissioner UI.
 *
 * The team list is always read live from `team_owners`, so teams that join or
 * leave the league show up here without anyone editing code. A team with no
 * PIN row simply can't log in until one is set.
 */

import { NextRequest } from "next/server";
import { getSupabaseServer, isCommissioner } from "@/lib/server-auth";
import {
  hashPin,
  verifyPin,
  isValidPinFormat,
  TEAM_PIN_DIGITS,
} from "@/lib/pin";

/** Rejects 0000/1111-style repeats and 1234/9876-style runs. */
function isWeakPin(pin: string): boolean {
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

function randomPin(): string {
  const max = 10 ** TEAM_PIN_DIGITS;
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % max;
  return String(value).padStart(TEAM_PIN_DIGITS, "0");
}

/**
 * A random PIN that no other team is already using.
 *
 * Hashes are salted, so the only way to check for a collision is to verify the
 * candidate against every stored hash. That's ~24 PBKDF2 runs per attempt —
 * slow, but this is a rare admin action, and it keeps two owners from being
 * handed the same PIN.
 */
async function generateUniquePin(existingHashes: string[]): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = randomPin();
    if (isWeakPin(candidate)) continue;

    let taken = false;
    for (const hash of existingHashes) {
      if (await verifyPin(candidate, hash)) {
        taken = true;
        break;
      }
    }
    if (!taken) return candidate;
  }
  // 25 collisions against ~24 hashes in a 10k space is essentially impossible;
  // if it somehow happens, a duplicate beats failing the request.
  return randomPin();
}

/** GET — every team, with whether it has a PIN set. Never returns hashes. */
export async function GET(request: NextRequest) {
  const supabase = getSupabaseServer();

  if (!(await isCommissioner(supabase, request))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const [owners, pins] = await Promise.all([
    supabase.from("team_owners").select("team_name, user_name"),
    supabase.from("team_pins").select("team_name, updated_at"),
  ]);

  if (owners.error) {
    return Response.json({ error: owners.error.message }, { status: 500 });
  }
  if (pins.error) {
    return Response.json({ error: pins.error.message }, { status: 500 });
  }

  const pinByTeam = new Map(
    (pins.data ?? []).map((row) => [row.team_name, row.updated_at])
  );

  const teams = (owners.data ?? [])
    .map((owner) => ({
      team_name: owner.team_name,
      user_name: owner.user_name,
      has_pin: pinByTeam.has(owner.team_name),
      updated_at: pinByTeam.get(owner.team_name) ?? null,
    }))
    .sort((a, b) => a.team_name.localeCompare(b.team_name));

  return Response.json({ teams });
}

/**
 * POST — set or reset one team's PIN.
 *
 * Body: { team_name, pin? }. Omit `pin` to have one generated. The plaintext
 * comes back exactly once, in this response; after that only the hash exists.
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabaseServer();

  if (!(await isCommissioner(supabase, request))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fields = (body ?? {}) as Record<string, unknown>;
  const teamName = fields.team_name;
  const requestedPin = fields.pin;

  if (typeof teamName !== "string" || !teamName) {
    return Response.json({ error: "team_name required" }, { status: 400 });
  }

  // Only teams that actually exist — the FK would reject others anyway, but
  // this gives a readable error instead of a constraint violation.
  const { data: owner } = await supabase
    .from("team_owners")
    .select("team_name")
    .eq("team_name", teamName)
    .maybeSingle();

  if (!owner) {
    return Response.json({ error: "No such team" }, { status: 404 });
  }

  let pin: string;
  if (requestedPin === undefined || requestedPin === null || requestedPin === "") {
    const { data: existing } = await supabase
      .from("team_pins")
      .select("pin_hash")
      .neq("team_name", teamName);
    pin = await generateUniquePin((existing ?? []).map((row) => row.pin_hash));
  } else if (isValidPinFormat(requestedPin, TEAM_PIN_DIGITS)) {
    pin = requestedPin;
  } else {
    return Response.json(
      { error: `PIN must be exactly ${TEAM_PIN_DIGITS} digits` },
      { status: 400 }
    );
  }

  const { error } = await supabase.from("team_pins").upsert(
    { team_name: teamName, pin_hash: await hashPin(pin), updated_at: new Date().toISOString() },
    { onConflict: "team_name" }
  );

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true, team_name: teamName, pin });
}

/** DELETE — remove a team's PIN. That team can't log in until a new one is set. */
export async function DELETE(request: NextRequest) {
  const supabase = getSupabaseServer();

  if (!(await isCommissioner(supabase, request))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const teamName = (body as Record<string, unknown>)?.team_name;
  if (typeof teamName !== "string" || !teamName) {
    return Response.json({ error: "team_name required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("team_pins")
    .delete()
    .eq("team_name", teamName);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}

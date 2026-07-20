/**
 * PIN hashing + verification.
 *
 * Server-only. Uses Web Crypto (`crypto.subtle`) rather than node's bcrypt so
 * the same code runs under `next dev`, Vercel's Node runtime, and the edge
 * runtime without a native dependency.
 *
 * Stored format:  pbkdf2$<iterations>$<salt-b64>$<hash-b64>
 *
 * NOTE: scripts/set-pins.mjs contains a copy of this hashing logic (it can't
 * import a .ts file). If you change ITERATIONS or the encoding, change it there
 * too or previously-seeded PINs stop verifying.
 */

const ITERATIONS = 150_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

function toB64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromB64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(
  pin: string,
  salt: Uint8Array,
  iterations: number
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    // BufferSource — a fresh copy keeps TS happy across lib.dom/node typings
    { name: "PBKDF2", hash: "SHA-256", salt: salt.slice(), iterations },
    key,
    KEY_BITS
  );
  return toB64(new Uint8Array(bits));
}

/** Hash a PIN into the storable `pbkdf2$…` string. */
export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(pin, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toB64(salt)}$${hash}`;
}

/** Length-independent, early-exit-free string comparison. */
export function timingSafeEqual(a: string, b: string): boolean {
  // Compare over the longer length so a length mismatch still costs the same
  // number of iterations as a full compare.
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** Verify a plaintext PIN against a stored `pbkdf2$…` string. */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;

  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  let salt: Uint8Array;
  try {
    salt = fromB64(parts[2]);
  } catch {
    return false;
  }

  const candidate = await derive(pin, salt, iterations);
  return timingSafeEqual(candidate, parts[3]);
}

/** True for a numeric PIN of exactly `digits` length. */
export function isValidPinFormat(value: unknown, digits: number): value is string {
  return typeof value === "string" && new RegExp(`^\\d{${digits}}$`).test(value);
}

export const TEAM_PIN_DIGITS = 4;
export const COMMISH_PIN_DIGITS = 8;
export const SUBCOMMISH_PIN_DIGITS = 6;

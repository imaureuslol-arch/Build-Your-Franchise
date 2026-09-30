/**
 * Neon Postgres over HTTP. Works in Node and in serverless runtimes,
 * since every query is a plain fetch — no TCP pool to keep alive.
 *
 * Usage: const rows = await sql`select * from teams where id = ${id}`;
 * For several statements that must succeed or fail together:
 *   await sql.transaction([sql`...`, sql`...`]);
 */

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = neon(url);
  }
  return _sql;
}

// A lazy proxy so importing this module never needs the env var at build time.
export const sql = new Proxy((() => {}) as unknown as NeonQueryFunction<false, false>, {
  apply: (_t, _this, args) => (getSql() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_t, prop) => Reflect.get(getSql(), prop),
});

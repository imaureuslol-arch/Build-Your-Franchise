// Apply one migration file from db/migrations inside a transaction.
//   node scripts/migrate.mjs 002-rolling-seasons-extensions.sql
// Statements are separated by a line reading "-- statement".
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
const sql = neon(process.env.DATABASE_URL);
const file = process.argv[2] ?? '001-commissioner-free-agency.sql';
const migration = readFileSync(new URL(`../db/migrations/${file}`, import.meta.url), 'utf8');
await sql.transaction(migration.split(/\r?\n-- statement\r?\n/).map(statement => sql.query(statement)));
console.log(`Applied ${file}.`);

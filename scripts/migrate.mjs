import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
const sql = neon(process.env.DATABASE_URL);
const migration = readFileSync(new URL('../db/migrations/001-commissioner-free-agency.sql', import.meta.url), 'utf8');
await sql.transaction(migration.split(/\r?\n-- statement\r?\n/).map(statement => sql.query(statement)));
console.log('Commissioner and free-agency migration applied.');

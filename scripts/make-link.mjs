// Mint a login link from the command line — used once, to get the first
// commissioner link. After that, every link is made on /commissioner.
//
//   node scripts/make-link.mjs commish https://your-site.example
//   node scripts/make-link.mjs subcommish https://your-site.example
//   node scripts/make-link.mjs commish https://your-site.example "My Team Name"
//     (commissioner who also owns a team: one link, both powers)
//
// Replaces any previous link for that role (sessions already logged in stay).

import { neon } from "@neondatabase/serverless";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const [role, site = "http://localhost:3000", teamName] = process.argv.slice(2);
if (role !== "commish" && role !== "subcommish") {
  console.error("Usage: node scripts/make-link.mjs <commish|subcommish> [site-url]");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
let teamId = null;
if (teamName) {
  const [team] = await sql`select id from teams where name = ${teamName}`;
  if (!team) {
    console.error(`No team named "${teamName}". Teams: ${(await sql`select name from teams order by name`).map((t) => t.name).join(", ")}`);
    process.exit(1);
  }
  teamId = team.id;
}
const token = randomBytes(24).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");

await sql.transaction([
  sql`update login_links set revoked_at = now()
      where role = ${role} and kind = 'team' and revoked_at is null`,
  sql`insert into login_links (token_hash, team_id, role, kind) values (${hash}, ${teamId}, ${role}, 'team')`,
]);

console.log(`${site.replace(/\/$/, "")}/join/${token}`);

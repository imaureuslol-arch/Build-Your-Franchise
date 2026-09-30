This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## V2 setup

Data lives in Neon Postgres. Sleeper is the source for teams, owners and
rosters; the contract book (salaries, dead cap, extensions) lives only here.

### Environment variables

Set in `.env.local` and in the host's project settings:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon connection string (pooled) |
| `SLEEPER_LEAGUE_ID` | `1339222801806024704` |
| `CRON_SECRET` | Long random string; Vercel Cron sends it to the daily sync |

### First run

1. `psql "$DATABASE_URL" -f db/schema.sql` (or paste it into the Neon SQL editor)
2. `node scripts/v2-import/import.mjs` builds teams, players and contracts from
   the sheet export + Sleeper, and writes `scripts/v2-import/to-review.csv`
3. `node scripts/make-link.mjs commish <site-url> "<your team name>"` prints
   your commissioner login link

### Logins

Each owner gets a personal link from **Commissioner → Login Links**; send it
in a Sleeper DM. Opening it logs that device in for a year. Owners add other
devices from **Account** (one-time link, 10 minutes). "New link" replaces a
team's link; "Log out all" ends every device of that team.

### Sleeper sync

**Commissioner → Sleeper Sync → Sync now**, and daily at 09:00 UTC via
Vercel Cron (`vercel.json`, authorised by `CRON_SECRET`).
It updates owners and team names and adds new players automatically. Roster
differences that affect contracts are listed for the commissioner, not applied.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Commissioner contracts and free agency

Run `node scripts/migrate.mjs` before deploying this update (after `db/schema.sql` for a fresh database).
Both commissioner roles can correct player teams and 2027–2030 salaries, and add/edit/remove labelled dead-cap charges or retention credits. Blank salary fields remove that season; free agents cannot keep current contract rows. Changes are audited and stale edits are rejected.

On Free Agency, set a deadline in the displayed local timezone. The countdown follows the server clock. The database closes bids at the deadline; a commissioner applies each winning bid to the roster and contracts. Equal weighted bids require selection among the tied bids. Awarding is atomic and repeat-safe. Dismiss invalid awards with a recorded reason. A new round can start after every player with bids is awarded or dismissed. Sleeper transactions remain manual.

Database regression checks: `node scripts/test-commissioner.mjs`. This creates and removes a separate temporary database using the configured Neon account, with fake league data only.


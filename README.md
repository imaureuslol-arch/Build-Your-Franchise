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

## Login / PIN setup

Owners log in by picking their team and entering a 4-digit PIN. On success the
server whitelists their IP (`ip_team_mappings`) **and** issues a signed
`HttpOnly` session cookie, so they're never asked again on that device. The
cookie is what keeps them logged in when their home IP changes, and what keeps
two owners behind one carrier NAT from overwriting each other's mapping.

### One-time setup

1. Run [`scripts/pins-schema.sql`](scripts/pins-schema.sql) in the Supabase SQL
   editor (creates `team_pins`, `pin_attempts`, adds `ip_login_history.success`).
2. Set these env vars locally in `.env.local` **and** in the Vercel project
   settings (Production + Preview):

   | Variable | Value |
   | --- | --- |
   | `SESSION_SECRET` | Long random string. Generate with `openssl rand -hex 32`. Changing it logs everyone out. |
   | `COMMISSIONER_PIN` | Your 8-digit commissioner PIN |
   | `SUBCOMMISSIONER_PIN` | The 6-digit sub-commissioner PIN |
   | `SUPABASE_SERVICE_ROLE_KEY` | **Required** — `team_pins` / `pin_attempts` are RLS-locked and unreadable with the anon key, so logins fail without it |

3. Put each team's 4-digit PIN in `TEAM_PINS` at the top of
   [`scripts/set-pins.mjs`](scripts/set-pins.mjs), then run `node scripts/set-pins.mjs`.
   Only the PBKDF2 hash is stored. Re-run any time to reset a PIN.

### Testing locally

`next dev` has no proxy headers, so every local request looks like the same
client. Set `DEV_FAKE_IP` in `.env.local` to whatever IP you want to pretend to
be, and restart the dev server to switch identities:

```
DEV_FAKE_IP=10.0.0.1
```

To get back to a clean "never logged in" state, clear the server-side record
and the cookie:

```sql
delete from ip_team_mappings where ip = '10.0.0.1';  -- your DEV_FAKE_IP
delete from pin_attempts;                            -- clears any lockout
```

then delete the `byf_session` cookie (devtools → Application → Cookies) or just
open a new incognito window.

### Notes

- Team PIN length is 4 digits, so brute force is held off by a lockout: 5 wrong
  PINs from one IP inside 15 minutes returns `429` until the window passes.
- Commissioner PINs are entered on `/commissioner`; 8 digits grants full
  commish, 6 digits grants sub-commish. A correct PIN adds the IP to
  `commissioner_ips` / `subcommissioner_ips`.
- "Log out" in the commissioner tools deletes the team's IP rows *and* bumps
  `team_pins.session_epoch`, which invalidates that team's session cookies too.
- To revoke a commissioner device, delete its row from `commissioner_ips` and
  rotate `SESSION_SECRET`.
- Anyone already mapped in `ip_team_mappings` before PINs existed stays logged
  in without ever entering one. To force the whole league to authenticate once,
  run `delete from ip_team_mappings;` after seeding the PINs.
- RLS is intentionally left **off** on every pre-existing table so the external
  Excel sync keeps working. Only the two new tables (`team_pins`,
  `pin_attempts`) are locked, because a readable 4-digit PIN hash or a writable
  lockout counter would defeat the login outright. The tradeoff is that the PIN
  stops honest users, not someone who pulls the anon key out of the JS bundle
  and writes their own row into `ip_team_mappings`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

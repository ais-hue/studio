# Studio

Aisling's standalone marketing studio: sites on every `*.aisling.online` subdomain, pages, signup forms, contacts and lists, email campaigns and automations. Runs on Cloudflare Workers with a D1 database; email goes out through Resend.

- `src/` – the worker: public sites, the studio API, email sending, automations (`automation.ts`), Resend delivery events (`hooks.ts`)
- `admin/` – the studio app (served at studio.aisling.online) plus the public site stylesheet and fonts
- `migrations/` – the database schema. The worker applies it itself on first run; after editing, run `node scripts/schema.mjs` to rebuild `src/schema.ts`.

## How email flows

- **Sign-ups** land on the site's list. With double opt-in on (Settings), they wait as "pending" until they tap the link sent to `go.<domain>/confirm/…`.
- **Automations** start when someone joins a list, clicks a link in a campaign, or is added by hand. The every-minute cron moves people along and queues each email; the send queue delivers it.
- **Bounces and spam reports** come back from Resend to `go.<domain>/hooks/resend` (signed, checked against the signing secret). Hard bounces and complaints stop all email to that address and take it out of automations.

## Deploying

Cloudflare builds and deploys every push to `main` automatically.

## Settings that live in Cloudflare, not in this repo

- `RESEND_API_KEY` (secret) – email sending
- `ADMIN_EMAILS` – who can sign in to the studio by email link
- The Resend webhook signing secret is saved from Studio's Settings page (or can be set as the `RESEND_WEBHOOK_SECRET` secret).

## Local testing

`npm install`, then `npm run dev` with a `.dev.vars` file containing `ROOT_DOMAIN=localhost` and `DEV_AUTH=1` (emails are simulated). Open http://studio.localhost:8787. Add `--test-scheduled` and visit `/__scheduled` to run the every-minute job by hand.

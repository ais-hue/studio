# Studio

Aisling's standalone marketing studio: sites on every `*.aisling.online` subdomain, pages, signup forms, contacts and lists, and email campaigns. Runs on Cloudflare Workers with a D1 database; email goes out through Resend.

- `src/` – the worker: public sites, the studio API, email sending
- `admin/` – the studio app (served at studio.aisling.online) plus the public site stylesheet and fonts
- `migrations/` – the database schema (the worker also applies it itself on first run)

## Deploying

Cloudflare builds and deploys every push to `main` automatically.

## Settings that live in Cloudflare, not in this repo

- `RESEND_API_KEY` (secret) – email sending
- `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` – the studio sign-in (Cloudflare Access)

## Local testing

`npm install`, then `npm run dev` with a `.dev.vars` file containing `ROOT_DOMAIN=localhost` and `DEV_AUTH=1`. Open http://studio.localhost:8787.

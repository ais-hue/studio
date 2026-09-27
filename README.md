# Studio

Aisling's standalone marketing studio: sites on every `*.aisling.online` subdomain, pages, signup forms, contacts and lists, email campaigns, automations and social posting. Runs on Cloudflare Workers with a D1 database; email goes out through Resend.

- `src/` – the worker: public sites, the studio API, email sending, automations (`automation.ts`), Resend delivery events (`hooks.ts`)
- `admin/` – the studio app (served at studio.aisling.online) plus the public site stylesheet and fonts
- `migrations/` – the database schema. The worker applies it itself on first run; after editing, run `node scripts/schema.mjs` to rebuild `src/schema.ts`.

## How email flows

- **Sign-ups** land on the site's list. With double opt-in on (Settings), they wait as "pending" until they tap the link sent to `go.<domain>/confirm/…`.
- **Forms** (`src/forms.ts`) pick fields (email, name, custom contact fields) and add people to a list. They work on Studio pages, embedded anywhere (`go.<domain>/f/<id>.js` or an iframe of `go.<domain>/f/<id>`), or posted to as JSON by apps. Custom answers are stored in `contacts.props`.
- **Smart lists** (`src/segments.ts`) are saved rules compiled to SQL when used: in Contacts, and as a campaign audience (counted at send time).
- **Automations** start when someone joins a list, clicks a link in a campaign, or is added by hand. The every-minute cron moves people along and queues each email; the send queue delivers it.
- **Social posts** go out through Zernio (zernio.com). Brands are Zernio profiles; drafts live in Studio, and scheduled posts are handed to Zernio and checked on by the cron.
- **Tracked links**: links in social posts become `go.<domain>/l/<code>` (UTM-tagged; bots ignored). Links to Studio sites carry `sref=<code>`, which the signup form sends back so the new contact is credited to that post and platform. No cookies.
- **Performance**: every hour (minute 23) Studio pulls likes, comments, shares and reach from Zernio's analytics for posts from the last 90 days, and works out best days and times per brand.
- **Files** live in R2 (binding `FILES`, bucket `studio-files`) and are served publicly at `files.<domain>/<key>`. Big files upload in 50 MB parts.
- **Bounces and spam reports** come back from Resend to `go.<domain>/hooks/resend` (signed, checked against the signing secret). Hard bounces and complaints stop all email to that address and take it out of automations.

## Claude connector

Studio is a remote MCP server at `https://studio.<domain>/mcp` (Streamable HTTP, JSON responses). Sign-in is OAuth 2.1 through `@cloudflare/workers-oauth-provider` (PKCE, DCR and CIMD; tokens in the `OAUTH_KV` namespace). The approval page is `/oauth/authorize`, behind Studio's email-link sign-in. Tools (`src/mcp.ts`) only read or save drafts: nothing posts, schedules or sends. Big files (videos) come in through one-time upload links at `/up/<secret>` (`src/uploads.ts`): a drag-and-drop page, or PUT / parts for scripts.

## Deploying

Cloudflare builds and deploys every push to `main` automatically.

## Settings that live in Cloudflare, not in this repo

- `RESEND_API_KEY` (secret) – email sending
- `ADMIN_EMAILS` – who can sign in to the studio by email link
- The Zernio API key and the Resend webhook signing secret are saved from Studio's Settings page (or can be set as the `ZERNIO_API_KEY` / `RESEND_WEBHOOK_SECRET` secrets).

## Local testing

`npm install`, then `npm run dev` with a `.dev.vars` file containing `ROOT_DOMAIN=localhost` and `DEV_AUTH=1` (emails are simulated). Open http://studio.localhost:8787. Add `--test-scheduled` and visit `/__scheduled` to run the every-minute job by hand.

Bump `VERSION` in `src/version.ts` and `admin/app.js` together on each release so open copies of Studio offer a reload.

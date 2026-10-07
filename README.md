# Studio

Aisling's standalone marketing studio: sites on every `*.aisling.online` subdomain, pages, signup forms, contacts and lists, email campaigns, automations and social posting. Runs on Cloudflare Workers with a D1 database; email goes out through Resend.

- `src/` – the worker: public sites, the studio API, email sending, automations (`automation.ts`), Resend delivery events (`hooks.ts`)
- `admin/` – the studio app (served at studio.aisling.online) plus the public site stylesheet and fonts
- `migrations/` – the database schema. The worker applies it itself on first run; after editing, run `node scripts/schema.mjs` to rebuild `src/schema.ts`.

## Block pages

A page with template `blocks` is an ordered list of blocks (`src/blocks.ts`): hero, text, image, gallery, store buttons, features, quote, FAQ, signup, links, video and divider. Each has a background (page, soft, accent), spacing and a hidden switch; colours and type come from the site, so pages stay readable in light and dark and on phones. `cleanBlocks()` validates everything that is saved. Store buttons get tracked links when a page is saved (`source_type = 'page'`). Old template pages render as before; `POST /api/pages/<id>/convert` turns one into blocks and keeps the old version for `/unconvert`.

## How email flows

- **Sign-ups** land on the site's list. With double opt-in on (Settings), they wait as "pending" until they tap the link sent to `go.<domain>/confirm/…`.
- **Forms** (`src/forms.ts`) pick fields (email, name, custom contact fields) and add people to a list. They work on Studio pages, embedded anywhere (`go.<domain>/f/<id>.js` or an iframe of `go.<domain>/f/<id>`), or posted to as JSON by apps. Custom answers are stored in `contacts.props`.
- **Smart lists** (`src/segments.ts`) are saved rules compiled to SQL when used: in Contacts, and as a campaign audience (counted at send time).
- **Automations** start when someone joins a list, clicks a link in a campaign, or is added by hand. The every-minute cron moves people along and queues each email; the send queue delivers it.
- **Social posts** go out straight from Studio (`src/direct/`) for Instagram, Threads, TikTok, Pinterest and Bluesky, through Studio's own developer app on each platform (set up in Settings → Social posting; Bluesky uses an app password instead). Publishing a post queues one delivery per account; the every-minute cron works through each one step by step (upload, wait for the platform to process it, publish), retries hiccups with backoff, and renews tokens before they lapse. Platforms without a Studio app (LinkedIn, X, Facebook) can still go through Zernio (zernio.com) if a Zernio key is added; a post can mix both, and its status combines the two. Brands are Studio's own (`br_…`) or older Zernio profiles.
- **Bulk edits**: on the Social page, select drafts and scheduled posts, then *Edit…* to find and replace (whole words and hashtags), add a line at the start or end, add or remove hashtags, add or drop platforms, set the Pinterest link and board, or set TikTok’s audience and tick its music and content box. Studio previews every change first (`POST /api/social/bulk-edit` with `dry: true`). Scheduled posts are pulled back, changed and put back at the same time; one that can no longer go out stays a draft planned for that time and says why.
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
- `SOCIAL_KEY` (secret, recommended) – encrypts social account tokens and app secrets. Without it Studio makes its own key and keeps it in the database. Values record which key sealed them, so adding the secret later is safe; removing it once it's in use is not.
- Cloudflare **Images → Transformations** switched on for the zone: Instagram only takes JPEGs and Bluesky caps pictures at about 1 MB, so Studio converts its own files on the fly through `files.<domain>/cdn-cgi/image/…`.

## Platform apps for direct posting

Each platform's redirect URI is `https://studio.<domain>/social/callback/<platform>` (Settings shows it with a Copy button). Before review, every platform only lets the app post to the developer's own accounts:

- **Instagram / Threads (Meta):** add your accounts as Instagram/Threads testers. Customers' accounts need App Review (screencast per permission) and Business Verification.
- **TikTok:** posts are forced to private until the app passes TikTok's audit. Photo posts also need `files.<domain>` verified as a URL prefix.
- **Pinterest:** trial access posts to the sandbox only (tick Sandbox). Standard access needs a video of the OAuth flow and pinning.
- **Bluesky:** nothing to set up.

To try the engine locally, save any platform's app with the ID `simulate`, or connect Bluesky with a handle ending `.simulate`. Captions with `#fail` fail for good; `#flaky` fails once, then goes through.

## Local testing

`npm install`, then `npm run dev` with a `.dev.vars` file containing `ROOT_DOMAIN=localhost` and `DEV_AUTH=1` (emails are simulated). Open http://studio.localhost:8787. Add `--test-scheduled` and visit `/__scheduled` to run the every-minute job by hand.

Bump `VERSION` in `src/version.ts` and `admin/app.js` together on each release so open copies of Studio offer a reload.

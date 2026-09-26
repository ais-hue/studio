import { Env, now, slugify } from "./util";

/*
 * Tracked links. Links in social posts become https://go.<domain>/l/<code>. The redirect counts the click
 * (skipping link-preview bots) and sends people on with UTM tags. When the destination is one of Studio's own
 * sites, a `sref` code rides along in the URL; the signup form sends it back, so the new contact is credited
 * to the post and platform that brought them. No cookies are used.
 */

const BOTS = /bot|crawl|spider|preview|facebookexternalhit|facebookcatalog|meta-externalagent|twitterbot|linkedinbot|slack|discord|whatsapp|telegram|pinterest|bluesky|cardyb|embedly|skype|google-|applebot|bingpreview|vkshare|iframely|headless/i;
const URL_RE = /https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g;

function code(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => "abcdefghjkmnpqrstuvwxyz23456789"[x % 31]).join("");
}

export function tagUrl(env: Env, url: string, tags: Record<string, string>, sref?: string): string {
  try {
    const u = new URL(url);
    const hasUtm = [...u.searchParams.keys()].some((k) => k.startsWith("utm_"));
    if (!hasUtm) for (const [k, v] of Object.entries(tags)) if (v) u.searchParams.set(k, v);
    if (sref && (u.hostname === env.ROOT_DOMAIN || u.hostname.endsWith("." + env.ROOT_DOMAIN))) u.searchParams.set("sref", sref);
    return u.toString();
  } catch { return url; }
}

/** Make (or reuse) a tracked link for one URL in one place. */
export async function makeLink(env: Env, o: { url: string; source_type: string; source_id: string; platform?: string; profile_id?: string; tags: Record<string, string> }): Promise<string> {
  const existing = await env.DB.prepare("SELECT code FROM links WHERE source_type = ? AND source_id = ? AND COALESCE(platform,'') = ? AND original = ?")
    .bind(o.source_type, o.source_id, o.platform || "", o.url).first<{ code: string }>();
  if (existing) return existing.code;
  for (let i = 0; i < 5; i++) {
    const c = code();
    const dest = tagUrl(env, o.url, { ...o.tags, utm_content: c }, c);
    const r = await env.DB.prepare(`INSERT OR IGNORE INTO links (id, code, url, source_type, source_id, platform, profile_id, original, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("lk_" + c, c, dest, o.source_type, o.source_id, o.platform || null, o.profile_id || null, o.url, now()).run();
    if (r.meta?.changes) return c;
  }
  throw new Error("Couldn’t make a tracked link. Try again.");
}

export const shortUrl = (env: Env, c: string) => `https://go.${env.ROOT_DOMAIN}/l/${c}`;

/** Swap every link in a caption for a tracked one. */
export async function trackText(env: Env, text: string, o: { source_type: string; source_id: string; platform: string; profile_id: string; campaign: string }): Promise<string> {
  const found = [...new Set(text.match(URL_RE) || [])].filter((u) => !u.startsWith(`https://go.${env.ROOT_DOMAIN}/l/`));
  let out = text;
  for (const u of found) {
    const c = await makeLink(env, { url: u, source_type: o.source_type, source_id: o.source_id, platform: o.platform, profile_id: o.profile_id,
      tags: { utm_source: o.platform === "twitter" ? "x" : o.platform, utm_medium: "social", utm_campaign: slugify(o.campaign, 40) || "studio" } });
    out = out.split(u).join(shortUrl(env, c));
  }
  return out;
}

/** go.<domain>/l/<code> */
export async function followLink(req: Request, env: Env, ctx: ExecutionContext, c: string): Promise<Response> {
  const l = await env.DB.prepare("SELECT id, url FROM links WHERE code = ?").bind(c).first<{ id: string; url: string }>();
  if (!l) return new Response("This link doesn’t go anywhere any more.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  if (req.method === "GET" && !BOTS.test(req.headers.get("user-agent") || "") && (req.headers.get("purpose") || req.headers.get("sec-purpose") || "") !== "prefetch") {
    const t = now(), day = new Date(t).toISOString().slice(0, 10);
    ctx.waitUntil(env.DB.batch([
      env.DB.prepare("UPDATE links SET clicks = clicks + 1, last_click_at = ? WHERE id = ?").bind(t, l.id),
      env.DB.prepare("INSERT INTO link_days (link_id, day, clicks) VALUES (?, ?, 1) ON CONFLICT(link_id, day) DO UPDATE SET clicks = clicks + 1").bind(l.id, day),
    ]));
  }
  return new Response(null, { status: 302, headers: { location: l.url, "cache-control": "no-store", "referrer-policy": "no-referrer-when-downgrade" } });
}

/** Clicks and sign-ups per platform (optionally for one brand or one post) since a time. */
export async function linkStats(env: Env, o: { since: number; profile_id?: string; source_id?: string }) {
  const where = ["l.source_type = 'social'"], vals: unknown[] = [];
  if (o.profile_id) { where.push("l.profile_id = ?"); vals.push(o.profile_id); }
  if (o.source_id) { where.push("l.source_id = ?"); vals.push(o.source_id); }
  const day = new Date(o.since).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(`SELECT l.platform,
      COALESCE((SELECT SUM(d.clicks) FROM link_days d WHERE d.link_id IN (SELECT id FROM links x WHERE x.platform = l.platform AND x.source_type = 'social' ${o.profile_id ? "AND x.profile_id = ?" : ""} ${o.source_id ? "AND x.source_id = ?" : ""}) AND d.day >= ?), 0) AS clicks,
      (SELECT COUNT(*) FROM contacts c WHERE c.created_at >= ? AND c.ref_link IN (SELECT code FROM links y WHERE y.platform = l.platform AND y.source_type = 'social' ${o.profile_id ? "AND y.profile_id = ?" : ""} ${o.source_id ? "AND y.source_id = ?" : ""})) AS signups
    FROM links l WHERE ${where.join(" AND ")} GROUP BY l.platform ORDER BY clicks DESC`)
    .bind(...(o.profile_id ? [o.profile_id] : []), ...(o.source_id ? [o.source_id] : []), day, o.since,
          ...(o.profile_id ? [o.profile_id] : []), ...(o.source_id ? [o.source_id] : []), ...vals).all<{ platform: string; clicks: number; signups: number }>();
  return results;
}

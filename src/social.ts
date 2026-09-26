import { Env, HttpError, id, now } from "./util";

/*
 * Social posting through Zernio (zernio.com). Brands are Zernio profiles, each holding at most one account
 * per platform. Studio keeps its own copy of every post (drafts live only here); scheduling and publishing
 * are handed to Zernio, and the every-minute cron checks back on posts that are due.
 * With DEV_AUTH=1 and no key, a pretend Zernio is used so the screens can be tried locally.
 */

const BASE = "https://zernio.com/api/v1";

export const PLATFORMS: Record<string, { name: string; limit: number; needsMedia: boolean }> = {
  instagram: { name: "Instagram", limit: 2200, needsMedia: true },
  tiktok: { name: "TikTok", limit: 2200, needsMedia: true },
  linkedin: { name: "LinkedIn", limit: 3000, needsMedia: false },
  threads: { name: "Threads", limit: 500, needsMedia: false },
  bluesky: { name: "Bluesky", limit: 300, needsMedia: false },
  twitter: { name: "X", limit: 280, needsMedia: false },
  pinterest: { name: "Pinterest", limit: 500, needsMedia: true },
  facebook: { name: "Facebook", limit: 63206, needsMedia: false },
};

export interface SocialPost {
  id: string; profile_id: string; content: string; media: string; targets: string; options: string;
  status: string; scheduled_at: number | null; published_at: number | null; zernio_id: string | null;
  results: string; error: string | null; created_at: number; updated_at: number;
}

export async function zernioKey(env: Env): Promise<string> {
  if (env.ZERNIO_API_KEY) return env.ZERNIO_API_KEY;
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = 'zernio_api_key'").first<{ value: string }>();
  return r?.value || "";
}
const mock = async (env: Env) => env.DEV_AUTH === "1" && !(await zernioKey(env));

export async function socialReady(env: Env): Promise<{ connected: boolean; simulated: boolean }> {
  const key = await zernioKey(env);
  return { connected: !!key || env.DEV_AUTH === "1", simulated: !key && env.DEV_AUTH === "1" };
}

async function call<T = any>(env: Env, method: string, path: string, body?: unknown, key?: string): Promise<T> {
  const k = key || (await zernioKey(env));
  if (!k) throw new HttpError(409, "Social posting isn’t connected yet. Add your Zernio key in Settings.");
  const res = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${k}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 200) }; }
  if (!res.ok && res.status !== 207) {
    const msg = String(data?.error?.message || data?.message || data?.error || `Zernio answered with an error (${res.status}).`);
    if (res.status === 401) throw new HttpError(502, "Zernio didn’t accept the key. Check it in Settings.");
    if (res.status === 402) throw new HttpError(402, `Zernio needs a payment method for this: ${msg}`);
    throw new HttpError(502, msg);
  }
  return data as T;
}

/** Check a key works before saving it. */
export async function testKey(env: Env, key: string): Promise<void> {
  await call(env, "GET", "/profiles", undefined, key);
}

/* ---------- pretend Zernio for local testing ---------- */
const MOCK_PROFILES = [{ _id: "pf_demo", name: "Ciúnas" }];
const mockAccounts = new Map<string, any>([
  ["ac_ig", { _id: "ac_ig", platform: "instagram", username: "ciunas", displayName: "Ciúnas", profileId: "pf_demo", isActive: true }],
  ["ac_li", { _id: "ac_li", platform: "linkedin", username: "aisling", displayName: "Aisling", profileId: "pf_demo", isActive: true }],
  ["ac_bs", { _id: "ac_bs", platform: "bluesky", username: "ciunas.bsky.social", displayName: "Ciúnas", profileId: "pf_demo", isActive: true }],
  ["ac_pin", { _id: "ac_pin", platform: "pinterest", username: "ciunas", displayName: "Ciúnas", profileId: "pf_demo", isActive: true }],
]);

/* ---------- brands and accounts ---------- */
export async function listProfiles(env: Env): Promise<Array<{ _id: string; name: string }>> {
  if (await mock(env)) return MOCK_PROFILES;
  const d = await call(env, "GET", "/profiles?limit=100");
  const list = Array.isArray(d) ? d : d.profiles || d.data || [];
  return list.map((p: any) => ({ _id: String(p._id || p.id), name: String(p.name || "Untitled") }));
}

export async function createProfile(env: Env, name: string): Promise<{ _id: string; name: string }> {
  if (await mock(env)) { const p = { _id: id("pf_"), name }; MOCK_PROFILES.push(p); return p; }
  const d = await call(env, "POST", "/profiles", { name });
  const p = d.profile || d;
  return { _id: String(p._id || p.id), name: String(p.name || name) };
}

export async function listAccounts(env: Env, profileId: string): Promise<Array<{ _id: string; platform: string; username: string; displayName: string; picture: string; active: boolean }>> {
  const raw = (await mock(env))
    ? [...mockAccounts.values()].filter((a) => a.profileId === profileId)
    : (() => null)();
  let list: any[] = raw || [];
  if (!raw) {
    const d = await call(env, "GET", `/accounts?profileId=${encodeURIComponent(profileId)}`);
    list = Array.isArray(d) ? d : d.accounts || d.data || [];
  }
  return list
    .filter((a: any) => !a.profileId || String(a.profileId?._id || a.profileId) === profileId)
    .map((a: any) => ({
      _id: String(a._id || a.id), platform: String(a.platform), username: String(a.username || a.displayName || ""),
      displayName: String(a.displayName || a.username || ""), picture: String(a.profilePicture || ""), active: a.isActive !== false,
    }));
}

export async function connectUrl(env: Env, platform: string, profileId: string, back: string): Promise<string> {
  if (!PLATFORMS[platform]) throw new HttpError(400, "Studio doesn’t post to that platform yet.");
  if (await mock(env)) {
    const acc = { _id: id("ac_"), platform, username: `ciunas_${platform}`, displayName: "Ciúnas", profileId, isActive: true };
    mockAccounts.set(acc._id, acc);
    return `${back}${back.includes("?") ? "&" : "?"}connected=${platform}&accountId=${acc._id}&username=${acc.username}`;
  }
  const d = await call(env, "GET", `/connect/${platform}?profileId=${encodeURIComponent(profileId)}&redirect_url=${encodeURIComponent(back)}`);
  const url = d.authUrl || d.url;
  if (!url) throw new HttpError(502, "Zernio didn’t return a sign-in link. Try again in a minute.");
  return String(url);
}

export async function disconnect(env: Env, accountId: string): Promise<void> {
  if (await mock(env)) { mockAccounts.delete(accountId); return; }
  await call(env, "DELETE", `/accounts/${encodeURIComponent(accountId)}`);
}

export async function pinterestBoards(env: Env, accountId: string): Promise<Array<{ id: string; name: string }>> {
  if (await mock(env)) return [{ id: "b1", name: "Ciúnas moodboard" }, { id: "b2", name: "Launch" }];
  const d = await call(env, "GET", `/accounts/${encodeURIComponent(accountId)}/pinterest-boards`);
  const list = Array.isArray(d) ? d : d.boards || d.data || d.items || [];
  return list.map((b: any) => ({ id: String(b.id || b._id || b.boardId), name: String(b.name || b.title || "Board") }));
}

export async function tiktokInfo(env: Env, accountId: string): Promise<{ privacy: string[]; maxDuration: number | null; commentsOff: boolean; duetOff: boolean; stitchOff: boolean }> {
  if (await mock(env)) return { privacy: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"], maxDuration: 600, commentsOff: false, duetOff: false, stitchOff: false };
  const d = await call(env, "GET", `/accounts/${encodeURIComponent(accountId)}/tiktok-creator-info`);
  const c = d.creatorInfo || d.data || d;
  return {
    privacy: Array.isArray(c.privacy_level_options) ? c.privacy_level_options : Array.isArray(c.privacyLevelOptions) ? c.privacyLevelOptions : ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
    maxDuration: Number(c.max_video_post_duration_sec || c.maxVideoPostDurationSec) || null,
    commentsOff: !!(c.comment_disabled ?? c.commentDisabled),
    duetOff: !!(c.duet_disabled ?? c.duetDisabled),
    stitchOff: !!(c.stitch_disabled ?? c.stitchDisabled),
  };
}

/* ---------- media ---------- */
export async function uploadMedia(env: Env, req: Request): Promise<{ url: string; type: string; name: string }> {
  const type = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const name = decodeURIComponent(req.headers.get("x-filename") || "upload").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "upload";
  const kind = type.startsWith("image/") ? (type === "image/gif" ? "gif" : "image") : type.startsWith("video/") ? "video" : "";
  if (!kind) throw new HttpError(400, "Only images and videos can be added.");
  const bytes = await req.arrayBuffer();
  if (!bytes.byteLength) throw new HttpError(400, "That file is empty.");
  if (await mock(env)) return { url: `https://picsum.photos/seed/${encodeURIComponent(name)}/1080/1080`, type: kind, name };
  const p = await call(env, "POST", "/media/presign", { filename: name, contentType: type, size: bytes.byteLength });
  if (!p.uploadUrl || !p.publicUrl) throw new HttpError(502, "Zernio didn’t give Studio somewhere to upload the file.");
  const put = await fetch(p.uploadUrl, { method: "PUT", headers: { "content-type": type }, body: bytes });
  if (!put.ok) throw new HttpError(502, `The upload didn’t go through (${put.status}). Try again.`);
  return { url: String(p.publicUrl), type: kind, name };
}

/* ---------- posts ---------- */
const parse = <T>(s: string, d: T): T => { try { return JSON.parse(s) as T; } catch { return d; } };

/** Everything that would stop a post going out, in plain words. */
export function problems(p: SocialPost): string[] {
  const out: string[] = [];
  const targets = parse<Array<{ platform: string; accountId: string }>>(p.targets, []);
  const media = parse<Array<{ type: string }>>(p.media, []);
  const opts = parse<any>(p.options, {});
  if (!targets.length) out.push("Pick at least one account to post to.");
  if (!p.content.trim() && !media.length) out.push("Write something or add a picture.");
  for (const t of targets) {
    const pl = PLATFORMS[t.platform];
    if (!pl) continue;
    if (pl.needsMedia && !media.length) out.push(`${pl.name} needs a picture or video.`);
    if (p.content.length > pl.limit) out.push(`${pl.name} allows ${pl.limit.toLocaleString("en")} characters. This is ${p.content.length.toLocaleString("en")}.`);
    if (t.platform === "pinterest" && !opts.pinterest?.boardId) out.push("Pick a Pinterest board.");
    if (t.platform === "tiktok") {
      if (!opts.tiktok?.privacy_level) out.push("Choose who can see it on TikTok.");
      if (!opts.tiktok?.consent) out.push("Tick the TikTok music and content box.");
      if (media.some((m) => m.type === "video") && media.length > 1) out.push("TikTok takes one video, or photos only.");
    }
    if (t.platform === "instagram" && media.length > 10) out.push("Instagram carousels hold up to 10 items.");
  }
  return [...new Set(out)];
}

function payload(p: SocialPost) {
  const targets = parse<Array<{ platform: string; accountId: string }>>(p.targets, []);
  const media = parse<Array<{ url: string; type: string }>>(p.media, []);
  const opts = parse<any>(p.options, {});
  const hasVideo = media.some((m) => m.type === "video");
  return {
    content: p.content,
    mediaItems: media.map((m) => ({ url: m.url, type: m.type })),
    platforms: targets.map((t) => {
      let psd: Record<string, unknown> | undefined;
      if (t.platform === "pinterest") psd = { boardId: opts.pinterest?.boardId, ...(opts.pinterest?.title ? { title: String(opts.pinterest.title).slice(0, 100) } : {}), ...(opts.pinterest?.link ? { link: opts.pinterest.link } : {}) };
      if (t.platform === "tiktok") {
        const tk = opts.tiktok || {};
        psd = { tiktokSettings: {
          privacy_level: tk.privacy_level, allow_comment: tk.allow_comment !== false,
          ...(hasVideo ? { allow_duet: tk.allow_duet !== false, allow_stitch: tk.allow_stitch !== false } : { media_type: "photo", photo_cover_index: 0 }),
          content_preview_confirmed: true, express_consent_given: true,
          ...(tk.brand ? { commercialContentType: "brand_organic" } : {}),
        } };
      }
      return { platform: t.platform, accountId: t.accountId, ...(psd ? { platformSpecificData: psd } : {}) };
    }),
    metadata: { studioPostId: p.id },
  };
}

function applyResult(post: any): { status: string; results: string; published_at: number | null; error: string | null } {
  const plats: any[] = Array.isArray(post?.platforms) ? post.platforms : [];
  const results = plats.map((x) => ({
    platform: String(x.platform), status: String(x.status || post.status || ""),
    url: x.platformPostUrl ? String(x.platformPostUrl) : null, error: x.errorMessage ? String(x.errorMessage) : null,
  }));
  let status = String(post?.status || "scheduled");
  if (status === "cancelled") status = "draft";
  const errs = results.filter((r) => r.error).map((r) => `${PLATFORMS[r.platform]?.name || r.platform}: ${r.error}`);
  return { status, results: JSON.stringify(results), published_at: ["published", "partial"].includes(status) ? now() : null, error: errs.join(" · ") || null };
}

async function save(env: Env, pid: string, r: { status: string; results: string; published_at: number | null; error: string | null }, zid?: string) {
  await env.DB.prepare(`UPDATE social_posts SET status = ?, results = ?, error = ?, published_at = COALESCE(published_at, ?), zernio_id = COALESCE(?, zernio_id), updated_at = ? WHERE id = ?`)
    .bind(r.status, r.results, r.error, r.published_at, zid || null, now(), pid).run();
}

/** Hand a post to Zernio: now, or at a time. */
export async function publish(env: Env, p: SocialPost, at: number | null): Promise<void> {
  const issues = problems(p);
  if (issues.length) throw new HttpError(400, issues[0]);
  if (["failed", "partial"].includes(p.status) && p.zernio_id) return retry(env, p);
  if (p.status !== "draft") throw new HttpError(409, "This post has already been handed over. Unschedule it first to change it.");
  const when = at ? { scheduledFor: new Date(at).toISOString(), timezone: "UTC" } : { publishNow: true };
  const t = now();
  await env.DB.prepare("UPDATE social_posts SET status = 'publishing', scheduled_at = ?, error = NULL, updated_at = ? WHERE id = ?").bind(at || t, t, p.id).run();
  try {
    let post: any;
    if (await mock(env)) {
      const targets = parse<Array<{ platform: string }>>(p.targets, []);
      post = { _id: id("zp_"), status: at ? "scheduled" : "published", platforms: targets.map((x) => ({ platform: x.platform, status: at ? "scheduled" : "published", platformPostUrl: at ? null : `https://example.com/${x.platform}/${p.id}` })) };
    } else {
      const d = await call(env, "POST", "/posts", { ...payload(p), ...when });
      post = d.post || d;
    }
    const r = applyResult(post);
    if (at && r.status === "publishing") r.status = "scheduled";
    await save(env, p.id, r, String(post._id || post.id || ""));
  } catch (e) {
    await env.DB.prepare("UPDATE social_posts SET status = ?, error = ?, updated_at = ? WHERE id = ?").bind("draft", (e as Error).message, now(), p.id).run();
    throw e;
  }
}

async function retry(env: Env, p: SocialPost): Promise<void> {
  if (await mock(env)) { await save(env, p.id, { status: "published", results: p.results, published_at: now(), error: null }); return; }
  const d = await call(env, "POST", `/posts/${encodeURIComponent(p.zernio_id!)}/retry`);
  await save(env, p.id, applyResult(d.post || d));
}

/** Take a scheduled post back to a draft. */
export async function unschedule(env: Env, p: SocialPost): Promise<void> {
  if (p.status !== "scheduled") throw new HttpError(409, "Only scheduled posts can be pulled back.");
  if (p.zernio_id && !(await mock(env))) await call(env, "DELETE", `/posts/${encodeURIComponent(p.zernio_id)}`);
  await env.DB.prepare("UPDATE social_posts SET status = 'draft', zernio_id = NULL, results = '[]', error = NULL, updated_at = ? WHERE id = ?").bind(now(), p.id).run();
}

/** Check back on posts that should have gone out by now. */
export async function syncSocial(env: Env, onlyId?: string): Promise<number> {
  const t = now();
  const rows = onlyId
    ? (await env.DB.prepare("SELECT * FROM social_posts WHERE id = ? AND zernio_id IS NOT NULL").bind(onlyId).all<SocialPost>()).results
    : (await env.DB.prepare(`SELECT * FROM social_posts WHERE zernio_id IS NOT NULL AND (status = 'publishing' OR (status = 'scheduled' AND scheduled_at <= ?))
        ORDER BY scheduled_at LIMIT 20`).bind(t + 30_000).all<SocialPost>()).results;
  if (!rows.length) return 0;
  const simulated = await mock(env);
  if (!simulated && !(await zernioKey(env))) return 0;
  let n = 0;
  for (const p of rows) {
    try {
      if (simulated) {
        const targets = parse<Array<{ platform: string }>>(p.targets, []);
        await save(env, p.id, { status: "published", published_at: t, error: null,
          results: JSON.stringify(targets.map((x) => ({ platform: x.platform, status: "published", url: `https://example.com/${x.platform}/${p.id}`, error: null }))) });
      } else {
        const d = await call(env, "GET", `/posts/${encodeURIComponent(p.zernio_id!)}`);
        const r = applyResult(d.post || d);
        if (r.status === "scheduled" && (p.scheduled_at || 0) > t) continue;
        await save(env, p.id, r);
      }
      n++;
    } catch (e) { console.error("Social sync failed for", p.id, (e as Error).message); }
  }
  return n;
}

export { parse as parseJson };

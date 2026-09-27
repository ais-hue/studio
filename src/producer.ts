import { Env, HttpError, esc, getSettings, id, now } from "./util";
import { PLATFORMS, SocialPost, getSlots, listAccounts, listProfiles, nextSlot, pinterestBoards, problems } from "./social";
import { performance } from "./performance";
import { linkStats } from "./links";
import { fileUrl } from "./files";
import { sendTransactional } from "./email";

/*
 * The producer. Each brand has a brief (voice, audience, themes, cadence). Claude reads the brief plus
 * the calendar, results and unused files, drafts a week of posts into a batch, and finishes the batch.
 * Studio then emails Aisling that drafts are waiting; she approves, edits or bins them on the Review page.
 * Nothing here posts or schedules on its own.
 */

export interface Brief {
  profile_id: string; voice: string; audience: string; pillars: string[]; dos: string; donts: string; hashtags: string;
  links: Array<{ label: string; url: string }>; examples: string; cadence: Record<string, number>; pinterest_board: string;
  producer_on: boolean; updated_at: number | null;
}

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export async function getBrief(env: Env, profileId: string): Promise<Brief> {
  const r = await env.DB.prepare("SELECT * FROM brand_briefs WHERE profile_id = ?").bind(profileId).first<any>();
  if (!r) return { profile_id: profileId, voice: "", audience: "", pillars: [], dos: "", donts: "", hashtags: "", links: [], examples: "", cadence: {}, pinterest_board: "", producer_on: false, updated_at: null };
  return { ...r, pillars: JSON.parse(r.pillars || "[]"), links: JSON.parse(r.links || "[]"), cadence: JSON.parse(r.cadence || "{}"), producer_on: !!r.producer_on };
}

export async function saveBrief(env: Env, profileId: string, d: any): Promise<Brief> {
  const cur = await getBrief(env, profileId);
  const list = (v: unknown) => (Array.isArray(v) ? v : String(v ?? "").split("\n")).map((x) => clip(x, 120)).filter(Boolean).slice(0, 12);
  const links = d.links !== undefined
    ? (Array.isArray(d.links) ? d.links : []).map((x: any) => ({ label: clip(x?.label, 80), url: clip(x?.url, 500) })).filter((x: any) => /^https:\/\//.test(x.url)).slice(0, 10)
    : cur.links;
  const cadence: Record<string, number> = {};
  const src = d.cadence !== undefined ? d.cadence || {} : cur.cadence;
  for (const [k, v] of Object.entries(src)) if (PLATFORMS[k]) { const n = Math.max(0, Math.min(21, Math.round(Number(v) || 0))); if (n) cadence[k] = n; }
  const next = {
    voice: d.voice !== undefined ? clip(d.voice, 2000) : cur.voice,
    audience: d.audience !== undefined ? clip(d.audience, 1000) : cur.audience,
    pillars: d.pillars !== undefined ? list(d.pillars) : cur.pillars,
    dos: d.dos !== undefined ? clip(d.dos, 1500) : cur.dos,
    donts: d.donts !== undefined ? clip(d.donts, 1500) : cur.donts,
    hashtags: d.hashtags !== undefined ? clip(d.hashtags, 500) : cur.hashtags,
    examples: d.examples !== undefined ? clip(d.examples, 4000) : cur.examples,
    pinterest_board: d.pinterest_board !== undefined ? clip(d.pinterest_board, 80) : cur.pinterest_board,
    producer_on: d.producer_on !== undefined ? !!d.producer_on : cur.producer_on,
  };
  await env.DB.prepare(`INSERT INTO brand_briefs (profile_id, voice, audience, pillars, dos, donts, hashtags, links, examples, cadence, pinterest_board, producer_on, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(profile_id) DO UPDATE SET voice = excluded.voice, audience = excluded.audience, pillars = excluded.pillars,
    dos = excluded.dos, donts = excluded.donts, hashtags = excluded.hashtags, links = excluded.links, examples = excluded.examples, cadence = excluded.cadence,
    pinterest_board = excluded.pinterest_board, producer_on = excluded.producer_on, updated_at = excluded.updated_at`)
    .bind(profileId, next.voice, next.audience, JSON.stringify(next.pillars), next.dos, next.donts, next.hashtags, JSON.stringify(links), next.examples, JSON.stringify(cadence), next.pinterest_board, next.producer_on ? 1 : 0, now()).run();
  return getBrief(env, profileId);
}

/** Everything Claude needs to plan a brand's week, in one read. */
export async function plannerContext(env: Env, profileId: string, brandName: string, days = 14) {
  const tz = (await getSettings(env)).timezone;
  const t = now(), until = t + days * 864e5;
  const brief = await getBrief(env, profileId);
  const accounts = await listAccounts(env, profileId);
  const slots = await getSlots(env, profileId);
  // Free posting slots over the window.
  const free: string[] = [];
  let after = t + 30 * 60_000;
  for (let i = 0; i < 40; i++) {
    const at = await nextSlot(env, profileId, tz, after);
    if (!at || at > until) break;
    const planned = await env.DB.prepare("SELECT 1 FROM social_posts WHERE profile_id = ? AND status = 'draft' AND planned_at BETWEEN ? AND ?").bind(profileId, at - 30 * 60_000, at + 30 * 60_000).first();
    if (!planned) free.push(new Date(at).toISOString());
    after = at + 60_000;
  }
  const [booked, recent, drafts, unused] = await env.DB.batch([
    env.DB.prepare("SELECT content, targets, scheduled_at FROM social_posts WHERE profile_id = ? AND status = 'scheduled' AND scheduled_at BETWEEN ? AND ? ORDER BY scheduled_at").bind(profileId, t, until),
    env.DB.prepare("SELECT id, content, targets, published_at, metrics FROM social_posts WHERE profile_id = ? AND status IN ('published','partial') ORDER BY published_at DESC LIMIT 12").bind(profileId),
    env.DB.prepare("SELECT content, targets, planned_at FROM social_posts WHERE profile_id = ? AND status = 'draft' ORDER BY updated_at DESC LIMIT 15").bind(profileId),
    env.DB.prepare(`SELECT f.id, f.name, f.kind, f.key, f.alt, f.width, f.height, f.created_at FROM files f WHERE f.status = 'ready' AND f.folder = ? AND f.kind IN ('image','video')
      AND NOT EXISTS (SELECT 1 FROM social_posts p WHERE p.media LIKE '%' || f.key || '%') ORDER BY f.created_at DESC LIMIT 20`).bind(brandName),
  ]);
  const plats = (tj: string) => JSON.parse(tj || "[]").map((x: any) => PLATFORMS[x.platform]?.name || x.platform);
  const perf = await performance(env, profileId, 90).catch(() => null);
  const links = await linkStats(env, { since: t - 90 * 864e5, profile_id: profileId }).catch(() => []);
  let boards: Array<{ id: string; name: string }> = [];
  const pin = accounts.find((a) => a.platform === "pinterest");
  if (pin && !brief.pinterest_board) boards = await pinterestBoards(env, pin._id).catch(() => []);
  return {
    brand: brandName, timezone: tz,
    brief: { ...brief, filled_in: !!(brief.voice || brief.audience || brief.pillars.length) },
    connected_platforms: accounts.map((a) => ({ key: a.platform, name: PLATFORMS[a.platform]?.name, handle: a.username, character_limit: PLATFORMS[a.platform]?.limit, needs_media: PLATFORMS[a.platform]?.needsMedia })),
    posting_times: slots.map((x) => `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][x.day]} ${x.time}`),
    free_slots_next_days: free,
    already_scheduled: (booked.results as any[]).map((p) => ({ when: new Date(p.scheduled_at).toISOString(), platforms: plats(p.targets), first_line: String(p.content || "").split("\n")[0].slice(0, 140) })),
    open_drafts: (drafts.results as any[]).map((p) => ({ planned_for: p.planned_at ? new Date(p.planned_at).toISOString() : null, platforms: plats(p.targets), first_line: String(p.content || "").split("\n")[0].slice(0, 140) })),
    recent_posts: (recent.results as any[]).map((p) => ({ published: new Date(p.published_at).toISOString(), platforms: plats(p.targets), caption: String(p.content || "").slice(0, 500), numbers: JSON.parse(p.metrics || "{}") })),
    what_works: perf ? { best_time: perf.best, per_platform: perf.totals, enough_data: perf.enough } : null,
    link_clicks_and_signups_90_days: links,
    unused_media_in_brand_folder: (unused.results as any[]).map((f) => ({ file_id: f.id, name: f.name, kind: f.kind, description: f.alt, size: f.width ? `${f.width}x${f.height}` : null, url: fileUrl(env, f.key) })),
    pinterest_boards: boards,
    rules: [
      "Only draft for connected platforms, and roughly match the cadence in the brief.",
      "Put each draft in one of free_slots_next_days (planned_for). Don't double up on a slot.",
      "Instagram, TikTok and Pinterest need an image or video: use unused_media_in_brand_folder, or skip those platforms for that post.",
      "Don't invent facts, prices, dates, quotes or offers. If something needs Aisling's input, say so in `why`.",
      "Keep to each platform's character limit; use platform_captions when a platform needs a different version.",
    ],
  };
}

export async function startBatch(env: Env, profileId: string, title: string): Promise<string> {
  const bid = id("db_");
  await env.DB.prepare("INSERT INTO draft_batches (id, profile_id, title, created_at) VALUES (?, ?, ?, ?)").bind(bid, profileId, clip(title, 120) || "Drafts", now()).run();
  return bid;
}

/** Claude is done: mark ready and email Aisling. */
export async function finishBatch(env: Env, batchId: string, summary: string): Promise<{ drafts: number; emailed: boolean }> {
  const b = await env.DB.prepare("SELECT * FROM draft_batches WHERE id = ?").bind(batchId).first<any>();
  if (!b) throw new HttpError(404, "No batch with that id.");
  const { results } = await env.DB.prepare("SELECT * FROM social_posts WHERE batch_id = ? AND status = 'draft' ORDER BY planned_at").bind(batchId).all<SocialPost & { planned_at: number | null }>();
  await env.DB.prepare("UPDATE draft_batches SET status = ?, summary = ?, ready_at = ? WHERE id = ?").bind(results.length ? "ready" : "done", clip(summary, 2000), now(), batchId).run();
  if (!results.length) return { drafts: 0, emailed: false };
  const brands = await listProfiles(env).catch(() => [] as Array<{ _id: string; name: string }>);
  const brand = brands.find((x) => x._id === b.profile_id)?.name || "your brand";
  const settings = await getSettings(env);
  const to = String(env.ADMIN_EMAILS || "").split(/[\s,]+/).filter(Boolean)[0];
  if (!to) return { drafts: results.length, emailed: false };
  const link = `https://studio.${env.ROOT_DOMAIN}/#/review`;
  const tz = settings.timezone;
  const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString("en-IE", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "no time yet");
  const items = results.map((p) => `<li style="margin:0 0 8px"><b>${esc(when(p.planned_at))}</b> · ${esc(JSON.parse(p.targets || "[]").map((x: any) => PLATFORMS[x.platform]?.name || x.platform).join(", "))}<br><span style="color:#4B5367">${esc(String(p.content || "").split("\n")[0].slice(0, 120))}</span></li>`).join("");
  const n = results.length;
  const r = await sendTransactional(env, {
    to, from: `Studio <${settings.sender_email}>`,
    subject: `${n} ${brand} draft${n === 1 ? "" : "s"} ready to review`,
    text: `${n} draft${n === 1 ? "" : "s"} for ${brand} ${n === 1 ? "is" : "are"} waiting for you.\n\n${summary ? summary + "\n\n" : ""}Review them: ${link}\n\nNothing goes out until you approve it.`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0E1628;max-width:560px">
<p style="font-family:Georgia,serif;font-size:20px;letter-spacing:.04em;text-transform:uppercase;margin:0 0 16px">Studio</p>
<p style="margin:0 0 12px"><b>${n} ${esc(brand)} draft${n === 1 ? "" : "s"}</b> ${n === 1 ? "is" : "are"} waiting for you.</p>
${summary ? `<p style="margin:0 0 14px;color:#4B5367">${esc(summary)}</p>` : ""}<ul style="padding-left:18px;margin:0 0 18px">${items}</ul>
<p style="margin:0 0 18px"><a href="${esc(link)}" style="background:#EC7650;color:#0E1628;padding:11px 18px;text-decoration:none;font-weight:bold;display:inline-block">Review drafts</a></p>
<p style="font-size:12px;color:#4B5367">Nothing goes out until you approve it.</p></div>`,
  });
  return { drafts: n, emailed: r.ok };
}

/** Drafts waiting for review, grouped by batch (plus loose drafts Claude made outside a batch). */
export async function reviewQueue(env: Env) {
  const { results: batches } = await env.DB.prepare("SELECT * FROM draft_batches WHERE status IN ('open','ready') ORDER BY created_at DESC").all<any>();
  const { results: posts } = await env.DB.prepare(`SELECT * FROM social_posts WHERE status = 'draft' AND (batch_id IN (SELECT id FROM draft_batches WHERE status IN ('open','ready')) OR (origin = 'claude' AND batch_id IS NULL))
    ORDER BY COALESCE(planned_at, created_at)`).all<SocialPost & { batch_id: string | null; planned_at: number | null; note: string | null }>();
  return { batches, posts };
}

/** Close batches whose drafts have all been dealt with. */
export async function tidyBatches(env: Env): Promise<void> {
  // A run that stopped before finish_draft_batch: show its drafts anyway after 3 hours.
  await env.DB.prepare(`UPDATE draft_batches SET status = 'ready', ready_at = ? WHERE status = 'open' AND created_at < ?
    AND EXISTS (SELECT 1 FROM social_posts p WHERE p.batch_id = draft_batches.id AND p.status = 'draft')`).bind(now(), now() - 3 * 3600_000).run();
  await env.DB.prepare(`UPDATE draft_batches SET status = 'done' WHERE status = 'ready' AND NOT EXISTS (SELECT 1 FROM social_posts p WHERE p.batch_id = draft_batches.id AND p.status = 'draft')`).run();
}

export { problems };

import { Env, HttpError, id, now, slugify } from "./util";
import { PLATFORMS, listProfiles } from "./social";
import { engagementOf, reachOf } from "./performance";

/*
 * Campaigns. One launch or push ("Cipherly autumn", "Ciúnas beta") that groups the emails, social posts,
 * forms and landing pages working towards the same goal, and adds up their results in one place.
 * Stored as "initiatives" because the emails table was named "campaigns" first.
 */

export interface Initiative {
  id: string; workspace: string; name: string; tag: string; goal: string; target: number | null;
  starts_at: number | null; ends_at: number | null; notes: string; archived: number; created_at: number; updated_at: number;
}

export const KINDS = { email: "campaigns", post: "social_posts", form: "forms", page: "pages" } as const;
export type Kind = keyof typeof KINDS;

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const day = 864e5;

export function phase(i: Initiative, t = now()): "planning" | "live" | "done" | "archived" {
  if (i.archived) return "archived";
  const half = day / 2; // dates are stored at midday
  if (i.ends_at && i.ends_at + half <= t) return "done";
  if (i.starts_at && i.starts_at - half <= t) return "live";
  if (!i.starts_at) return i.ends_at ? "live" : "planning";
  return "planning";
}

export async function getInitiative(env: Env, iid: string): Promise<Initiative> {
  const i = await env.DB.prepare("SELECT * FROM initiatives WHERE id = ?").bind(iid).first<Initiative>();
  if (!i) throw new HttpError(404, "That campaign doesn’t exist any more.");
  return i;
}

/** Find by id or (case-insensitive) name, for the connector. */
export async function findInitiative(env: Env, ref: string): Promise<Initiative> {
  const r = clip(ref, 120);
  const i = await env.DB.prepare("SELECT * FROM initiatives WHERE id = ? OR name = ? COLLATE NOCASE ORDER BY archived, updated_at DESC LIMIT 1").bind(r, r).first<Initiative>();
  if (!i) {
    const { results } = await env.DB.prepare("SELECT name FROM initiatives WHERE archived = 0 ORDER BY updated_at DESC LIMIT 20").all<{ name: string }>();
    throw new HttpError(404, `No campaign called “${r}”. Campaigns: ${results.map((x) => x.name).join(", ") || "none yet"}.`);
  }
  return i;
}

/** Dates are days: stored at midday UTC so they read the same in any time zone. */
function dateMs(v: unknown, _endOfDay = false): number | null {
  if (v === null || v === "" || v === undefined) return null;
  const n = typeof v === "number" ? v : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? Date.parse(String(v) + "T12:00:00Z") : Date.parse(String(v));
  if (!Number.isFinite(n)) throw new HttpError(400, "That date doesn’t look right.");
  return n;
}

async function uniqueTag(env: Env, name: string, except?: string): Promise<string> {
  const base = slugify(name, 40) || "campaign";
  for (let n = 1; n < 50; n++) {
    const tag = n === 1 ? base : `${base}-${n}`;
    const hit = await env.DB.prepare("SELECT 1 FROM initiatives WHERE tag = ? AND id != ?").bind(tag, except || "").first();
    if (!hit) return tag;
  }
  return base + "-" + Date.now().toString(36);
}

export async function createInitiative(env: Env, d: any): Promise<Initiative> {
  const name = clip(d.name, 80);
  if (!name) throw new HttpError(400, "Give the campaign a name.");
  const starts = dateMs(d.starts_at), ends = dateMs(d.ends_at, true);
  if (starts && ends && ends < starts) throw new HttpError(400, "The end date is before the start date.");
  const iid = id("in_"), t = now();
  await env.DB.prepare(`INSERT INTO initiatives (id, name, tag, goal, target, starts_at, ends_at, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(iid, name, await uniqueTag(env, name), clip(d.goal, 500), Number(d.target) > 0 ? Math.round(Number(d.target)) : null, starts, ends, clip(d.notes, 5000), t, t).run();
  return getInitiative(env, iid);
}

export async function updateInitiative(env: Env, iid: string, d: any): Promise<Initiative> {
  const i = await getInitiative(env, iid);
  const name = d.name !== undefined ? clip(d.name, 80) || i.name : i.name;
  const starts = d.starts_at !== undefined ? dateMs(d.starts_at) : i.starts_at;
  const ends = d.ends_at !== undefined ? dateMs(d.ends_at, true) : i.ends_at;
  if (starts && ends && ends < starts) throw new HttpError(400, "The end date is before the start date.");
  await env.DB.prepare(`UPDATE initiatives SET name = ?, goal = ?, target = ?, starts_at = ?, ends_at = ?, notes = ?, archived = ?, updated_at = ? WHERE id = ?`).bind(
    name,
    d.goal !== undefined ? clip(d.goal, 500) : i.goal,
    d.target !== undefined ? (Number(d.target) > 0 ? Math.round(Number(d.target)) : null) : i.target,
    starts, ends,
    d.notes !== undefined ? clip(d.notes, 5000) : i.notes,
    d.archived !== undefined ? (d.archived ? 1 : 0) : i.archived,
    now(), iid).run();
  return getInitiative(env, iid);
}

export async function deleteInitiative(env: Env, iid: string): Promise<void> {
  await env.DB.batch([
    ...Object.values(KINDS).map((tbl) => env.DB.prepare(`UPDATE ${tbl} SET initiative_id = NULL WHERE initiative_id = ?`).bind(iid)),
    env.DB.prepare("DELETE FROM initiatives WHERE id = ?").bind(iid),
  ]);
}

/** Put an email, post, form or page in a campaign (or take it out with iid = null). */
export async function setInitiative(env: Env, kind: Kind, itemId: string, iid: string | null): Promise<void> {
  const tbl = KINDS[kind];
  if (!tbl) throw new HttpError(400, "Only emails, posts, forms and pages can go in a campaign.");
  if (iid) await getInitiative(env, iid);
  const r = await env.DB.prepare(`UPDATE ${tbl} SET initiative_id = ? WHERE id = ?`).bind(iid, itemId).run();
  if (!r.meta?.changes) throw new HttpError(404, `That ${kind} doesn’t exist any more.`);
}

/** The utm_campaign tag to use for an email or post, if it's in a campaign. */
export async function tagFor(env: Env, iid: string | null | undefined): Promise<string> {
  if (!iid) return "";
  const r = await env.DB.prepare("SELECT tag FROM initiatives WHERE id = ?").bind(iid).first<{ tag: string }>();
  return r?.tag || "";
}

const LINKS_SQL = `SELECT id, code FROM links WHERE source_type = 'social' AND source_id IN (SELECT id FROM social_posts WHERE initiative_id = ?1)`;

/** Everything in a campaign, plus its results. */
export async function initiativeDetail(env: Env, iid: string) {
  const i = await getInitiative(env, iid);
  const t = now();
  const [emails, posts, forms, pages] = await env.DB.batch([
    env.DB.prepare(`SELECT cp.id, cp.name, cp.subject, cp.status, cp.scheduled_at, cp.sent_at, cp.updated_at,
        (SELECT COUNT(*) FROM sends s WHERE s.campaign_id = cp.id AND s.status = 'sent') AS sent,
        (SELECT COUNT(*) FROM sends s WHERE s.campaign_id = cp.id AND s.opened_at IS NOT NULL) AS opened,
        (SELECT COUNT(*) FROM sends s WHERE s.campaign_id = cp.id AND s.clicked_at IS NOT NULL) AS clicked
      FROM campaigns cp WHERE cp.initiative_id = ? ORDER BY COALESCE(cp.sent_at, cp.scheduled_at, cp.updated_at)`).bind(iid),
    env.DB.prepare(`SELECT p.id, p.profile_id, p.content, p.status, p.targets, p.media, p.scheduled_at, p.published_at, p.planned_at, p.updated_at, p.metrics,
        (SELECT COALESCE(SUM(l.clicks),0) FROM links l WHERE l.source_type = 'social' AND l.source_id = p.id) AS clicks
      FROM social_posts p WHERE p.initiative_id = ? ORDER BY COALESCE(p.published_at, p.scheduled_at, p.planned_at, p.updated_at)`).bind(iid),
    env.DB.prepare(`SELECT f.id, f.name, f.status, (SELECT COUNT(*) FROM form_submissions s WHERE s.form_id = f.id) AS submissions FROM forms f WHERE f.initiative_id = ? ORDER BY f.name`).bind(iid),
    env.DB.prepare(`SELECT pg.id, pg.site_id, pg.slug, pg.title, pg.published, pg.views, s.subdomain, s.name AS site_name FROM pages pg JOIN sites s ON s.id = pg.site_id WHERE pg.initiative_id = ? ORDER BY s.name, pg.slug`).bind(iid),
  ]);
  let brands: Array<{ _id: string; name: string }> = [];
  if ((posts.results as any[]).length) { try { brands = await listProfiles(env); } catch { brands = []; } }
  const bname = (pid: string) => brands.find((b) => b._id === pid)?.name || "";

  // Sign-ups credited to the campaign: from its posts' tracked links, its forms, and its pages.
  const pageSources = (pages.results as any[]).map((p) => `${p.subdomain}/${p.slug || "home"}`);
  const since = i.starts_at ? i.starts_at - 7 * day : 0;
  const srcSql = pageSources.length ? ` OR (c.created_at >= ${Number(since)} AND (${pageSources.map(() => "c.source = ? OR c.source LIKE ?").join(" OR ")}))` : "";
  const srcVals = pageSources.flatMap((s) => [s, s + " %"]);
  const signupWhere = `(c.ref_link IN (SELECT code FROM (${LINKS_SQL}))
      OR c.id IN (SELECT s.contact_id FROM form_submissions s WHERE s.form_id IN (SELECT id FROM forms WHERE initiative_id = ?1))${srcSql})`;
  // ?1 is the campaign id; number the page-source params after it.
  let n = 1;
  const sqlSign = signupWhere.replace(/\?(?!\d)/g, () => `?${++n}`);
  const signups = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN c.status = 'subscribed' THEN 1 ELSE 0 END),0) AS subscribed FROM contacts c WHERE ${sqlSign}`)
    .bind(iid, ...srcVals).first<{ n: number; subscribed: number }>();

  // Daily clicks and sign-ups across the campaign window.
  const from = Math.max(i.starts_at || i.created_at, t - 180 * day) - 7 * day;
  const to = Math.min(t, (i.ends_at || t) + 21 * day);
  const fromDay = new Date(from).toISOString().slice(0, 10), toDay = new Date(to).toISOString().slice(0, 10);
  const [clickDays, mailDays, signDays] = await env.DB.batch([
    env.DB.prepare(`SELECT d.day, SUM(d.clicks) AS n FROM link_days d WHERE d.link_id IN (SELECT id FROM (${LINKS_SQL})) AND d.day BETWEEN ?2 AND ?3 GROUP BY d.day`).bind(iid, fromDay, toDay),
    env.DB.prepare(`SELECT strftime('%Y-%m-%d', s.clicked_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM sends s WHERE s.clicked_at IS NOT NULL AND s.campaign_id IN (SELECT id FROM campaigns WHERE initiative_id = ?1) GROUP BY day`).bind(iid),
    env.DB.prepare(`SELECT strftime('%Y-%m-%d', c.created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n FROM contacts c WHERE ${sqlSign} GROUP BY day`).bind(iid, ...srcVals),
  ]);
  const series: Array<{ day: string; clicks: number; signups: number }> = [];
  const map = (rs: any[]) => Object.fromEntries(rs.map((r) => [r.day, Number(r.n) || 0]));
  const cm = map(clickDays.results as any[]), mm = map(mailDays.results as any[]), sm = map(signDays.results as any[]);
  for (let d = Date.parse(fromDay + "T00:00:00Z"); d <= Date.parse(toDay + "T00:00:00Z"); d += day) {
    const k = new Date(d).toISOString().slice(0, 10);
    series.push({ day: k, clicks: (cm[k] || 0) + (mm[k] || 0), signups: sm[k] || 0 });
  }

  const em = emails.results as any[], po = posts.results as any[];
  const sent = em.reduce((a, e) => a + e.sent, 0), opened = em.reduce((a, e) => a + e.opened, 0), eclicked = em.reduce((a, e) => a + e.clicked, 0);
  let engagement = 0, reach = 0;
  const postView = po.map((p) => {
    const m = JSON.parse(p.metrics || "{}") as Record<string, Record<string, number>>;
    let e = 0, r = 0;
    for (const nums of Object.values(m)) { e += engagementOf(nums); r += reachOf(nums); }
    engagement += e; reach += r;
    return {
      id: p.id, brand: bname(p.profile_id), status: p.status, title: String(p.content || "").split("\n")[0].slice(0, 120) || (p.media !== "[]" ? "Picture post" : "Post"),
      platforms: JSON.parse(p.targets || "[]").map((x: any) => PLATFORMS[x.platform]?.name || x.platform),
      at: p.published_at || p.scheduled_at || p.planned_at || null, when: p.published_at ? "posted" : p.scheduled_at && p.status === "scheduled" ? "scheduled" : p.planned_at ? "planned" : "draft",
      engagement: e, reach: r, clicks: Number(p.clicks) || 0,
    };
  });
  const socialClicks = postView.reduce((a, p) => a + p.clicks, 0);
  const timeline = [
    ...em.map((e) => ({ type: "email", id: e.id, title: e.subject || e.name, at: e.sent_at || e.scheduled_at || null, state: e.status, href: "#/emails/" + e.id })),
    ...postView.map((p) => ({ type: "post", id: p.id, title: p.title, at: p.at, state: p.when === "draft" || p.when === "planned" ? p.when : p.status, sub: p.platforms.join(", "), href: "#/social/p/" + p.id })),
  ].sort((a, b) => (a.at || 9e15) - (b.at || 9e15));

  return {
    campaign: { ...i, phase: phase(i, t) },
    results: {
      signups: signups?.n || 0, subscribed: signups?.subscribed || 0, target: i.target,
      clicks: socialClicks + eclicked, social_clicks: socialClicks, email_clicks: eclicked,
      emails_sent: sent, email_opens: opened, open_rate: sent ? Math.round((100 * opened) / sent) : null,
      posts_out: postView.filter((p) => p.when === "posted").length, engagement, reach,
      form_submissions: (forms.results as any[]).reduce((a, f) => a + f.submissions, 0),
      page_views: (pages.results as any[]).reduce((a, p) => a + p.views, 0),
    },
    series, timeline,
    emails: em.map((e) => ({ id: e.id, name: e.name, subject: e.subject, status: e.status, at: e.sent_at || e.scheduled_at || null, sent: e.sent, opened: e.opened, clicked: e.clicked })),
    posts: postView,
    forms: forms.results, pages: pages.results,
  };
}

/** List with small counts, newest first; live ones on top. */
export async function listInitiatives(env: Env, includeArchived = false) {
  const { results } = await env.DB.prepare(`SELECT i.*,
      (SELECT COUNT(*) FROM campaigns WHERE initiative_id = i.id) AS emails,
      (SELECT COUNT(*) FROM social_posts WHERE initiative_id = i.id) AS posts,
      (SELECT COUNT(*) FROM forms WHERE initiative_id = i.id) AS forms,
      (SELECT COUNT(*) FROM pages WHERE initiative_id = i.id) AS pages,
      (SELECT COALESCE(SUM(l.clicks),0) FROM links l WHERE l.source_type = 'social' AND l.source_id IN (SELECT id FROM social_posts WHERE initiative_id = i.id)) AS clicks
    FROM initiatives i ${includeArchived ? "" : "WHERE i.archived = 0"} ORDER BY i.archived, COALESCE(i.starts_at, i.created_at) DESC`).all<Initiative & { emails: number; posts: number; forms: number; pages: number; clicks: number }>();
  const t = now(), order = { live: 0, planning: 1, done: 2, archived: 3 };
  return results.map((i) => ({ ...i, phase: phase(i, t) })).sort((a, b) => order[a.phase] - order[b.phase]);
}

/** Campaigns running (or starting) in a window, for the producer. */
export async function runningInitiatives(env: Env, from: number, to: number) {
  const { results } = await env.DB.prepare(`SELECT id, name, goal, starts_at, ends_at, notes FROM initiatives WHERE archived = 0
    AND COALESCE(starts_at, 0) <= ? AND COALESCE(ends_at, 9e15) + 86400000 >= ? ORDER BY starts_at`).bind(to, from).all<Initiative>();
  return results.map((i) => ({ name: i.name, goal: i.goal, starts: i.starts_at ? new Date(i.starts_at).toISOString().slice(0, 10) : null, ends: i.ends_at ? new Date(i.ends_at).toISOString().slice(0, 10) : null, notes: i.notes.slice(0, 600) }));
}

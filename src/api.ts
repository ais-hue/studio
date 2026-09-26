import { ACCENTS, Env, HttpError, PRIVATE_SETTINGS, RESERVED_SUBDOMAINS, getSettings, id, isEmail, json, now, slugify } from "./util";
import { Content, Page, Site, renderPage } from "./render";
import { defaultWelcome, siteList, upsertContact } from "./public";
import { Campaign, enqueueCampaign, processQueue, renderEmail, sendStepTest, sendTest } from "./email";
import { CONDITIONS, Sequence, Step, enroll, enrollList, exitAll } from "./automation";
import { connectResendWebhook, webhookStatus } from "./hooks";
import { VERSION } from "./version";
import { PLATFORMS, SocialPost, connectUrl, createProfile, disconnect, listAccounts, listProfiles, parseJson, pinterestBoards, problems, publish, socialReady, syncSocial, testKey, tiktokInfo, unschedule, uploadMedia } from "./social";

const TEMPLATES = ["waitlist", "launch", "links", "post"];
const THEMES = ["auto", "light", "dark"];
const SITE_STATUS = ["building", "live", "paused"];

async function body<T = any>(req: Request): Promise<T> {
  try { return await req.json<T>(); } catch { throw new HttpError(400, "The request body wasn’t valid JSON."); }
}
const str = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);

export function defaultContent(template: string, siteName: string, host: string): Content {
  switch (template) {
    case "launch": return { eyebrow: "Now launching", headline: `Meet ${siteName}`, sub: "What it is, who it’s for, and why it matters, in one sentence.", points: "First reason to care\nSecond reason to care\nThird reason to care", cta: "I want in", form: true };
    case "links": return { headline: siteName, sub: "Everything in one place.", links: `Play the demo | https://${host}\nRead the journal | https://${host}/blog`, cta: "Stay in the loop", form: true };
    case "post": return { headline: "Untitled post", sub: "", body: "Start writing here.\n\n## A heading\n\nParagraphs, **bold**, *italic*, [links](https://example.com) and lists all work.", eyebrow: "Get the next one", cta: "Subscribe", form: true };
    default: return { eyebrow: "Early access", headline: `${siteName} is almost here`, sub: "Be first in when the doors open. One email when it’s ready, nothing else.", cta: "Get early access", form: true };
  }
}

async function uniqueSubdomain(env: Env, want: string, exceptId?: string): Promise<string> {
  let base = slugify(want, 30) || "site";
  if (RESERVED_SUBDOMAINS.has(base)) base = base + "-site";
  let s = base, n = 2;
  while (await env.DB.prepare("SELECT 1 FROM sites WHERE subdomain = ? AND id != ?").bind(s, exceptId || "").first()) s = `${base}-${n++}`;
  return s;
}
async function uniqueSlug(env: Env, siteId: string, want: string, exceptId?: string): Promise<string> {
  let base = slugify(want, 60);
  if (base === "blog" || base.startsWith("__proof")) base = base + "-page";
  let s = base, n = 2;
  while (await env.DB.prepare("SELECT 1 FROM pages WHERE site_id = ? AND slug = ? AND id != ?").bind(siteId, s, exceptId || "").first()) s = `${base || "page"}-${n++}`;
  return s;
}

async function getSite(env: Env, sid: string): Promise<Site> {
  const s = await env.DB.prepare("SELECT * FROM sites WHERE id = ?").bind(sid).first<Site>();
  if (!s) throw new HttpError(404, "That site doesn’t exist any more.");
  return s;
}
async function getPage(env: Env, pid: string): Promise<Page> {
  const p = await env.DB.prepare("SELECT * FROM pages WHERE id = ?").bind(pid).first<Page>();
  if (!p) throw new HttpError(404, "That page doesn’t exist any more.");
  return p;
}
async function getCampaign(env: Env, cid: string): Promise<Campaign> {
  const c = await env.DB.prepare("SELECT * FROM campaigns WHERE id = ?").bind(cid).first<Campaign>();
  if (!c) throw new HttpError(404, "That email doesn’t exist any more.");
  return c;
}

export async function createSite(env: Env, input: { name: string; subdomain?: string; accent?: string; theme?: string; tagline?: string }) {
  const name = str(input.name, 60);
  if (!name) throw new HttpError(400, "Give the site a name.");
  const sid = id("st_");
  const sub = await uniqueSubdomain(env, input.subdomain || name);
  const t = now();
  const accent = input.accent && ACCENTS[input.accent] ? input.accent : "brass";
  const theme = THEMES.includes(input.theme || "") ? input.theme! : "auto";
  await env.DB.prepare("INSERT INTO sites (id, name, subdomain, accent, theme, status, tagline, created_at) VALUES (?, ?, ?, ?, ?, 'building', ?, ?)")
    .bind(sid, name, sub, accent, theme, str(input.tagline, 120), t).run();
  const site = await getSite(env, sid);
  await siteList(env, site);
  const host = `${sub}.${env.ROOT_DOMAIN}`;
  await env.DB.prepare("INSERT INTO pages (id, site_id, slug, title, template, content, published, created_at, updated_at) VALUES (?, ?, '', 'Home', 'waitlist', ?, 0, ?, ?)")
    .bind(id("pg_"), sid, JSON.stringify(defaultContent("waitlist", name, host)), t, t).run();
  return site;
}

async function campaignStats(env: Env, cid: string) {
  return await env.DB.prepare(`SELECT
      COUNT(*) AS total,
      SUM(status = 'sent') AS sent, SUM(status = 'queued') AS queued,
      SUM(status = 'failed') AS failed, SUM(status = 'skipped') AS skipped,
      SUM(opened_at IS NOT NULL) AS opened, SUM(clicked_at IS NOT NULL) AS clicked,
      SUM(delivered_at IS NOT NULL) AS delivered, SUM(bounced_at IS NOT NULL) AS bounced, SUM(complained_at IS NOT NULL) AS complained,
      MAX(CASE WHEN status = 'failed' THEN error END) AS last_error
    FROM sends WHERE campaign_id = ? AND kind = 'campaign'`).bind(cid).first();
}

async function audienceSize(env: Env, listId: string | null): Promise<number> {
  const r = listId
    ? await env.DB.prepare("SELECT COUNT(*) AS n FROM contacts c JOIN list_members m ON m.contact_id = c.id WHERE m.list_id = ? AND c.status = 'subscribed'").bind(listId).first<{ n: number }>()
    : await env.DB.prepare("SELECT COUNT(*) AS n FROM contacts WHERE status = 'subscribed'").first<{ n: number }>();
  return r?.n || 0;
}

export async function handleApi(req: Request, env: Env, ctx: ExecutionContext, user: string): Promise<Response> {
  const url = new URL(req.url);
  const seg = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const m = req.method;
  const [a, b, c] = seg;
  const t = now();

  /* ---------- overview ---------- */
  if (a === "me") return json({ email: user, root: env.ROOT_DOMAIN, emailConnected: !!env.RESEND_API_KEY || env.DEV_AUTH === "1", dev: env.DEV_AUTH === "1", version: VERSION });

  if (a === "overview" && m === "GET") {
    const since = t - 30 * 864e5;
    const [counts, byDay, recent, top, camps] = await env.DB.batch([
      env.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM sites) AS sites,
        (SELECT COUNT(*) FROM sites WHERE status = 'live') AS live_sites,
        (SELECT COUNT(*) FROM pages WHERE published = 1) AS pages_live,
        (SELECT COUNT(*) FROM pages) AS pages,
        (SELECT COUNT(*) FROM contacts WHERE status = 'subscribed') AS subscribed,
        (SELECT COUNT(*) FROM contacts) AS contacts,
        (SELECT COUNT(*) FROM contacts WHERE created_at > ?) AS new30,
        (SELECT COALESCE(SUM(views),0) FROM pages) AS views`).bind(since),
      env.DB.prepare(`SELECT CAST((created_at - ?) / 86400000 AS INTEGER) AS d, COUNT(*) AS n FROM contacts WHERE created_at > ? GROUP BY d`).bind(since, since),
      env.DB.prepare(`SELECT id, email, name, source, status, created_at FROM contacts ORDER BY created_at DESC LIMIT 8`),
      env.DB.prepare(`SELECT p.id, p.title, p.slug, p.views, s.name AS site, s.subdomain, s.accent FROM pages p JOIN sites s ON s.id = p.site_id WHERE p.published = 1 ORDER BY p.views DESC LIMIT 6`),
      env.DB.prepare(`SELECT id, name, subject, status, sent_at, scheduled_at FROM campaigns ORDER BY updated_at DESC LIMIT 5`),
    ]);
    const days = Array(30).fill(0);
    for (const r of byDay.results as any[]) if (r.d >= 0 && r.d < 30) days[r.d] = r.n;
    const campaigns = [];
    for (const cp of camps.results as any[]) campaigns.push({ ...cp, stats: cp.status === "draft" ? null : await campaignStats(env, cp.id) });
    return json({ counts: counts.results[0], signups: days, recent: recent.results, top: top.results, campaigns });
  }

  /* ---------- sites ---------- */
  if (a === "sites") {
    if (!b && m === "GET") {
      const { results } = await env.DB.prepare(`SELECT s.*,
        (SELECT COUNT(*) FROM pages p WHERE p.site_id = s.id) AS pages,
        (SELECT COUNT(*) FROM pages p WHERE p.site_id = s.id AND p.published = 1) AS pages_live,
        (SELECT COALESCE(SUM(views),0) FROM pages p WHERE p.site_id = s.id) AS views,
        (SELECT COUNT(*) FROM list_members m JOIN lists l ON l.id = m.list_id WHERE l.site_id = s.id) AS signups
        FROM sites s ORDER BY s.created_at`).all();
      return json({ sites: results });
    }
    if (!b && m === "POST") return json({ site: await createSite(env, await body(req)) }, 201);
    if (b && !c && m === "PATCH") {
      const s = await getSite(env, b);
      const d = await body(req);
      const next = {
        name: d.name !== undefined ? str(d.name, 60) || s.name : s.name,
        subdomain: d.subdomain !== undefined ? await uniqueSubdomain(env, d.subdomain || s.name, s.id) : s.subdomain,
        accent: d.accent && ACCENTS[d.accent] ? d.accent : s.accent,
        theme: THEMES.includes(d.theme) ? d.theme : s.theme,
        status: SITE_STATUS.includes(d.status) ? d.status : s.status,
        tagline: d.tagline !== undefined ? str(d.tagline, 120) : s.tagline,
      };
      await env.DB.prepare("UPDATE sites SET name = ?, subdomain = ?, accent = ?, theme = ?, status = ?, tagline = ? WHERE id = ?")
        .bind(next.name, next.subdomain, next.accent, next.theme, next.status, next.tagline, s.id).run();
      return json({ site: await getSite(env, s.id) });
    }
    if (b && !c && m === "DELETE") {
      await getSite(env, b);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM pages WHERE site_id = ?").bind(b),
        env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(b),
      ]);
      return json({ ok: true });
    }
    if (b && c === "pages" && m === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM pages WHERE site_id = ? ORDER BY (slug = '') DESC, template = 'post', created_at").bind(b).all();
      return json({ pages: results });
    }
  }

  /* ---------- pages ---------- */
  if (a === "pages") {
    if (!b && m === "POST") {
      const d = await body(req);
      const site = await getSite(env, str(d.site_id));
      const template = TEMPLATES.includes(d.template) ? d.template : "waitlist";
      const title = str(d.title, 80) || "Untitled";
      const slug = await uniqueSlug(env, site.id, d.slug || title);
      const content = defaultContent(template, site.name, `${site.subdomain}.${env.ROOT_DOMAIN}`);
      if (template === "post") content.headline = title;
      const pid = id("pg_");
      await env.DB.prepare("INSERT INTO pages (id, site_id, slug, title, template, content, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)")
        .bind(pid, site.id, slug, title, template, JSON.stringify(content), t, t).run();
      return json({ page: await getPage(env, pid) }, 201);
    }
    if (b && m === "PATCH") {
      const p = await getPage(env, b);
      const d = await body(req);
      const title = d.title !== undefined ? str(d.title, 80) || p.title : p.title;
      let slug = p.slug;
      if (d.slug !== undefined && p.slug !== "") slug = await uniqueSlug(env, p.site_id, d.slug || title, p.id);
      const content = d.content !== undefined ? JSON.stringify(d.content).slice(0, 100_000) : p.content;
      const published = d.published !== undefined ? (d.published ? 1 : 0) : p.published;
      await env.DB.prepare("UPDATE pages SET title = ?, slug = ?, content = ?, published = ?, updated_at = ? WHERE id = ?")
        .bind(title, slug, content, published, t, p.id).run();
      return json({ page: await getPage(env, p.id) });
    }
    if (b && m === "DELETE") {
      const p = await getPage(env, b);
      if (p.slug === "") throw new HttpError(400, "The home page can’t be deleted. Switch it off instead.");
      await env.DB.prepare("DELETE FROM pages WHERE id = ?").bind(b).run();
      return json({ ok: true });
    }
  }

  if (a === "preview" && m === "POST") {
    const d = await body(req);
    const site = await getSite(env, str(d.site_id));
    if (d.site) Object.assign(site, { name: d.site.name ?? site.name, accent: d.site.accent ?? site.accent, theme: d.site.theme ?? site.theme });
    if (d.theme) site.theme = d.theme;
    const pg = d.page || {};
    const page: Page = { id: pg.id || "preview", site_id: site.id, slug: pg.slug ?? "preview", title: pg.title || "Preview", template: pg.template || "waitlist",
      content: JSON.stringify(pg.content || {}), published: 1, created_at: pg.created_at || t, updated_at: t };
    const settings = await getSettings(env);
    const hasBlog = !!(await env.DB.prepare("SELECT 1 FROM pages WHERE site_id = ? AND template = 'post' AND published = 1").bind(site.id).first());
    return new Response(renderPage(site, page, { host: `${site.subdomain}.${env.ROOT_DOMAIN}`, preview: true, consentText: settings.consent_text, hasBlog }),
      { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  /* ---------- contacts ---------- */
  if (a === "contacts") {
    if (!b && m === "GET") {
      const q = str(url.searchParams.get("q"), 100);
      const list = url.searchParams.get("list");
      const status = url.searchParams.get("status");
      const limit = Math.min(500, Number(url.searchParams.get("limit")) || 100);
      const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
      const where: string[] = []; const vals: unknown[] = [];
      if (q) { where.push("(c.email LIKE ? OR c.name LIKE ?)"); vals.push(`%${q}%`, `%${q}%`); }
      if (status) { where.push("c.status = ?"); vals.push(status); }
      if (list) { where.push("EXISTS (SELECT 1 FROM list_members m WHERE m.contact_id = c.id AND m.list_id = ?)"); vals.push(list); }
      const w = where.length ? "WHERE " + where.join(" AND ") : "";
      const [rows, total] = await env.DB.batch([
        env.DB.prepare(`SELECT c.id, c.email, c.name, c.status, c.source, c.consent_at, c.created_at,
          (SELECT GROUP_CONCAT(m.list_id) FROM list_members m WHERE m.contact_id = c.id) AS list_ids
          FROM contacts c ${w} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`).bind(...vals, limit, offset),
        env.DB.prepare(`SELECT COUNT(*) AS n FROM contacts c ${w}`).bind(...vals),
      ]);
      return json({ contacts: rows.results, total: (total.results[0] as any).n });
    }
    if (b === "import" && m === "POST") {
      const d = await body(req);
      if (!d.consent_confirmed) throw new HttpError(400, "Confirm these people agreed to hear from you before importing.");
      const listId = d.list_id ? str(d.list_id) : null;
      if (listId && !(await env.DB.prepare("SELECT 1 FROM lists WHERE id = ?").bind(listId).first())) throw new HttpError(404, "That list doesn’t exist.");
      const rows: Array<{ email: string; name?: string }> = Array.isArray(d.rows) ? d.rows.slice(0, 5000) : [];
      let added = 0, updated = 0, invalid = 0;
      for (const r of rows) {
        const email = str(r.email, 254).toLowerCase();
        if (!isEmail(email)) { invalid++; continue; }
        const res = await upsertContact(env, email, str(r.name, 80), "import", null, listId);
        res.created ? added++ : updated++;
      }
      return json({ added, updated, invalid });
    }
    if (!b && m === "POST") {
      const d = await body(req);
      const email = str(d.email, 254).toLowerCase();
      if (!isEmail(email)) throw new HttpError(400, "That email address doesn’t look right.");
      const lists: string[] = Array.isArray(d.lists) ? d.lists : [];
      const r = await upsertContact(env, email, str(d.name, 80), "manual", null, null);
      for (const l of lists) await env.DB.prepare("INSERT OR IGNORE INTO list_members (list_id, contact_id, added_at) VALUES (?, ?, ?)").bind(l, r.contactId, t).run();
      return json({ id: r.contactId, created: r.created }, 201);
    }
    if (b && m === "GET") {
      const ct = await env.DB.prepare("SELECT * FROM contacts WHERE id = ?").bind(b).first();
      if (!ct) throw new HttpError(404, "That contact doesn’t exist any more.");
      const [lists, sends, enrolled] = await env.DB.batch([
        env.DB.prepare("SELECT list_id FROM list_members WHERE contact_id = ?").bind(b),
        env.DB.prepare(`SELECT s.kind, s.status, s.error, s.sent_at, s.opened_at, s.clicked_at, s.bounced_at, s.complained_at, s.created_at, cp.name AS campaign, st.subject AS step_subject, q.name AS sequence
          FROM sends s LEFT JOIN campaigns cp ON cp.id = s.campaign_id LEFT JOIN sequence_steps st ON st.id = s.step_id LEFT JOIN sequences q ON q.id = st.sequence_id
          WHERE s.contact_id = ? ORDER BY s.created_at DESC LIMIT 30`).bind(b),
        env.DB.prepare(`SELECT e.id, e.sequence_id, e.status, e.exit_reason, e.step_index, e.next_at, e.created_at, q.name, (SELECT COUNT(*) FROM sequence_steps x WHERE x.sequence_id = q.id) AS steps
          FROM enrollments e JOIN sequences q ON q.id = e.sequence_id WHERE e.contact_id = ? ORDER BY e.created_at DESC`).bind(b),
      ]);
      return json({ contact: ct, lists: (lists.results as any[]).map((x) => x.list_id), sends: sends.results, enrollments: enrolled.results });
    }
    if (b && m === "PATCH") {
      const d = await body(req);
      const ct = await env.DB.prepare("SELECT * FROM contacts WHERE id = ?").bind(b).first<any>();
      if (!ct) throw new HttpError(404, "That contact doesn’t exist any more.");
      const status = ["subscribed", "unsubscribed", "bounced", "complained", "pending"].includes(d.status) ? d.status : ct.status;
      await env.DB.prepare("UPDATE contacts SET name = ?, status = ?, updated_at = ? WHERE id = ?").bind(d.name !== undefined ? str(d.name, 80) : ct.name, status, t, b).run();
      if (status !== "subscribed" && ct.status === "subscribed") await exitAll(env, b, status);
      if (Array.isArray(d.lists)) {
        const stmts = [env.DB.prepare("DELETE FROM list_members WHERE contact_id = ?").bind(b)];
        for (const l of d.lists) stmts.push(env.DB.prepare("INSERT OR IGNORE INTO list_members (list_id, contact_id, added_at) VALUES (?, ?, ?)").bind(String(l), b, t));
        await env.DB.batch(stmts);
      }
      return json({ ok: true });
    }
    if (b && m === "DELETE") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM list_members WHERE contact_id = ?").bind(b),
        env.DB.prepare("DELETE FROM sends WHERE contact_id = ?").bind(b),
        env.DB.prepare("DELETE FROM enrollments WHERE contact_id = ?").bind(b),
        env.DB.prepare("DELETE FROM contacts WHERE id = ?").bind(b),
      ]);
      return json({ ok: true });
    }
  }

  /* ---------- lists ---------- */
  if (a === "lists") {
    if (!b && m === "GET") {
      const { results } = await env.DB.prepare(`SELECT l.*, s.name AS site_name, s.subdomain,
        (SELECT COUNT(*) FROM list_members m JOIN contacts c ON c.id = m.contact_id WHERE m.list_id = l.id AND c.status = 'subscribed') AS subscribed,
        (SELECT COUNT(*) FROM list_members m WHERE m.list_id = l.id) AS members
        FROM lists l LEFT JOIN sites s ON s.id = l.site_id ORDER BY l.site_id IS NULL, l.created_at`).all();
      return json({ lists: results });
    }
    if (!b && m === "POST") {
      const d = await body(req);
      const name = str(d.name, 60);
      if (!name) throw new HttpError(400, "Give the list a name.");
      const lid = id("l_");
      await env.DB.prepare("INSERT INTO lists (id, name, welcome_subject, welcome_body, created_at) VALUES (?, ?, ?, ?, ?)").bind(lid, name, `Welcome`, defaultWelcome("this list"), t).run();
      return json({ id: lid }, 201);
    }
    if (b && m === "PATCH") {
      const d = await body(req);
      const l = await env.DB.prepare("SELECT * FROM lists WHERE id = ?").bind(b).first<any>();
      if (!l) throw new HttpError(404, "That list doesn’t exist any more.");
      await env.DB.prepare("UPDATE lists SET name = ?, welcome_enabled = ?, welcome_subject = ?, welcome_body = ? WHERE id = ?").bind(
        d.name !== undefined ? str(d.name, 60) || l.name : l.name,
        d.welcome_enabled !== undefined ? (d.welcome_enabled ? 1 : 0) : l.welcome_enabled,
        d.welcome_subject !== undefined ? str(d.welcome_subject, 150) : l.welcome_subject,
        d.welcome_body !== undefined ? str(d.welcome_body, 20000) : l.welcome_body, b).run();
      return json({ ok: true });
    }
    if (b && m === "DELETE") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM list_members WHERE list_id = ?").bind(b),
        env.DB.prepare("UPDATE sequences SET trigger_list_id = NULL, status = CASE WHEN status = 'active' THEN 'paused' ELSE status END, updated_at = ? WHERE trigger_list_id = ?").bind(t, b),
        env.DB.prepare("DELETE FROM lists WHERE id = ?").bind(b),
      ]);
      return json({ ok: true });
    }
  }

  /* ---------- campaigns ---------- */
  if (a === "campaigns") {
    if (!b && m === "GET") {
      const { results } = await env.DB.prepare(`SELECT cp.id, cp.name, cp.subject, cp.status, cp.list_id, cp.site_id, cp.scheduled_at, cp.sent_at, cp.updated_at, l.name AS list_name
        FROM campaigns cp LEFT JOIN lists l ON l.id = cp.list_id ORDER BY cp.updated_at DESC`).all<any>();
      const out = [];
      for (const r of results) out.push({ ...r, stats: r.status === "draft" ? null : await campaignStats(env, r.id) });
      return json({ campaigns: out });
    }
    if (!b && m === "POST") {
      const d = await body(req);
      const cid = id("cp_");
      await env.DB.prepare("INSERT INTO campaigns (id, name, subject, preheader, body, list_id, site_id, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?)")
        .bind(cid, str(d.name, 80) || "Untitled email", str(d.subject, 150), "Hi {{name}},\n\nWrite your email here.\n\nAisling", d.list_id || null, d.site_id || null, t, t).run();
      return json({ campaign: await getCampaign(env, cid) }, 201);
    }
    if (b && !c && m === "GET") {
      const cp = await getCampaign(env, b);
      return json({ campaign: cp, stats: await campaignStats(env, b), audience: await audienceSize(env, cp.list_id) });
    }
    if (b && !c && m === "PATCH") {
      const cp = await getCampaign(env, b);
      if (!["draft", "scheduled"].includes(cp.status)) throw new HttpError(409, "This email has already gone out, so it can’t be edited. Duplicate it instead.");
      const d = await body(req);
      const f = (k: string, max: number) => (d[k] !== undefined ? str(d[k], max) : (cp as any)[k]);
      const listId = d.list_id !== undefined ? d.list_id || null : cp.list_id;
      const siteId = d.site_id !== undefined ? d.site_id || null : cp.site_id;
      await env.DB.prepare("UPDATE campaigns SET name = ?, subject = ?, preheader = ?, body = ?, list_id = ?, site_id = ?, updated_at = ? WHERE id = ?")
        .bind(f("name", 80) || "Untitled email", f("subject", 150), f("preheader", 200), f("body", 50000), listId, siteId, t, b).run();
      return json({ campaign: await getCampaign(env, b), audience: await audienceSize(env, listId) });
    }
    if (b && !c && m === "DELETE") {
      const cp = await getCampaign(env, b);
      if (cp.status === "sending") throw new HttpError(409, "This email is sending right now. Wait for it to finish.");
      await env.DB.batch([env.DB.prepare("DELETE FROM sends WHERE campaign_id = ?").bind(b), env.DB.prepare("DELETE FROM campaigns WHERE id = ?").bind(b)]);
      return json({ ok: true });
    }
    if (b && c === "test" && m === "POST") {
      const cp = await getCampaign(env, b);
      const d = await body(req);
      const to = str(d.to, 254).toLowerCase();
      if (!isEmail(to)) throw new HttpError(400, "Enter an email address to send the test to.");
      if (!cp.subject) throw new HttpError(400, "Add a subject line first.");
      const r = await sendTest(env, cp, to);
      if (!r.ok) throw new HttpError(502, r.error || "The test didn’t send.");
      return json({ ok: true });
    }
    if (b && c === "send" && m === "POST") {
      const cp = await getCampaign(env, b);
      if (!["draft", "scheduled"].includes(cp.status)) throw new HttpError(409, "This email has already gone out.");
      if (!cp.subject.trim()) throw new HttpError(400, "Add a subject line before sending.");
      if (!cp.body.trim()) throw new HttpError(400, "The email is empty.");
      if (!env.RESEND_API_KEY && env.DEV_AUTH !== "1") throw new HttpError(409, "Email sending isn’t connected yet. Add your Resend key in Settings first.");
      const d = await body(req);
      if (d.at) {
        const at = Number(d.at);
        if (!(at > t + 60_000)) throw new HttpError(400, "Pick a time at least a couple of minutes from now.");
        await env.DB.prepare("UPDATE campaigns SET status = 'scheduled', scheduled_at = ?, updated_at = ? WHERE id = ?").bind(at, t, b).run();
        return json({ scheduled: at });
      }
      const n = await enqueueCampaign(env, cp);
      ctx.waitUntil(processQueue(env, 300));
      return json({ queued: n });
    }
    if (b && c === "cancel" && m === "POST") {
      await env.DB.prepare("UPDATE campaigns SET status = 'draft', scheduled_at = NULL, updated_at = ? WHERE id = ? AND status = 'scheduled'").bind(t, b).run();
      return json({ campaign: await getCampaign(env, b) });
    }
    if (b && c === "retry" && m === "POST") {
      await env.DB.prepare("UPDATE sends SET status = 'queued', error = NULL WHERE campaign_id = ? AND status = 'failed'").bind(b).run();
      await env.DB.prepare("UPDATE campaigns SET status = 'sending', updated_at = ? WHERE id = ?").bind(t, b).run();
      ctx.waitUntil(processQueue(env, 300));
      return json({ ok: true });
    }
    if (b && c === "duplicate" && m === "POST") {
      const cp = await getCampaign(env, b);
      const cid = id("cp_");
      await env.DB.prepare("INSERT INTO campaigns (id, name, subject, preheader, body, list_id, site_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(cid, `${cp.name} (copy)`.slice(0, 80), cp.subject, cp.preheader, cp.body, cp.list_id, cp.site_id, t, t).run();
      return json({ campaign: await getCampaign(env, cid) }, 201);
    }
  }

  if (a === "email-preview" && m === "POST") {
    const d = await body(req);
    const settings = await getSettings(env);
    const site = d.site_id ? await env.DB.prepare("SELECT name, accent FROM sites WHERE id = ?").bind(d.site_id).first<{ name: string; accent: string }>() : null;
    const r = renderEmail(env, settings, { subject: str(d.subject, 150), preheader: str(d.preheader, 200), body: String(d.body || ""), accent: site?.accent, siteName: site?.name, email: "reader@example.com", name: "Róisín", token: "preview" });
    return new Response(r.html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }


  /* ---------- automations ---------- */
  if (a === "sequences") {
    if (!b && m === "GET") {
      const { results } = await env.DB.prepare(`SELECT q.*, l.name AS list_name, cp.name AS campaign_name,
        (SELECT COUNT(*) FROM sequence_steps x WHERE x.sequence_id = q.id) AS steps,
        (SELECT COUNT(*) FROM enrollments e WHERE e.sequence_id = q.id AND e.status = 'active') AS active,
        (SELECT COUNT(*) FROM enrollments e WHERE e.sequence_id = q.id AND e.status = 'completed') AS completed,
        (SELECT COUNT(*) FROM enrollments e WHERE e.sequence_id = q.id) AS total,
        (SELECT COUNT(*) FROM sends s JOIN sequence_steps x ON x.id = s.step_id WHERE x.sequence_id = q.id AND s.status = 'sent') AS sent
        FROM sequences q LEFT JOIN lists l ON l.id = q.trigger_list_id LEFT JOIN campaigns cp ON cp.id = q.trigger_campaign_id
        ORDER BY q.status = 'active' DESC, q.updated_at DESC`).all();
      return json({ sequences: results });
    }
    if (!b && m === "POST") {
      const d = await body(req);
      const sid = id("sq_");
      const listId = d.trigger_list_id ? str(d.trigger_list_id) : null;
      await env.DB.batch([
        env.DB.prepare("INSERT INTO sequences (id, name, trigger, trigger_list_id, site_id, created_at, updated_at) VALUES (?, ?, 'list', ?, ?, ?, ?)")
          .bind(sid, str(d.name, 80) || "Untitled automation", listId, d.site_id || null, t, t),
        env.DB.prepare("INSERT INTO sequence_steps (id, sequence_id, position, delay_minutes, subject, body, created_at, updated_at) VALUES (?, ?, 0, 0, ?, ?, ?, ?)")
          .bind(id("sp_"), sid, "Welcome", "Hi {{name}},\n\nThanks for signing up. Here’s what happens next.\n\nAisling", t, t),
      ]);
      return json({ id: sid }, 201);
    }
    if (b) {
      const q = await env.DB.prepare("SELECT * FROM sequences WHERE id = ?").bind(b).first<Sequence>();
      if (!q) throw new HttpError(404, "That automation doesn’t exist any more.");
      if (!c && m === "GET") {
        const [steps, counts, people] = await env.DB.batch([
          env.DB.prepare(`SELECT st.*,
            (SELECT COUNT(*) FROM sends s WHERE s.step_id = st.id AND s.status = 'sent') AS sent,
            (SELECT COUNT(*) FROM sends s WHERE s.step_id = st.id AND s.opened_at IS NOT NULL) AS opened,
            (SELECT COUNT(*) FROM sends s WHERE s.step_id = st.id AND s.clicked_at IS NOT NULL) AS clicked,
            (SELECT COUNT(*) FROM sends s WHERE s.step_id = st.id AND s.status = 'queued') AS queued
            FROM sequence_steps st WHERE st.sequence_id = ? ORDER BY st.position`).bind(b),
          env.DB.prepare(`SELECT SUM(status = 'active') AS active, SUM(status = 'completed') AS completed, SUM(status = 'exited') AS exited, COUNT(*) AS total FROM enrollments WHERE sequence_id = ?`).bind(b),
          env.DB.prepare(`SELECT e.id, e.status, e.exit_reason, e.step_index, e.next_at, e.created_at, c.id AS contact_id, c.email, c.name
            FROM enrollments e JOIN contacts c ON c.id = e.contact_id WHERE e.sequence_id = ? ORDER BY e.created_at DESC LIMIT 25`).bind(b),
        ]);
        return json({ sequence: q, steps: steps.results, counts: counts.results[0], people: people.results });
      }
      if (!c && m === "PATCH") {
        const d = await body(req);
        const next = {
          name: d.name !== undefined ? str(d.name, 80) || q.name : q.name,
          trigger: ["list", "click", "manual"].includes(d.trigger) ? d.trigger : q.trigger,
          trigger_list_id: d.trigger_list_id !== undefined ? d.trigger_list_id || null : q.trigger_list_id,
          trigger_campaign_id: d.trigger_campaign_id !== undefined ? d.trigger_campaign_id || null : q.trigger_campaign_id,
          site_id: d.site_id !== undefined ? d.site_id || null : q.site_id,
          status: ["draft", "active", "paused"].includes(d.status) ? d.status : q.status,
        };
        if (next.status === "active" && q.status !== "active") {
          if (next.trigger === "list" && !(next.trigger_list_id && await env.DB.prepare("SELECT 1 FROM lists WHERE id = ?").bind(next.trigger_list_id).first()))
            throw new HttpError(400, "Pick the list that starts this automation first.");
          if (next.trigger === "click" && !(next.trigger_campaign_id && await env.DB.prepare("SELECT 1 FROM campaigns WHERE id = ?").bind(next.trigger_campaign_id).first()))
            throw new HttpError(400, "Pick the email whose links start this automation first.");
          const steps = (await env.DB.prepare("SELECT position, subject, body FROM sequence_steps WHERE sequence_id = ? ORDER BY position").bind(b).all<Step>()).results;
          if (!steps.length) throw new HttpError(400, "Add at least one email first.");
          const bad = steps.findIndex((s) => !s.subject.trim() || !s.body.trim());
          if (bad > -1) throw new HttpError(400, `Email ${bad + 1} needs a subject and a message before this can go live.`);
          if (!env.RESEND_API_KEY && env.DEV_AUTH !== "1") throw new HttpError(409, "Email sending isn’t connected yet.");
        }
        await env.DB.prepare("UPDATE sequences SET name = ?, trigger = ?, trigger_list_id = ?, trigger_campaign_id = ?, site_id = ?, status = ?, updated_at = ? WHERE id = ?")
          .bind(next.name, next.trigger, next.trigger_list_id, next.trigger_campaign_id, next.site_id, next.status, t, b).run();
        return json({ sequence: await env.DB.prepare("SELECT * FROM sequences WHERE id = ?").bind(b).first() });
      }
      if (!c && m === "DELETE") {
        await env.DB.batch([
          env.DB.prepare("DELETE FROM enrollments WHERE sequence_id = ?").bind(b),
          env.DB.prepare("DELETE FROM sends WHERE status = 'queued' AND step_id IN (SELECT id FROM sequence_steps WHERE sequence_id = ?)").bind(b),
          env.DB.prepare("DELETE FROM sequence_steps WHERE sequence_id = ?").bind(b),
          env.DB.prepare("DELETE FROM sequences WHERE id = ?").bind(b),
        ]);
        return json({ ok: true });
      }
      if (c === "steps" && m === "POST") {
        const last = await env.DB.prepare("SELECT MAX(position) AS p FROM sequence_steps WHERE sequence_id = ?").bind(b).first<{ p: number | null }>();
        const pos = last?.p == null ? 0 : last.p + 1;
        await env.DB.prepare("INSERT INTO sequence_steps (id, sequence_id, position, delay_minutes, subject, body, created_at, updated_at) VALUES (?, ?, ?, ?, '', ?, ?, ?)")
          .bind(id("sp_"), b, pos, pos === 0 ? 0 : 2 * 1440, "Hi {{name}},\n\n\n\nAisling", t, t).run();
        return json({ ok: true }, 201);
      }
      if (c === "enroll-list" && m === "POST") {
        if (q.status !== "active") throw new HttpError(409, "Switch the automation on first.");
        if (q.trigger !== "list" || !q.trigger_list_id) throw new HttpError(400, "This automation doesn’t start from a list.");
        return json({ added: await enrollList(env, b, q.trigger_list_id) });
      }
      if (c === "enroll" && m === "POST") {
        if (q.status !== "active") throw new HttpError(409, "Switch the automation on first.");
        const d = await body(req);
        const ct = await env.DB.prepare("SELECT id, status FROM contacts WHERE id = ?").bind(str(d.contact_id)).first<{ id: string; status: string }>();
        if (!ct) throw new HttpError(404, "That contact doesn’t exist any more.");
        if (ct.status !== "subscribed") throw new HttpError(400, "Only subscribed contacts can be added.");
        if (!(await enroll(env, b, ct.id))) throw new HttpError(409, "They’ve already been through this automation.");
        return json({ ok: true });
      }
    }
  }

  if (a === "steps" && b) {
    const st = await env.DB.prepare("SELECT * FROM sequence_steps WHERE id = ?").bind(b).first<Step>();
    if (!st) throw new HttpError(404, "That email doesn’t exist any more.");
    const touch = env.DB.prepare("UPDATE sequences SET updated_at = ? WHERE id = ?").bind(t, st.sequence_id);
    if (!c && m === "PATCH") {
      const d = await body(req);
      const f = (k: string, max: number) => (d[k] !== undefined ? str(d[k], max) : (st as any)[k]);
      const delay = d.delay_minutes !== undefined ? Math.max(0, Math.min(365 * 1440, Math.round(Number(d.delay_minutes) || 0))) : st.delay_minutes;
      const cond = CONDITIONS.includes(d.condition) ? d.condition : st.condition;
      await env.DB.batch([
        env.DB.prepare("UPDATE sequence_steps SET subject = ?, preheader = ?, body = ?, delay_minutes = ?, condition = ?, updated_at = ? WHERE id = ?")
          .bind(f("subject", 150), f("preheader", 200), f("body", 50000), delay, cond, t, b),
        touch,
      ]);
      return json({ step: await env.DB.prepare("SELECT * FROM sequence_steps WHERE id = ?").bind(b).first() });
    }
    if (!c && m === "DELETE") {
      const idx = (await env.DB.prepare("SELECT COUNT(*) AS n FROM sequence_steps WHERE sequence_id = ? AND position < ?").bind(st.sequence_id, st.position).first<{ n: number }>())?.n || 0;
      await env.DB.batch([
        env.DB.prepare("DELETE FROM sends WHERE step_id = ? AND status = 'queued'").bind(b),
        env.DB.prepare("DELETE FROM sequence_steps WHERE id = ?").bind(b),
        // People waiting further along keep their place.
        env.DB.prepare("UPDATE enrollments SET step_index = step_index - 1 WHERE sequence_id = ? AND status = 'active' AND step_index > ?").bind(st.sequence_id, idx),
        touch,
      ]);
      return json({ ok: true });
    }
    if (c === "move" && m === "POST") {
      const d = await body(req);
      const other = await env.DB.prepare(`SELECT id, position FROM sequence_steps WHERE sequence_id = ? AND position ${d.dir < 0 ? "<" : ">"} ? ORDER BY position ${d.dir < 0 ? "DESC" : "ASC"} LIMIT 1`)
        .bind(st.sequence_id, st.position).first<{ id: string; position: number }>();
      if (other) await env.DB.batch([
        env.DB.prepare("UPDATE sequence_steps SET position = ? WHERE id = ?").bind(other.position, st.id),
        env.DB.prepare("UPDATE sequence_steps SET position = ? WHERE id = ?").bind(st.position, other.id),
        touch,
      ]);
      return json({ ok: true });
    }
    if (c === "test" && m === "POST") {
      const d = await body(req);
      const to = str(d.to, 254).toLowerCase();
      if (!isEmail(to)) throw new HttpError(400, "Enter an email address to send the test to.");
      if (!st.subject.trim()) throw new HttpError(400, "Add a subject line first.");
      const q = await env.DB.prepare("SELECT site_id FROM sequences WHERE id = ?").bind(st.sequence_id).first<{ site_id: string | null }>();
      const r = await sendStepTest(env, st, q?.site_id || null, to);
      if (!r.ok) throw new HttpError(502, r.error || "The test didn’t send.");
      return json({ ok: true });
    }
  }

  if (a === "enrollments" && b && c === "exit" && m === "POST") {
    await env.DB.prepare("UPDATE enrollments SET status = 'exited', exit_reason = 'removed', next_at = NULL, updated_at = ? WHERE id = ? AND status = 'active'").bind(t, b).run();
    return json({ ok: true });
  }


  /* ---------- social ---------- */
  if (a === "social") {
    const s1 = seg[1], s2 = seg[2], s3 = seg[3];
    if (s1 === "status" && m === "GET") return json({ ...(await socialReady(env)), platforms: PLATFORMS });
    if (s1 === "brands" && !s2 && m === "GET") return json({ brands: await listProfiles(env) });
    if (s1 === "brands" && !s2 && m === "POST") {
      const d = await body(req);
      const name = str(d.name, 60);
      if (!name) throw new HttpError(400, "Give the brand a name.");
      return json({ brand: await createProfile(env, name) }, 201);
    }
    if (s1 === "brands" && s2 && s3 === "accounts" && m === "GET") return json({ accounts: await listAccounts(env, s2) });
    if (s1 === "brands" && s2 && s3 === "connect" && m === "POST") {
      const d = await body(req);
      const back = `https://${url.host}/social/connected?brand=${encodeURIComponent(s2)}`;
      const localBack = `${url.protocol}//${url.host}/social/connected?brand=${encodeURIComponent(s2)}`;
      return json({ url: await connectUrl(env, str(d.platform, 20), s2, url.protocol === "https:" ? back : localBack) });
    }
    if (s1 === "accounts" && s2 && !s3 && m === "DELETE") { await disconnect(env, s2); return json({ ok: true }); }
    if (s1 === "accounts" && s2 && s3 === "boards" && m === "GET") return json({ boards: await pinterestBoards(env, s2) });
    if (s1 === "accounts" && s2 && s3 === "tiktok" && m === "GET") return json({ info: await tiktokInfo(env, s2) });
    if (s1 === "media" && m === "POST") return json({ media: await uploadMedia(env, req) }, 201);

    if (s1 === "posts") {
      const view = (p: SocialPost) => ({ ...p, media: parseJson(p.media, []), targets: parseJson(p.targets, []), options: parseJson(p.options, {}), results: parseJson(p.results, []), problems: problems(p) });
      const get = async (pid: string) => {
        const p = await env.DB.prepare("SELECT * FROM social_posts WHERE id = ?").bind(pid).first<SocialPost>();
        if (!p) throw new HttpError(404, "That post doesn’t exist any more.");
        return p;
      };
      if (!s2 && m === "GET") {
        const brand = str(url.searchParams.get("brand"), 80);
        const { results } = await env.DB.prepare(`SELECT * FROM social_posts WHERE profile_id = ? ORDER BY
          CASE status WHEN 'failed' THEN 0 WHEN 'partial' THEN 0 WHEN 'publishing' THEN 1 WHEN 'scheduled' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END,
          CASE WHEN status IN ('scheduled','publishing') THEN scheduled_at END ASC, updated_at DESC LIMIT 200`).bind(brand).all<SocialPost>();
        return json({ posts: results.map(view) });
      }
      if (!s2 && m === "POST") {
        const d = await body(req);
        const brand = str(d.profile_id, 80);
        if (!brand) throw new HttpError(400, "Pick a brand first.");
        const pid = id("sp_");
        const targets = Array.isArray(d.targets) ? d.targets.slice(0, 10).map((x: any) => ({ platform: str(x.platform, 20), accountId: str(x.accountId, 80) })) : [];
        await env.DB.prepare("INSERT INTO social_posts (id, profile_id, content, targets, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(pid, brand, str(d.content, 5000), JSON.stringify(targets), t, t).run();
        return json({ post: view(await get(pid)) }, 201);
      }
      if (s2 && !s3 && m === "GET") {
        let p = await get(s2);
        if (p.zernio_id && ["publishing", "scheduled"].includes(p.status) && (p.scheduled_at || 0) <= t) { await syncSocial(env, p.id); p = await get(s2); }
        return json({ post: view(p) });
      }
      if (s2 && !s3 && m === "PATCH") {
        const p = await get(s2);
        if (!["draft", "failed"].includes(p.status) || p.zernio_id) {
          if (p.status !== "draft") throw new HttpError(409, p.status === "scheduled" ? "This post is scheduled. Unschedule it to make changes." : "This post has gone out, so it can’t be changed. Duplicate it instead.");
        }
        const d = await body(req);
        const content = d.content !== undefined ? String(d.content).slice(0, 70000) : p.content;
        const media = d.media !== undefined ? JSON.stringify((Array.isArray(d.media) ? d.media : []).slice(0, 35).map((x: any) => ({ url: str(x.url, 1000), type: str(x.type, 10), name: str(x.name, 120) })).filter((x: any) => /^https:\/\//.test(x.url))) : p.media;
        const targets = d.targets !== undefined ? JSON.stringify((Array.isArray(d.targets) ? d.targets : []).slice(0, 10).map((x: any) => ({ platform: str(x.platform, 20), accountId: str(x.accountId, 80) })).filter((x: any) => PLATFORMS[x.platform] && x.accountId)) : p.targets;
        const options = d.options !== undefined ? JSON.stringify(d.options || {}).slice(0, 5000) : p.options;
        await env.DB.prepare("UPDATE social_posts SET content = ?, media = ?, targets = ?, options = ?, updated_at = ? WHERE id = ?").bind(content, media, targets, options, t, p.id).run();
        return json({ post: view(await get(p.id)) });
      }
      if (s2 && !s3 && m === "DELETE") {
        const p = await get(s2);
        if (p.status === "scheduled") await unschedule(env, p);
        if (p.status === "publishing") throw new HttpError(409, "This post is going out right now. Try again in a minute.");
        await env.DB.prepare("DELETE FROM social_posts WHERE id = ?").bind(p.id).run();
        return json({ ok: true });
      }
      if (s2 && s3 === "publish" && m === "POST") {
        const d = await body(req);
        const at = d.at ? Number(d.at) : null;
        if (at !== null && !(at > t + 60_000)) throw new HttpError(400, "Pick a time at least a couple of minutes from now.");
        await publish(env, await get(s2), at);
        return json({ post: view(await get(s2)) });
      }
      if (s2 && s3 === "unschedule" && m === "POST") { await unschedule(env, await get(s2)); return json({ post: view(await get(s2)) }); }
      if (s2 && s3 === "duplicate" && m === "POST") {
        const p = await get(s2);
        const pid = id("sp_");
        await env.DB.prepare("INSERT INTO social_posts (id, profile_id, content, media, targets, options, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(pid, p.profile_id, p.content, p.media, p.targets, p.options, t, t).run();
        return json({ post: view(await get(pid)) }, 201);
      }
    }
  }

  /* ---------- settings ---------- */
  if (a === "settings") {
    const visible = async () => {
      const all = await getSettings(env);
      for (const k of PRIVATE_SETTINGS) delete all[k];
      return all;
    };
    if (b === "events" && m === "GET") {
      const { results } = await env.DB.prepare("SELECT type, email, detail, created_at FROM email_events WHERE type != 'email.delivered' ORDER BY created_at DESC LIMIT 12").all();
      return json({ ...(await webhookStatus(env)), endpoint: `https://go.${env.ROOT_DOMAIN}/hooks/resend`, recent: results });
    }
    if (b === "connect-resend" && m === "POST") {
      const r = await connectResendWebhook(env);
      if (!r.ok) return json({ error: r.error, needsManual: r.needsManual }, 409);
      return json({ ok: true });
    }
    if (b === "zernio-key" && m === "PUT") {
      const d = await body(req);
      const key = str(d.key, 200);
      if (!key) { await env.DB.prepare("DELETE FROM settings WHERE key = 'zernio_api_key'").run(); return json({ ok: true }); }
      if (!/^sk_[A-Za-z0-9]{20,}$/.test(key)) throw new HttpError(400, "That doesn’t look like a Zernio API key. It starts with sk_.");
      await testKey(env, key);
      await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('zernio_api_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key).run();
      return json({ ok: true });
    }
    if (b === "webhook-secret" && m === "PUT") {
      const d = await body(req);
      const secret = str(d.secret, 200);
      if (secret && !/^whsec_[A-Za-z0-9+/=]{16,}$/.test(secret)) throw new HttpError(400, "That doesn’t look like a signing secret. It starts with whsec_.");
      await env.DB.prepare(secret ? "INSERT INTO settings (key, value) VALUES ('resend_webhook_secret', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value" : "DELETE FROM settings WHERE key = 'resend_webhook_secret' AND ? = ''").bind(secret).run();
      return json({ ok: true });
    }
    if (!b && m === "GET") return json({ settings: await visible() });
    if (!b && m === "PUT") {
      const d = await body(req);
      const allowed = ["sender_name", "sender_email", "reply_to", "postal_address", "consent_text", "double_optin"];
      if (d.double_optin !== undefined) d.double_optin = d.double_optin === true || d.double_optin === "1" ? "1" : "0";
      if (d.sender_email !== undefined && !isEmail(str(d.sender_email))) throw new HttpError(400, "The sender address doesn’t look right.");
      if (d.sender_email !== undefined && !str(d.sender_email).toLowerCase().endsWith("@" + env.ROOT_DOMAIN)) throw new HttpError(400, `The sender address has to end in @${env.ROOT_DOMAIN}.`);
      if (d.reply_to && !isEmail(str(d.reply_to))) throw new HttpError(400, "The reply-to address doesn’t look right.");
      const stmts = allowed.filter((k) => d[k] !== undefined).map((k) =>
        env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, str(d[k], 500)));
      if (stmts.length) await env.DB.batch(stmts);
      return json({ settings: await visible() });
    }
  }

  throw new HttpError(404, "Unknown request.");
}

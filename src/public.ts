import { Env, HttpError, esc, getSettings, html, id, isEmail, json, now, token } from "./util";
import { Page, RenderOpts, Site, renderBlog, renderNotice, renderPage } from "./render";
import { processQueue } from "./email";

export async function serveStatic(req: Request, env: Env, path: string): Promise<Response> {
  const url = new URL(req.url);
  url.pathname = path;
  const res = await env.ASSETS.fetch(new Request(url.toString(), req));
  const out = new Response(res.body, res);
  out.headers.set("cache-control", path.startsWith("/fonts/") ? "public, max-age=31536000, immutable" : "public, max-age=300");
  if (path.startsWith("/fonts/")) out.headers.set("access-control-allow-origin", "*");
  return out;
}

export async function siteList(env: Env, site: Site): Promise<{ id: string; welcome_enabled: number }> {
  const l = await env.DB.prepare("SELECT id, welcome_enabled FROM lists WHERE site_id = ? ORDER BY created_at LIMIT 1")
    .bind(site.id).first<{ id: string; welcome_enabled: number }>();
  if (l) return l;
  const lid = id("l_");
  await env.DB.prepare("INSERT INTO lists (id, name, site_id, welcome_subject, welcome_body, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(lid, `${site.name} signups`, site.id, `Welcome to ${site.name}`, defaultWelcome(site.name), now()).run();
  return { id: lid, welcome_enabled: 0 };
}

export function defaultWelcome(name: string): string {
  return `Hi {{name}},\n\nThanks for signing up for **${name}**. You’ll be first to hear when there’s news.\n\nTalk soon,\nAisling`;
}

/** Add or re-subscribe a contact and put them on a list. Returns whether they were newly added to the list. */
export async function upsertContact(
  env: Env, email: string, name: string, source: string, consentText: string | null, listId: string | null,
): Promise<{ contactId: string; added: boolean; created: boolean }> {
  const t = now();
  let c = await env.DB.prepare("SELECT id, status, name FROM contacts WHERE email = ?").bind(email).first<{ id: string; status: string; name: string }>();
  let created = false;
  if (!c) {
    const cid = id("c_");
    await env.DB.prepare(`INSERT INTO contacts (id, email, name, status, source, consent_at, consent_text, token, created_at, updated_at)
      VALUES (?, ?, ?, 'subscribed', ?, ?, ?, ?, ?, ?)`)
      .bind(cid, email, name, source, consentText ? t : null, consentText || "", token(), t, t).run();
    c = { id: cid, status: "subscribed", name };
    created = true;
  } else {
    const sets: string[] = ["updated_at = ?"]; const vals: unknown[] = [t];
    if (name && !c.name) { sets.push("name = ?"); vals.push(name); }
    if (consentText && c.status !== "subscribed") { sets.push("status = 'subscribed'", "consent_at = ?", "consent_text = ?"); vals.push(t, consentText); }
    await env.DB.prepare(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, c.id).run();
  }
  let added = false;
  if (listId) {
    const r = await env.DB.prepare("INSERT OR IGNORE INTO list_members (list_id, contact_id, added_at) VALUES (?, ?, ?)")
      .bind(listId, c.id, t).run();
    added = (r.meta?.changes || 0) > 0;
  }
  return { contactId: c.id, added, created };
}

async function subscribe(req: Request, env: Env, ctx: ExecutionContext, host: string): Promise<Response> {
  const wantsJson = (req.headers.get("accept") || "").includes("application/json");
  const reply = (status: number, body: { message?: string; error?: string }, back?: string) => {
    if (wantsJson) return json(body, status);
    if (status < 300 && back) return Response.redirect(back, 303);
    return html(`<p>${esc(body.error || body.message || "")}</p><p><a href="/">Back</a></p>`, status);
  };
  let form: FormData;
  try { form = await req.formData(); } catch { return reply(400, { error: "That form didn’t come through properly. Refresh and try again." }); }
  if (String(form.get("website") || "").trim()) return reply(200, { message: "You’re on the list." }); // bot trap
  const email = String(form.get("email") || "").trim().toLowerCase();
  const name = String(form.get("name") || "").trim().slice(0, 80);
  const pageId = String(form.get("page") || "");
  if (!isEmail(email)) return reply(400, { error: "That email address doesn’t look right. Check it and try again." });
  if (form.get("consent") !== "yes") return reply(400, { error: "Tick the box to say you’re happy to get emails." });

  const page = await env.DB.prepare("SELECT * FROM pages WHERE id = ?").bind(pageId).first<Page>();
  if (!page) return reply(404, { error: "This form has been taken down." });
  const site = await env.DB.prepare("SELECT * FROM sites WHERE id = ?").bind(page.site_id).first<Site>();
  if (!site || `${site.subdomain}.${env.ROOT_DOMAIN}` !== host) return reply(400, { error: "This form belongs to a different site." });

  const settings = await getSettings(env);
  const list = await siteList(env, site);
  const r = await upsertContact(env, email, name, `${site.subdomain}/${page.slug || "home"}`, settings.consent_text, list.id);
  if (r.added && list.welcome_enabled) {
    await env.DB.prepare("INSERT INTO sends (id, list_id, kind, contact_id, email, created_at) VALUES (?, ?, 'welcome', ?, ?, ?)")
      .bind(id("s_"), list.id, r.contactId, email, now()).run();
    ctx.waitUntil(processQueue(env, 10));
  }
  const back = new URL(req.headers.get("referer") || `https://${host}/`);
  back.searchParams.set("joined", "1");
  return reply(200, { message: list.welcome_enabled ? "You’re on the list. Check your inbox." : "You’re on the list." }, back.toString());
}

/* ---------- go.<domain>: unsubscribe, open + click tracking ---------- */
const PIXEL = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));

async function handleGo(req: Request, env: Env, url: URL, o: RenderOpts): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "o" && parts[1]) {
    const sid = parts[1].replace(/\.gif$/, "");
    await env.DB.prepare("UPDATE sends SET opened_at = COALESCE(opened_at, ?) WHERE id = ?").bind(now(), sid).run();
    return new Response(PIXEL, { headers: { "content-type": "image/gif", "cache-control": "no-store" } });
  }
  if (parts[0] === "c" && parts[1]) {
    const target = url.searchParams.get("u") || "";
    if (!/^https?:\/\//i.test(target)) return new Response("Link not found", { status: 404 });
    const t = now();
    const r = await env.DB.prepare("UPDATE sends SET clicked_at = COALESCE(clicked_at, ?), opened_at = COALESCE(opened_at, ?) WHERE id = ?").bind(t, t, parts[1]).run();
    if (!r.meta?.changes) return new Response("Link not found", { status: 404 });
    return Response.redirect(target, 302);
  }
  if (parts[0] === "u" && parts[1]) {
    const c = await env.DB.prepare("SELECT id, email, status FROM contacts WHERE token = ?").bind(parts[1]).first<{ id: string; email: string; status: string }>();
    if (!c) return html(renderNotice(null, "Link expired", "This unsubscribe link isn’t valid any more. If you’re still getting emails, reply to one and ask to be removed.", o), 404);
    if (req.method === "POST") {
      const form = await req.formData().catch(() => null);
      const again = form?.get("action") === "resubscribe";
      await env.DB.prepare("UPDATE contacts SET status = ?, updated_at = ? WHERE id = ?").bind(again ? "subscribed" : "unsubscribed", now(), c.id).run();
      // one-click unsubscribe from mail clients posts "List-Unsubscribe=One-Click"
      if (form?.get("List-Unsubscribe") === "One-Click") return new Response("Unsubscribed", { status: 200 });
      return html(renderNotice(null, again ? "Welcome back" : "You’re unsubscribed",
        again ? `${esc(c.email)} will get emails again.` :
          `${esc(c.email)} won’t get any more emails from us.<form method="post" style="margin-top:14px"><input type="hidden" name="action" value="resubscribe"><button type="submit" style="font:inherit;background:none;border:1px solid currentColor;padding:8px 14px;cursor:pointer">That was a mistake, keep me on</button></form>`, o));
    }
    const done = c.status === "unsubscribed";
    return html(renderNotice(null, done ? "Already unsubscribed" : "Unsubscribe?",
      done ? `${esc(c.email)} isn’t on any of our lists.` :
        `Stop all emails to <b>${esc(c.email)}</b>?<form method="post" style="margin-top:14px"><button type="submit" style="font:inherit;font-weight:600;background:var(--text);color:var(--bg);border:0;padding:10px 18px;cursor:pointer">Unsubscribe</button></form>`, o));
  }
  return html(renderNotice(null, "Nothing here", "This address only handles email links.", o), 404);
}

export async function handlePublic(req: Request, env: Env, ctx: ExecutionContext, host: string, sub: string): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;
  if (p === "/__proof/site.css") return serveStatic(req, env, "/site.css");
  if (p.startsWith("/__proof/fonts/")) return serveStatic(req, env, p.replace("/__proof", ""));
  if (p === "/robots.txt") return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });

  const settings = await getSettings(env);
  const base: RenderOpts = { host, consentText: settings.consent_text, hasBlog: false };

  if (sub === "go") return handleGo(req, env, url, base);
  if (p === "/__proof/subscribe" && req.method === "POST") return subscribe(req, env, ctx, host);

  const site = await env.DB.prepare("SELECT * FROM sites WHERE subdomain = ?").bind(sub).first<Site>();
  if (!site) return html(renderNotice(null, "Not here yet", "There’s nothing at this address yet.", base, "404"), 404);
  if (site.status === "paused") return html(renderNotice(site, "Back soon", `${esc(site.name)} is taking a short break.`, base), 503);

  const posts = (await env.DB.prepare("SELECT * FROM pages WHERE site_id = ? AND template = 'post' AND published = 1 ORDER BY created_at DESC")
    .bind(site.id).all<Page>()).results;
  const o: RenderOpts = { ...base, hasBlog: posts.length > 0, joined: url.searchParams.get("joined") === "1" };

  if (p === "/blog" || p === "/blog/") {
    if (!posts.length) return html(renderNotice(site, "Not found", "There’s no page at this address.", o, "404"), 404);
    return html(renderBlog(site, posts, o), 200, { "cache-control": "public, max-age=60" });
  }
  const slug = decodeURIComponent(p.replace(/^\/+|\/+$/g, ""));
  const page = await env.DB.prepare("SELECT * FROM pages WHERE site_id = ? AND slug = ? AND published = 1").bind(site.id, slug).first<Page>();
  if (!page) {
    if (!slug) {
      return html(renderNotice(site, site.name, "This site is being built. Come back soon.", o), 200);
    }
    return html(renderNotice(site, "Not found", `There’s no page at this address. <a href="/">Go to ${esc(site.name)}</a>.`, o, "404"), 404);
  }
  if (req.method === "GET" && !/bot|crawl|spider|preview/i.test(req.headers.get("user-agent") || "")) {
    ctx.waitUntil(env.DB.prepare("UPDATE pages SET views = views + 1 WHERE id = ?").bind(page.id).run());
  }
  return html(renderPage(site, page, o), 200, { "cache-control": o.joined ? "no-store" : "public, max-age=30" });
}

export { HttpError };

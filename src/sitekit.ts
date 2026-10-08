import { Env, HttpError, esc, now } from "./util";

/*
 * What every page on a site shares: header links, logo and footer (stored as JSON in sites.nav), the custom
 * domains that serve the site, and redirects from old addresses.
 */

export interface NavLink { label: string; url: string; style?: "link" | "button" }
export interface SiteNav {
  logo?: string;                                   // an https image shown instead of the coloured square
  header: NavLink[];
  footer: { tagline?: string; columns: Array<{ heading: string; links: NavLink[] }>; social: NavLink[] };
}

const s = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const href = (u: unknown) => { const x = s(u, 1000); return /^(https:\/\/|http:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(x) ? x : ""; };
const links = (v: unknown, max: number, withStyle = false): NavLink[] =>
  (Array.isArray(v) ? v : []).slice(0, max).map((x: any) => {
    const l: NavLink = { label: s(x?.label, 40), url: href(x?.url) };
    if (withStyle) l.style = x?.style === "button" ? "button" : "link";
    return l;
  }).filter((l) => l.label && l.url);

export function cleanNav(v: any): SiteNav {
  const logo = s(v?.logo, 1000);
  const cols = (Array.isArray(v?.footer?.columns) ? v.footer.columns : []).slice(0, 4)
    .map((c: any) => ({ heading: s(c?.heading, 40), links: links(c?.links, 8) }))
    .filter((c: any) => c.heading || c.links.length);
  const nav: SiteNav = {
    header: links(v?.header, 6, true),
    footer: { columns: cols, social: links(v?.footer?.social, 6) },
  };
  if (/^https:\/\//i.test(logo)) nav.logo = logo;
  const tag = s(v?.footer?.tagline, 200);
  if (tag) nav.footer.tagline = tag;
  return nav;
}

export function parseNav(raw: string | null | undefined): SiteNav {
  try { return cleanNav(JSON.parse(raw || "{}")); } catch { return cleanNav({}); }
}

const ext = (url: string) => (/^https?:\/\//i.test(url) ? ` rel="noopener"` : "");

/** The site header: logo or name, then the site's own links (and the journal, when it has posts). */
export function renderHeader(o: { name: string; nav: SiteNav; hasBlog: boolean; current: string; path: string }): string {
  const mark = o.nav.logo
    ? `<a class="mark logo" href="/"><img src="${esc(o.nav.logo)}" alt="${esc(o.name)}"></a>`
    : `<a class="mark" href="/"><i aria-hidden="true"></i>${esc(o.name)}</a>`;
  let items: string[];
  if (o.nav.header.length) {
    items = o.nav.header.map((l) => {
      const here = l.url === o.path || (l.url === "/blog" && o.current === "blog");
      return `<a href="${esc(l.url)}"${ext(l.url)}${l.style === "button" ? ' class="navbtn"' : ""}${here ? ' aria-current="page"' : ""}>${esc(l.label)}</a>`;
    });
    if (o.hasBlog && !o.nav.header.some((l) => l.url === "/blog")) items.push(`<a href="/blog"${o.current === "blog" ? ' aria-current="page"' : ""}>Journal</a>`);
  } else {
    items = o.hasBlog ? [`<a href="/"${o.current === "home" ? ' aria-current="page"' : ""}>Home</a>`, `<a href="/blog"${o.current === "blog" ? ' aria-current="page"' : ""}>Journal</a>`] : [];
  }
  return `<header class="nav">${mark}${items.length ? `<nav aria-label="Site">${items.join("")}</nav>` : ""}</header>`;
}

/** The site footer: a simple line, or tagline, link columns and social links when the site has them. */
export function renderFooter(o: { name: string; nav: SiteNav; host: string }): string {
  const f = o.nav.footer;
  const year = new Date().getFullYear();
  if (!f.tagline && !f.columns.length && !f.social.length) {
    return `<footer><span>© ${year} ${esc(o.name)}</span><span>${esc(o.host)}</span></footer>`;
  }
  const cols = f.columns.map((c) => `<div class="sf-col">${c.heading ? `<h2>${esc(c.heading)}</h2>` : ""}<ul>${c.links.map((l) => `<li><a href="${esc(l.url)}"${ext(l.url)}>${esc(l.label)}</a></li>`).join("")}</ul></div>`).join("");
  const social = f.social.map((l) => `<a href="${esc(l.url)}"${ext(l.url)}>${esc(l.label)}</a>`).join("");
  return `<footer class="sitefoot"><div class="sf-top"><div class="sf-brand"><b>${esc(o.name)}</b>${f.tagline ? `<p>${esc(f.tagline)}</p>` : ""}</div>${cols ? `<nav class="sf-cols" aria-label="Footer">${cols}</nav>` : ""}</div>
<div class="sf-bot"><span>© ${year} ${esc(o.name)}</span>${social ? `<span class="sf-social">${social}</span>` : `<span>${esc(o.host)}</span>`}</div></footer>`;
}

/* ---------- domains ---------- */

export interface Domain { hostname: string; site_id: string; redirect_to: string | null; is_primary: number; created_at: number }

/** Lower-case, no scheme, path or port. Throws a plain-words error for anything that isn't a hostname. */
export function cleanHost(env: Env, raw: unknown): string {
  let h = String(raw ?? "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/\.$/, "");
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/.test(h)) throw new HttpError(400, "That doesn’t look like a domain. Try something like ciunas.app.");
  const root = env.ROOT_DOMAIN.toLowerCase();
  if (h === root || h.endsWith("." + root)) throw new HttpError(400, `Addresses on ${root} are set on the site itself, not here.`);
  return h;
}

export async function siteDomains(env: Env, siteId: string): Promise<Domain[]> {
  return (await env.DB.prepare("SELECT * FROM domains WHERE site_id = ? ORDER BY redirect_to IS NOT NULL, hostname").bind(siteId).all<Domain>()).results;
}

export async function domainFor(env: Env, host: string): Promise<Domain | null> {
  return env.DB.prepare("SELECT * FROM domains WHERE hostname = ?").bind(host.toLowerCase()).first<Domain>();
}

export async function primaryHost(env: Env, siteId: string): Promise<string | null> {
  const r = await env.DB.prepare("SELECT hostname FROM domains WHERE site_id = ? AND is_primary = 1 AND redirect_to IS NULL").bind(siteId).first<{ hostname: string }>();
  return r?.hostname || null;
}

/** Add a domain to a site. A bare domain also gets its www. form, which redirects to it (and the other way round). */
export async function addDomain(env: Env, siteId: string, raw: unknown): Promise<Domain[]> {
  const host = cleanHost(env, raw);
  const taken = await domainFor(env, host);
  if (taken) throw new HttpError(409, taken.site_id === siteId ? "This site already has that domain." : "Another site already uses that domain.");
  const t = now();
  const stmts = [env.DB.prepare("INSERT INTO domains (hostname, site_id, created_at) VALUES (?, ?, ?)").bind(host, siteId, t)];
  const twin = host.startsWith("www.") ? host.slice(4) : host.split(".").length === 2 ? "www." + host : "";
  if (twin && !(await domainFor(env, twin))) stmts.push(env.DB.prepare("INSERT INTO domains (hostname, site_id, redirect_to, created_at) VALUES (?, ?, ?, ?)").bind(twin, siteId, host, t));
  await env.DB.batch(stmts);
  return siteDomains(env, siteId);
}

export async function setPrimary(env: Env, host: string, on: boolean): Promise<Domain[]> {
  const d = await domainFor(env, host);
  if (!d) throw new HttpError(404, "That domain isn’t connected any more.");
  if (d.redirect_to) throw new HttpError(400, `${host} sends visitors to ${d.redirect_to}, so it can’t be the main address.`);
  await env.DB.batch([
    env.DB.prepare("UPDATE domains SET is_primary = 0 WHERE site_id = ?").bind(d.site_id),
    ...(on ? [env.DB.prepare("UPDATE domains SET is_primary = 1 WHERE hostname = ?").bind(host)] : []),
  ]);
  return siteDomains(env, d.site_id);
}

export async function removeDomain(env: Env, host: string): Promise<Domain[]> {
  const d = await domainFor(env, host);
  if (!d) throw new HttpError(404, "That domain isn’t connected any more.");
  // Its www. twin (or anything else redirecting to it) goes too.
  await env.DB.batch([env.DB.prepare("DELETE FROM domains WHERE hostname = ? OR redirect_to = ?").bind(host, host)]);
  return siteDomains(env, d.site_id);
}

/* ---------- redirects ---------- */

export interface Redirect { from_path: string; to_url: string }

export const cleanPath = (p: unknown) => {
  let x = String(p ?? "").trim();
  try { x = new URL(x, "https://x").pathname; } catch { return ""; }
  x = ("/" + x.replace(/^\/+/, "")).replace(/\/+$/, "") || "/";
  return x.slice(0, 300);
};

export async function getRedirects(env: Env, siteId: string): Promise<Redirect[]> {
  return (await env.DB.prepare("SELECT from_path, to_url FROM redirects WHERE site_id = ? ORDER BY from_path").bind(siteId).all<Redirect>()).results;
}

export async function setRedirects(env: Env, siteId: string, list: unknown): Promise<Redirect[]> {
  const seen = new Set<string>();
  const rows = (Array.isArray(list) ? list : []).slice(0, 200).map((r: any) => ({ from_path: cleanPath(r?.from_path), to_url: href(r?.to_url) }))
    .filter((r) => r.from_path !== "/" && r.from_path && r.to_url && r.to_url !== r.from_path && !seen.has(r.from_path) && (seen.add(r.from_path), true));
  const t = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM redirects WHERE site_id = ?").bind(siteId),
    ...rows.map((r) => env.DB.prepare("INSERT INTO redirects (site_id, from_path, to_url, created_at) VALUES (?, ?, ?, ?)").bind(siteId, r.from_path, r.to_url, t)),
  ]);
  return getRedirects(env, siteId);
}

export async function findRedirect(env: Env, siteId: string, path: string): Promise<string | null> {
  const r = await env.DB.prepare("SELECT to_url FROM redirects WHERE site_id = ? AND from_path = ?").bind(siteId, cleanPath(path)).first<{ to_url: string }>();
  return r?.to_url || null;
}

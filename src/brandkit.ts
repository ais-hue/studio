import { Env, HttpError, esc, id, now } from "./util";

/*
 * A brand's design tokens. Stored flat, so a child brand (an app under Ciúnas) keeps only the keys it overrides
 * and inherits the rest from its parent. A site with no brand renders in Studio's house style (admin/site.css);
 * a brand only emits the values it sets, as CSS custom properties that site.css reads.
 */

export type Kit = Record<string, string | number>;

const HEX = /^#[0-9a-f]{6}$/i;
const COLORS = ["bg", "surface", "text", "muted", "accent", "on_accent", "accent2",
  "dark_bg", "dark_surface", "dark_text", "dark_muted", "dark_accent", "dark_on_accent", "glow1", "glow2", "glow3"] as const;
const FONTS = ["font_display", "font_body", "font_label"] as const;
const ENUMS: Record<string, readonly string[]> = {
  mode: ["auto", "light", "dark"],
  display_case: ["none", "upper"],
  emphasis: ["italic", "accent", "both", "none"],
  label_case: ["upper", "none"],
  buttons: ["square", "rounded", "pill"],
  button_color: ["ink", "accent"],
  cards: ["line", "shadow", "flat"],
  rules: ["bold", "hairline", "none"],
  eyebrow: ["plain", "pill", "dash"],
  background: ["plain", "aurora", "texture"],
  logo_mark: ["square", "dot", "none"],
  nav_style: ["label", "plain"],
};
const NUMS: Record<string, [number, number]> = {
  display_weight: [300, 900], display_tracking: [-6, 20], label_tracking: [0, 30], radius: [0, 32],
};
const URLS = ["texture", "logo_image", "icon", "app_store"] as const;
const TEXTS: Record<string, number> = { logo_text: 40, one_liner: 200 };

/** The keys an app page borrows from its own brand when it sits on the parent's site. */
export const ACCENT_KEYS = ["accent", "on_accent", "accent2", "dark_accent", "dark_on_accent"];

export const fontOk = (f: unknown) => typeof f === "string" && /^[A-Za-z0-9 ]{2,40}$/.test(f.trim());

/** Validate a kit. Unknown keys, bad values and empty strings are dropped (empty means "inherit"). */
export function cleanKit(v: any): Kit {
  const k: Kit = {};
  if (!v || typeof v !== "object") return k;
  for (const c of COLORS) if (typeof v[c] === "string" && HEX.test(v[c])) k[c] = v[c].toLowerCase();
  for (const f of FONTS) if (fontOk(v[f])) k[f] = String(v[f]).trim().replace(/\s+/g, " ");
  for (const [e, opts] of Object.entries(ENUMS)) if (opts.includes(v[e])) k[e] = v[e];
  for (const [n, [lo, hi]] of Object.entries(NUMS)) {
    const x = Number(v[n]);
    if (v[n] !== "" && v[n] != null && Number.isFinite(x)) k[n] = Math.round(Math.min(hi, Math.max(lo, x)));
  }
  for (const u of URLS) if (typeof v[u] === "string" && /^https:\/\/\S{4,1000}$/.test(v[u].trim())) k[u] = v[u].trim();
  for (const [t, max] of Object.entries(TEXTS)) if (typeof v[t] === "string" && v[t].trim()) k[t] = v[t].trim().slice(0, max);
  if (k.display_weight) k.display_weight = Math.round(Number(k.display_weight) / 100) * 100;
  return k;
}

export function parseKit(raw: string | null | undefined): Kit {
  try { return cleanKit(JSON.parse(raw || "{}")); } catch { return {}; }
}

/* ---------- brands ---------- */

export interface Brand { id: string; parent_id: string | null; name: string; kit: string; created_at: number; updated_at: number }

export async function getBrand(env: Env, bid: string): Promise<Brand> {
  const b = await env.DB.prepare("SELECT * FROM brands WHERE id = ?").bind(bid).first<Brand>();
  if (!b) throw new HttpError(404, "That brand doesn’t exist any more.");
  return b;
}

/** The brand's kit with everything it inherits filled in (parent first, then the brand's own values). */
export async function effectiveKit(env: Env, bid: string | null | undefined): Promise<Kit> {
  if (!bid) return {};
  const chain: Kit[] = [];
  let cur: string | null | undefined = bid;
  for (let i = 0; cur && i < 4; i++) {
    const b: Brand | null = await env.DB.prepare("SELECT * FROM brands WHERE id = ?").bind(cur).first<Brand>();
    if (!b) break;
    chain.unshift(parseKit(b.kit));
    cur = b.parent_id;
  }
  return Object.assign({}, ...chain);
}

/** A page on a parent brand's site can wear one of its child brands' accents (an app page on ciunas.app). */
export async function pageKit(env: Env, siteKit: Kit, appBrand: string | null | undefined): Promise<Kit> {
  if (!appBrand) return siteKit;
  const app = await effectiveKit(env, appBrand);
  const out = { ...siteKit };
  for (const k of ACCENT_KEYS) if (app[k] !== undefined) out[k] = app[k];
  if (app.icon) out.app_icon = app.icon;
  return out;
}

export async function createBrand(env: Env, d: any): Promise<Brand> {
  const name = String(d?.name ?? "").trim().slice(0, 60);
  if (!name) throw new HttpError(400, "Give the brand a name.");
  const parent = d?.parent_id ? (await getBrand(env, String(d.parent_id))).id : null;
  const bid = id("br_"), t = now();
  await env.DB.prepare("INSERT INTO brands (id, parent_id, name, kit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(bid, parent, name, JSON.stringify(cleanKit(d?.kit)), t, t).run();
  return getBrand(env, bid);
}

export async function updateBrand(env: Env, bid: string, d: any): Promise<Brand> {
  const b = await getBrand(env, bid);
  const name = d.name !== undefined ? String(d.name).trim().slice(0, 60) || b.name : b.name;
  let parent = b.parent_id;
  if (d.parent_id !== undefined) {
    parent = d.parent_id ? (await getBrand(env, String(d.parent_id))).id : null;
    // No loops: a brand can't sit under itself or under one of its own children.
    for (let cur = parent, i = 0; cur && i < 6; i++) {
      if (cur === bid) throw new HttpError(400, "A brand can’t sit under itself or one of its own apps.");
      cur = (await env.DB.prepare("SELECT parent_id FROM brands WHERE id = ?").bind(cur).first<{ parent_id: string | null }>())?.parent_id || null;
    }
  }
  const kit = d.kit !== undefined ? JSON.stringify(cleanKit(d.kit)) : b.kit;
  await env.DB.prepare("UPDATE brands SET name = ?, parent_id = ?, kit = ?, updated_at = ? WHERE id = ?").bind(name, parent, kit, now(), bid).run();
  return getBrand(env, bid);
}

/* ---------- rendering ---------- */

/** The CSS for a site's page: the site's brand, with an app brand's accents when the page asks for one. */
export async function styleFor(env: Env, site: { brand_id?: string | null; theme: string }, appBrand?: string | null): Promise<BrandStyle | undefined> {
  if (!site.brand_id && !appBrand) return undefined;
  const kit = await pageKit(env, await effectiveKit(env, site.brand_id), appBrand);
  return Object.keys(kit).length ? brandStyle(kit, site.theme) : undefined;
}

export interface BrandStyle { css: string; attrs: string; fonts: string; theme?: string; logo: { image?: string; text?: string; mark?: string } }

const fam = (f: string, fallback: string) => `"${f}",${fallback}`;
const SERIFISH = /serif|garamond|baskerville|lora|fraunces|playfair|cormorant|newsreader|caslon|bodoni|merriweather|crimson|spectral|instrument/i;

/** CSS custom properties and <html> attributes for a kit. Empty kit → nothing, so the house style shows. */
export function brandStyle(k: Kit, siteTheme: string): BrandStyle {
  const v: string[] = [];
  const set = (name: string, val: unknown) => { if (val !== undefined && val !== "") v.push(`${name}:${val}`); };
  set("--bg", k.bg); set("--text", k.text); set("--muted", k.muted);
  if (k.bg || k.text) {
    v.push("--line:color-mix(in srgb,var(--text) 15%,transparent)", "--faint:color-mix(in srgb,var(--muted) 70%,var(--bg))");
  }
  set("--surface", k.surface); if (k.surface) set("--field", k.surface);
  set("--pc-light", k.accent); set("--on-pc", k.on_accent); set("--pc2", k.accent2);
  const ser = (f: unknown) => (SERIFISH.test(String(f)) ? "Georgia,serif" : "system-ui,-apple-system,'Segoe UI',sans-serif");
  if (k.font_display) v.push(`--f-display:${fam(String(k.font_display), ser(k.font_display))}`, "--d-stretch:100%", "--d-stretch2:100%");
  if (k.font_body) v.push(`--f-body:${fam(String(k.font_body), ser(k.font_body))}`);
  if (k.font_label) v.push(`--f-label:${fam(String(k.font_label), "ui-monospace,Menlo,monospace")}`);
  set("--d-weight", k.display_weight);
  if (k.display_case === "none") v.push("--d-case:none", "--d-lh:1.06", "--h2-size:clamp(28px,4vw,44px)");
  if (k.nav_style === "plain") v.push("--nav-font:var(--f-body)", "--nav-case:none", "--nav-track:0em", "--nav-size:15px");
  if (k.display_tracking !== undefined) v.push(`--d-track:${Number(k.display_tracking) / 100}em`);
  if (k.emphasis) v.push(`--em-style:${k.emphasis === "italic" || k.emphasis === "both" ? "italic" : "normal"}`, `--em-color:${k.emphasis === "accent" || k.emphasis === "both" ? "var(--pc)" : "inherit"}`);
  if (k.label_case) v.push(`--l-case:${k.label_case === "upper" ? "uppercase" : "none"}`);
  if (k.label_tracking !== undefined) v.push(`--l-track:${Number(k.label_tracking) / 100}em`);
  if (k.radius !== undefined) v.push(`--radius:${k.radius}px`);
  if (k.buttons) v.push(`--btn-radius:${k.buttons === "pill" ? "999px" : k.buttons === "rounded" ? "10px" : "0px"}`);
  if (k.button_color === "accent") v.push("--btn-bg:var(--pc)", "--btn-fg:var(--on-pc)");
  if (k.cards === "shadow") v.push("--card-border:1px solid transparent", "--card-shadow:0 1px 2px rgba(20,20,20,.04),0 10px 28px rgba(20,20,20,.07)", "--card-bg:var(--surface)");
  if (k.cards === "flat") v.push("--card-border:1px solid transparent", "--card-shadow:none", "--card-bg:var(--soft)");
  if (k.rules === "hairline") v.push("--rule-w:1px", "--rule:var(--line)");
  if (k.rules === "none") v.push("--rule-w:0px", "--rule:var(--line)");

  // Light-only kits (custom colours, no dark set) stay light, so the brand's colours always show.
  const theme = k.mode ? String(k.mode) : (k.bg && !k.dark_bg ? "light" : siteTheme);
  const d: string[] = [];
  const dset = (name: string, val: unknown) => { if (val !== undefined) d.push(`${name}:${val}`); };
  dset("--bg", k.dark_bg); dset("--text", k.dark_text); dset("--muted", k.dark_muted); dset("--surface", k.dark_surface);
  if (k.dark_surface) dset("--field", k.dark_surface);
  dset("--pc-dark", k.dark_accent); dset("--on-pc", k.dark_on_accent);

  let bgcss = "";
  if (k.background === "aurora") {
    const g1 = k.glow1 || "color-mix(in srgb,var(--pc) 30%,transparent)", g2 = k.glow2 || "color-mix(in srgb,var(--pc2,var(--pc)) 22%,transparent)", g3 = k.glow3 || "color-mix(in srgb,var(--pc) 12%,transparent)";
    bgcss = `body{background:radial-gradient(42% 38% at 8% 4%,${g1},transparent 72%),radial-gradient(36% 34% at 96% 14%,${g2},transparent 72%),radial-gradient(40% 30% at 55% 62%,${g3},transparent 75%),var(--bg);background-repeat:no-repeat;background-size:100% 1400px,100% 1400px,100% 1400px,auto}`;
  } else if (k.background === "texture" && k.texture) {
    bgcss = `body{background:var(--bg) url("${esc(String(k.texture))}") center top/640px auto repeat}`;
  }

  const css = [
    v.length ? `:root{${v.join(";")}}` : "",
    d.length ? `@media (prefers-color-scheme: dark){:root[data-theme="auto"]{${d.join(";")}}}:root[data-theme="dark"]{${d.join(";")}}` : "",
    bgcss,
  ].join("");
  const attrs = [k.eyebrow ? ` data-eyebrow="${k.eyebrow}"` : "", k.logo_mark ? ` data-mark="${k.logo_mark}"` : ""].join("");
  const fams = [...new Set(FONTS.map((f) => k[f]).filter(Boolean) as string[])].sort();
  return {
    css, attrs, theme,
    fonts: fams.length ? `/__proof/gf.css?f=${encodeURIComponent(fams.join("|"))}` : "",
    logo: { image: k.logo_image as string | undefined, text: k.logo_text as string | undefined, mark: k.logo_mark as string | undefined },
  };
}

/* ---------- Google Fonts, served from the site's own address ---------- */
// Visitors' browsers never contact Google: Studio fetches the CSS and font files and caches them at the edge.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function familyCss(f: string): Promise<string> {
  const name = f.replace(/ /g, "+");
  const tries = [
    `${name}:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400;1,500`,
    `${name}:wght@300;400;500;600;700`,
    `${name}:wght@400;700`,
    name,
  ];
  for (const t of tries) {
    const r = await fetch(`https://fonts.googleapis.com/css2?family=${t}&display=swap`, { headers: { "user-agent": UA } });
    if (r.ok) return (await r.text()).replace(/https:\/\/fonts\.gstatic\.com\//g, "/__proof/gf/");
  }
  return "";
}

export async function serveFonts(req: Request, url: URL, ctx: ExecutionContext): Promise<Response | null> {
  const p = url.pathname;
  if (p !== "/__proof/gf.css" && !p.startsWith("/__proof/gf/")) return null;
  const cache = (caches as any).default as Cache;
  const key = new Request(`https://fonts.studio.internal${p}${url.search}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  let res: Response;
  if (p === "/__proof/gf.css") {
    const fams = (url.searchParams.get("f") || "").split("|").filter(fontOk).slice(0, 4);
    if (!fams.length) return new Response("", { status: 400 });
    const css = (await Promise.all(fams.map(familyCss))).join("\n");
    res = new Response(css, { headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=86400" } });
  } else {
    const path = p.slice("/__proof/gf/".length);
    if (!/^[a-z0-9/._-]+\.woff2?$/i.test(path)) return new Response("", { status: 404 });
    const r = await fetch(`https://fonts.gstatic.com/${path}`);
    if (!r.ok) return new Response("", { status: r.status });
    res = new Response(r.body, { headers: { "content-type": "font/woff2", "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*" } });
  }
  if (res.ok) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

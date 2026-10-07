import { Env, esc, markdown } from "./util";
import { makeLink } from "./links";
import type { Content, Page } from "./render";

/*
 * Block pages. A page with template "blocks" stores { blocks: Block[], description?, share_image? } in its
 * content column. Each block has a type, a few shared options (background, spacing, hidden) and its own fields.
 * cleanBlocks() is the only way content gets in, so the renderer can trust what it reads.
 * Pages on the old templates (waitlist, launch, links, post) keep rendering as before; fromTemplate() turns one
 * into blocks when it is opened in the block editor.
 */

export const BLOCK_TYPES = ["hero", "text", "image", "gallery", "store", "features", "quote", "faq", "signup", "links", "video", "divider"] as const;
export type BlockType = typeof BLOCK_TYPES[number];

export interface Img { url: string; alt: string }
export interface Block {
  id: string; type: BlockType; hidden?: boolean; bg?: "page" | "soft" | "accent"; space?: "tight" | "normal" | "airy";
  // hero
  eyebrow?: string; headline?: string; sub?: string; align?: "left" | "center";
  buttons?: Array<{ label: string; url: string; style: "primary" | "plain" }>;
  image?: Img & { frame?: "none" | "phone" };
  // text, quote, faq answers
  md?: string; text?: string; who?: string;
  // image, gallery, video
  url?: string; alt?: string; caption?: string; width?: "column" | "full"; frame?: "none" | "phone"; items?: any[];
  poster?: string;
  // store
  heading?: string; apple?: string; google?: string; apple_code?: string; google_code?: string; note?: string;
  // signup
  cta?: string; form_id?: string;
  // divider
  style?: "space" | "rule";
}
export interface BlocksContent { blocks: Block[]; description?: string; share_image?: string; form_id?: string }

const s = (v: unknown, max: number) => String(v ?? "").replace(/\r\n?/g, "\n").slice(0, max).trim();
const pick = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);
/** Links people can follow: web, mail, phone, or a path on the same site. */
export const safeHref = (u: unknown) => { const x = s(u, 1000); return /^(https:\/\/|http:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(x) ? x : ""; };
/** Media must be https so it never breaks the page's security. */
const safeMedia = (u: unknown) => { const x = s(u, 1000); return /^https:\/\//i.test(x) ? x : ""; };
const bid = (v: unknown) => { const x = String(v ?? "").replace(/[^a-z0-9_-]/gi, "").slice(0, 24); return x || "b" + Math.random().toString(36).slice(2, 10); };

/** Validate and trim whatever the editor (or Claude) sends. Unknown fields and types are dropped. */
export function cleanBlocks(input: any): BlocksContent {
  const raw: any[] = Array.isArray(input?.blocks) ? input.blocks.slice(0, 60) : [];
  const seen = new Set<string>();
  const blocks: Block[] = [];
  for (const r of raw) {
    const type = r?.type as BlockType;
    if (!BLOCK_TYPES.includes(type)) continue;
    let id = bid(r.id);
    while (seen.has(id)) id = bid("");
    seen.add(id);
    const b: Block = { id, type, bg: pick(r.bg, ["page", "soft", "accent"] as const, "page"), space: pick(r.space, ["tight", "normal", "airy"] as const, "normal") };
    if (r.hidden) b.hidden = true;
    switch (type) {
      case "hero":
        b.eyebrow = s(r.eyebrow, 80); b.headline = s(r.headline, 160); b.sub = s(r.sub, 400);
        b.align = pick(r.align, ["left", "center"] as const, "left");
        b.buttons = (Array.isArray(r.buttons) ? r.buttons : []).slice(0, 2)
          .map((x: any) => ({ label: s(x?.label, 40), url: safeHref(x?.url), style: pick(x?.style, ["primary", "plain"] as const, "primary") }))
          .filter((x: any) => x.label && x.url);
        if (safeMedia(r.image?.url)) b.image = { url: safeMedia(r.image.url), alt: s(r.image.alt, 200), frame: pick(r.image.frame, ["none", "phone"] as const, "none") };
        break;
      case "text": b.md = s(r.md, 20000); break;
      case "image": b.url = safeMedia(r.url); b.alt = s(r.alt, 200); b.caption = s(r.caption, 200); b.width = pick(r.width, ["column", "full"] as const, "column"); break;
      case "gallery":
        b.items = (Array.isArray(r.items) ? r.items : []).slice(0, 10).map((x: any) => ({ url: safeMedia(x?.url), alt: s(x?.alt, 200) })).filter((x: Img) => x.url);
        b.frame = pick(r.frame, ["none", "phone"] as const, "phone"); b.caption = s(r.caption, 200); break;
      case "store":
        b.heading = s(r.heading, 120); b.note = s(r.note, 200);
        b.apple = /^https:\/\/(apps|itunes)\.apple\.com\//i.test(s(r.apple, 500)) ? s(r.apple, 500) : "";
        b.google = /^https:\/\/play\.google\.com\//i.test(s(r.google, 500)) ? s(r.google, 500) : "";
        if (r.apple_code && b.apple) b.apple_code = s(r.apple_code, 12).replace(/[^a-z0-9]/g, "");
        if (r.google_code && b.google) b.google_code = s(r.google_code, 12).replace(/[^a-z0-9]/g, "");
        break;
      case "features":
        b.heading = s(r.heading, 120);
        b.items = (Array.isArray(r.items) ? r.items : []).slice(0, 6).map((x: any) => ({ title: s(x?.title, 80), text: s(x?.text, 300) })).filter((x: any) => x.title || x.text);
        break;
      case "quote": b.text = s(r.text, 600); b.who = s(r.who, 120); break;
      case "faq":
        b.heading = s(r.heading, 120);
        b.items = (Array.isArray(r.items) ? r.items : []).slice(0, 30).map((x: any) => ({ q: s(x?.q, 200), a: s(x?.a, 3000) })).filter((x: any) => x.q && x.a);
        break;
      case "signup": b.heading = s(r.heading, 120); b.text = s(r.text, 400); b.cta = s(r.cta, 40); b.form_id = s(r.form_id, 40).replace(/[^a-z0-9_]/gi, ""); break;
      case "links":
        b.heading = s(r.heading, 120);
        b.items = (Array.isArray(r.items) ? r.items : []).slice(0, 30).map((x: any) => ({ label: s(x?.label, 80), url: safeHref(x?.url) })).filter((x: any) => x.label && x.url);
        break;
      case "video": {
        const u = s(r.url, 1000);
        b.url = youtubeId(u) ? u : safeMedia(u); b.poster = safeMedia(r.poster); b.caption = s(r.caption, 200); break;
      }
      case "divider": b.style = pick(r.style, ["space", "rule"] as const, "rule"); break;
    }
    blocks.push(b);
  }
  const out: BlocksContent = { blocks };
  const desc = s(input?.description, 300); if (desc) out.description = desc;
  const share = safeMedia(input?.share_image); if (share) out.share_image = share;
  // The page's sign-up form comes from its first signup block, so public.ts can load it as before.
  const fid = blocks.find((b) => b.type === "signup" && b.form_id && !b.hidden)?.form_id;
  if (fid) out.form_id = fid;
  return out;
}

export function parseBlocks(page: Page): BlocksContent {
  try { return cleanBlocks(JSON.parse(page.content || "{}")); } catch { return { blocks: [] }; }
}

/** The blocks an old-template page becomes. Nothing is lost: every field it showed has a home. */
export function fromTemplate(template: string, c: Content & { form_id?: string }, title: string): BlocksContent {
  const blocks: any[] = [];
  const lines = (x?: string) => String(x || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const signup = c.form === false ? null : { type: "signup", cta: c.cta || "", form_id: c.form_id || "" };
  if (template === "links") {
    blocks.push({ type: "hero", headline: c.headline || title, sub: c.sub || "", align: "center" });
    const items = lines(c.links).map((l) => { const [label, url] = l.split("|").map((x) => (x || "").trim()); return { label, url }; });
    if (items.length) blocks.push({ type: "links", items });
    if (c.body) blocks.push({ type: "text", md: c.body });
    if (signup) blocks.push(signup);
  } else if (template === "post") {
    blocks.push({ type: "hero", headline: c.headline || title, sub: c.sub || "" });
    if (c.body) blocks.push({ type: "text", md: c.body });
    if (signup) blocks.push({ ...signup, heading: c.eyebrow || "Get the next one" });
  } else {
    blocks.push({ type: "hero", eyebrow: c.eyebrow || (template === "launch" ? "Now launching" : "Early access"), headline: c.headline || title, sub: c.sub || "" });
    if (signup) blocks.push(signup);
    const pts = lines(c.points).slice(0, 6);
    if (template === "launch" && pts.length) blocks.push({ type: "features", items: pts.map((p) => ({ title: p, text: "" })) });
    if (c.body) blocks.push({ type: "text", md: c.body });
  }
  return cleanBlocks({ blocks, description: c.description || "" });
}

/* ---------- rendering ---------- */

export interface BlockRender {
  root: string;                         // ROOT_DOMAIN, for tracked links and resized images
  signup: (b: Block) => string;         // the page's existing signup form, so double opt-in and credit keep working
  firstHeading: boolean;                // true when this page has no hero, so the title needs an h1 of its own
  title: string;
}

export function youtubeId(u: string): string {
  const m = u.match(/^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : "";
}

/** Studio's own images are resized on the fly; anything else is used as is. */
function img(r: BlockRender, url: string, alt: string, sizes: string, cls = "", eager = false): string {
  const own = `https://files.${r.root}/`;
  const attrs = `alt="${esc(alt)}"${cls ? ` class="${cls}"` : ""} ${eager ? `fetchpriority="high"` : `loading="lazy"`} decoding="async"`;
  if (!url.startsWith(own)) return `<img src="${esc(url)}" ${attrs}>`;
  const path = url.slice(own.length);
  const at = (w: number) => `${own}cdn-cgi/image/width=${w},quality=82,format=auto/${path}`;
  return `<img src="${esc(at(1200))}" srcset="${[480, 800, 1200, 1800].map((w) => `${esc(at(w))} ${w}w`).join(", ")}" sizes="${sizes}" ${attrs}>`;
}

const track = (r: BlockRender, url: string, code?: string) => (code ? `https://go.${r.root}/l/${code}` : url);
const ext = (url: string) => (/^https?:\/\//i.test(url) ? ` rel="noopener"` : "");

function block(b: Block, r: BlockRender, first: { hero: boolean }): string {
  switch (b.type) {
    case "hero": {
      const tag = first.hero ? "h1" : "h2";
      first.hero = false;
      const btns = (b.buttons || []).map((x) => `<a class="bk-btn${x.style === "plain" ? " plain" : ""}" href="${esc(x.url)}"${ext(x.url)}>${esc(x.label)}</a>`).join("");
      const media = b.image ? `<div class="bk-hero-media${b.image.frame === "phone" ? " phone" : ""}">${img(r, b.image.url, b.image.alt, "(min-width: 900px) 40vw, 90vw", "", tag === "h1")}</div>` : "";
      return `<div class="bk-hero${b.align === "center" ? " center" : ""}${media ? " has-media" : ""}"><div class="bk-hero-text">${b.eyebrow ? `<div class="eyebrow">${esc(b.eyebrow)}</div>` : ""}
<${tag} class="bk-h">${esc(b.headline || r.title)}</${tag}>${b.sub ? `<p class="sub">${esc(b.sub)}</p>` : ""}${btns ? `<div class="bk-btns">${btns}</div>` : ""}</div>${media}</div>`;
    }
    case "text": return b.md ? `<div class="prose">${markdown(b.md)}</div>` : "";
    case "image":
      if (!b.url) return "";
      return `<figure class="bk-image${b.width === "full" ? " full" : ""}">${img(r, b.url, b.alt || "", b.width === "full" ? "100vw" : "(min-width: 1080px) 1000px, 92vw")}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`;
    case "gallery": {
      const items = (b.items || []) as Img[];
      if (!items.length) return "";
      return `<figure class="bk-gallery${b.frame === "phone" ? " phone" : ""}"><div class="bk-strip">${items.map((x) => `<div class="bk-shot">${img(r, x.url, x.alt, "(min-width: 900px) 260px, 60vw")}</div>`).join("")}</div>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`;
    }
    case "store": {
      const btn = (href: string, code: string | undefined, small: string, big: string, platform: string) =>
        `<a class="bk-store" href="${esc(track(r, href, code))}" rel="noopener" data-platform="${platform}"><small>${small}</small><b>${big}</b></a>`;
      const btns = (b.apple ? btn(b.apple, b.apple_code, "Download on the", "App Store", "ios") : "") + (b.google ? btn(b.google, b.google_code, "Get it on", "Google Play", "android") : "");
      if (!btns) return "";
      return `<div class="bk-storewrap">${b.heading ? `<h2 class="bk-h2">${esc(b.heading)}</h2>` : ""}<div class="bk-stores">${btns}</div>${b.note ? `<p class="bk-note">${esc(b.note)}</p>` : ""}</div>`;
    }
    case "features": {
      const items = (b.items || []) as Array<{ title: string; text: string }>;
      if (!items.length) return "";
      return `${b.heading ? `<h2 class="bk-h2">${esc(b.heading)}</h2>` : ""}<ul class="points bk-features">${items.map((x) => `<li>${x.title ? `<b>${esc(x.title)}</b>` : ""}${x.text ? `<span>${esc(x.text)}</span>` : ""}</li>`).join("")}</ul>`;
    }
    case "quote":
      return b.text ? `<figure class="bk-quote"><blockquote>${esc(b.text)}</blockquote>${b.who ? `<figcaption>${esc(b.who)}</figcaption>` : ""}</figure>` : "";
    case "faq": {
      const items = (b.items || []) as Array<{ q: string; a: string }>;
      if (!items.length) return "";
      const ld = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })) }).replace(/</g, "\\u003c");
      return `${b.heading ? `<h2 class="bk-h2">${esc(b.heading)}</h2>` : ""}<div class="bk-faq">${items.map((x) => `<details><summary>${esc(x.q)}</summary><div class="prose">${markdown(x.a)}</div></details>`).join("")}</div><script type="application/ld+json">${ld}</script>`;
    }
    case "signup":
      return `<div class="bk-signup">${b.heading ? `<h2 class="bk-h2">${esc(b.heading)}</h2>` : ""}${b.text ? `<p class="sub">${esc(b.text)}</p>` : ""}${r.signup(b)}</div>`;
    case "links": {
      const items = (b.items || []) as Array<{ label: string; url: string }>;
      if (!items.length) return "";
      return `${b.heading ? `<h2 class="bk-h2">${esc(b.heading)}</h2>` : ""}<div class="linklist">${items.map((x) => `<a href="${esc(x.url)}"${ext(x.url)}>${esc(x.label)}</a>`).join("")}</div>`;
    }
    case "video": {
      if (!b.url) return "";
      const yt = youtubeId(b.url);
      const inner = yt
        ? `<iframe src="https://www.youtube-nocookie.com/embed/${yt}" title="${esc(b.caption || "Video")}" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>`
        : `<video controls playsinline preload="metadata"${b.poster ? ` poster="${esc(b.poster)}"` : ""} src="${esc(b.url)}"></video>`;
      return `<figure class="bk-video${yt ? " yt" : ""}">${inner}${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}</figure>`;
    }
    case "divider": return b.style === "space" ? `<div class="bk-space" aria-hidden="true"></div>` : `<hr class="bk-rule">`;
  }
  return "";
}

/** The page body: one <section> per visible block. */
export function renderBlocks(content: BlocksContent, r: BlockRender): string {
  const first = { hero: true };
  const out: string[] = [];
  const hasHero = content.blocks.some((b) => b.type === "hero" && !b.hidden);
  if (!hasHero) out.push(`<h1 class="sr">${esc(r.title)}</h1>`);
  for (const b of content.blocks) {
    if (b.hidden) continue;
    const inner = block(b, r, first);
    if (!inner) continue;
    out.push(`<section class="bk t-${b.type} bg-${b.bg || "page"} sp-${b.space || "normal"}" id="${esc(b.id)}">${inner}</section>`);
  }
  return out.join("\n");
}

/** Shown in the editor so nothing is published that can't render. */
export function blockProblems(b: Block): string[] {
  const out: string[] = [];
  if (b.type === "hero" && !b.headline) out.push("Add a headline.");
  if (b.type === "image" && !b.url) out.push("Pick an image.");
  if (b.type === "image" && b.url && !b.alt) out.push("Describe the image for people using screen readers.");
  if (b.type === "gallery" && (b.items || []).length < 2) out.push("Add at least two screenshots.");
  if (b.type === "gallery" && (b.items || []).some((x: Img) => !x.alt)) out.push("Describe each screenshot for screen readers.");
  if (b.type === "store" && !b.apple && !b.google) out.push("Add an App Store or Google Play link.");
  if (b.type === "features" && (b.items || []).length < 2) out.push("Add at least two features.");
  if (b.type === "faq" && !(b.items || []).length) out.push("Add a question and answer.");
  if (b.type === "links" && !(b.items || []).length) out.push("Add a link.");
  if (b.type === "video" && !b.url) out.push("Add a video file or a YouTube link.");
  if (b.type === "quote" && !b.text) out.push("Add the quote.");
  return out;
}

/** Give store buttons tracked links, so taps are counted like links in social posts. Run when a page is saved. */
export async function trackStoreLinks(env: Env, page: { id: string; slug: string }, site: { subdomain: string }, content: BlocksContent): Promise<BlocksContent> {
  const tags = { utm_source: site.subdomain, utm_medium: "web", utm_campaign: page.slug || "home" };
  for (const b of content.blocks) {
    if (b.type !== "store") continue;
    if (b.apple) b.apple_code = await makeLink(env, { url: b.apple, source_type: "page", source_id: page.id, platform: "ios", tags });
    else delete b.apple_code;
    if (b.google) b.google_code = await makeLink(env, { url: b.google, source_type: "page", source_id: page.id, platform: "android", tags });
    else delete b.google_code;
  }
  return content;
}

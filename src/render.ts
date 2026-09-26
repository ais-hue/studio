import { accentOf, esc, markdown } from "./util";

export interface Site {
  id: string; name: string; subdomain: string; accent: string; theme: string; status: string; tagline: string;
}
export interface Page {
  id: string; site_id: string; slug: string; title: string; template: string;
  content: string; published: number; created_at: number; updated_at: number;
}
export interface Content {
  eyebrow?: string; headline?: string; sub?: string; body?: string; points?: string;
  links?: string; cta?: string; form?: boolean; description?: string;
}

export function parseContent(p: Page): Content {
  try { return JSON.parse(p.content || "{}"); } catch { return {}; }
}

export interface RenderOpts {
  host: string;           // e.g. seek.aisling.online
  preview?: boolean;
  consentText: string;
  hasBlog: boolean;
  joined?: boolean | "confirm";
}

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" });

function shell(site: Site, title: string, desc: string, body: string, o: RenderOpts, bodyClass = "", current = ""): string {
  const [light, dark] = accentOf(site.accent);
  const theme = ["light", "dark"].includes(site.theme) ? site.theme : "auto";
  const nav = `<header class="nav"><a class="mark" href="/"><i aria-hidden="true"></i>${esc(site.name)}</a>${
    o.hasBlog ? `<nav aria-label="Site"><a href="/"${current === "home" ? ' aria-current="page"' : ""}>Home</a><a href="/blog"${current === "blog" ? ' aria-current="page"' : ""}>Journal</a></nav>` : ""
  }</header>`;
  const foot = `<footer><span>© ${new Date().getFullYear()} ${esc(site.name)}</span><span>${esc(o.host)}</span></footer>`;
  return `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
${desc ? `<meta name="description" content="${esc(desc)}"><meta property="og:description" content="${esc(desc)}">` : ""}
<meta property="og:title" content="${esc(title)}">
${o.preview ? `<meta name="robots" content="noindex">` : ""}
<link rel="preload" href="/__proof/fonts/archivo-wdth.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/__proof/fonts/fonts.css">
<link rel="stylesheet" href="/__proof/site.css">
<style>:root{--pc-light:${light};--pc-dark:${dark}}</style>
</head><body class="${bodyClass}"><div class="page">${nav}<main>${body}</main>${foot}</div>${formScript(o)}</body></html>`;
}

function signup(page: Page, c: Content, o: RenderOpts): string {
  if (c.form === false) return "";
  const cta = c.cta || "Keep me posted";
  return `<form class="signup" method="post" action="/__proof/subscribe" data-proof-form${o.preview ? " data-preview" : ""}>
  <input type="hidden" name="page" value="${esc(page.id)}">
  <div class="hp" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
  <div class="row">
    <label class="sr" for="f-name">Your name</label><input id="f-name" type="text" name="name" placeholder="Your name" maxlength="80" autocomplete="name">
    <label class="sr" for="f-email">Email</label><input id="f-email" type="email" name="email" placeholder="you@email.com" required maxlength="254" autocomplete="email">
    <button type="submit">${esc(cta)}</button>
  </div>
  <label class="consent"><input type="checkbox" name="consent" value="yes" required> <span>${esc(o.consentText)}</span></label>
  <div class="msg${o.joined ? " ok" : ""}" role="status" aria-live="polite">${o.joined === "confirm" ? "Almost there. Check your inbox and tap the link to confirm." : o.joined ? "You’re on the list. Check your inbox." : ""}</div>
</form>`;
}

function formScript(o: RenderOpts): string {
  return `<script>
document.querySelectorAll("[data-proof-form]").forEach(function(f){
  f.addEventListener("submit",function(e){
    e.preventDefault();
    var msg=f.querySelector(".msg"),btn=f.querySelector("button");
    if(f.hasAttribute("data-preview")){msg.className="msg ok";msg.textContent="Preview: this is what visitors see after signing up. Nothing was saved.";return}
    btn.disabled=true;msg.className="msg";msg.textContent="Sending…";
    fetch(f.action,{method:"POST",body:new FormData(f),headers:{"accept":"application/json"}})
      .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d}})})
      .then(function(x){
        btn.disabled=false;
        if(x.ok){msg.className="msg ok";msg.textContent=x.d.message||"You’re on the list.";f.querySelectorAll("input[type=text],input[type=email]").forEach(function(i){i.value=""});f.querySelector("input[name=consent]").checked=false}
        else{msg.className="msg bad";msg.textContent=x.d.error||"That didn’t go through. Try again."}
      })
      .catch(function(){btn.disabled=false;msg.className="msg bad";msg.textContent="Couldn’t reach the server. Check your connection and try again."});
  });
});
</script>`;
}

function lines(s?: string): string[] {
  return String(s || "").split("\n").map((l) => l.trim()).filter(Boolean);
}

function safeUrl(u: string): string {
  u = u.trim();
  return /^(https?:\/\/|mailto:|\/)/i.test(u) ? u : "";
}

export function renderPage(site: Site, page: Page, o: RenderOpts): string {
  const c = parseContent(page);
  const headline = c.headline || page.title;
  const desc = c.description || c.sub || site.tagline || "";
  const title = page.slug ? `${page.title} · ${site.name}` : site.name + (site.tagline ? ` · ${site.tagline}` : "");
  const body = c.body ? `<div class="prose">${markdown(c.body)}</div>` : "";

  if (page.template === "links") {
    const links = lines(c.links).map((l) => {
      const [label, url] = l.split("|").map((x) => (x || "").trim());
      const href = safeUrl(url || "");
      return href ? `<a href="${esc(href)}">${esc(label)}</a>` : "";
    }).join("");
    return shell(site, title, desc, `<div class="badge" aria-hidden="true">${esc(site.name.charAt(0))}</div>
<h1>${esc(headline)}</h1>${c.sub ? `<p class="sub">${esc(c.sub)}</p>` : ""}
${links ? `<div class="linklist">${links}</div>` : ""}${body}${signup(page, c, o)}`, o, "links-page", page.slug ? "" : "home");
  }

  if (page.template === "post") {
    return shell(site, title, desc, `<article class="post" style="display:flex;flex-direction:column;gap:22px">
<div class="meta">${esc(fmtDate(page.created_at))}</div>
<h1>${esc(headline)}</h1>${c.sub ? `<p class="sub">${esc(c.sub)}</p>` : ""}
${body}</article>
${c.form === false ? "" : `<section class="post-end"><h2>${esc(c.eyebrow || "Get the next one")}</h2>${signup(page, c, o)}</section>`}`, o, "", "blog");
  }

  const eyebrow = c.eyebrow || (page.template === "launch" ? "Now launching" : "Early access");
  const points = page.template === "launch" && lines(c.points).length
    ? `<ul class="points">${lines(c.points).slice(0, 6).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "";
  return shell(site, title, desc, `<div class="eyebrow">${esc(eyebrow)}</div>
<h1>${esc(headline)}</h1>${c.sub ? `<p class="sub">${esc(c.sub)}</p>` : ""}
${signup(page, c, o)}${points}${body}`, o, "", page.slug ? "" : "home");
}

export function renderBlog(site: Site, posts: Page[], o: RenderOpts): string {
  const items = posts.map((p) => {
    const c = parseContent(p);
    return `<li><a href="/${esc(p.slug)}"><b>${esc(c.headline || p.title)}</b><span>${esc(fmtDate(p.created_at))}</span>${c.sub ? `<p>${esc(c.sub)}</p>` : ""}</a></li>`;
  }).join("");
  return shell(site, `Journal · ${site.name}`, site.tagline, `<div class="eyebrow">Journal</div><h1>${esc(site.name)} notes</h1>
${items ? `<ul class="index">${items}</ul>` : `<p class="sub">Nothing published yet.</p>`}`, o, "", "blog");
}

export function renderNotice(site: Site | null, heading: string, text: string, o: RenderOpts, status = ""): string {
  const s: Site = site || { id: "", name: o.host.split(".")[0] || "Proof", subdomain: "", accent: "brass", theme: "auto", status: "", tagline: "" };
  return shell(s, heading, "", `${status ? `<div class="eyebrow">${esc(status)}</div>` : ""}<h1>${esc(heading)}</h1><div class="notice">${text}</div>`, { ...o, hasBlog: false });
}

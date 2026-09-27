import { Env, HttpError, accentOf, esc, getSettings, id, isEmail, json, now } from "./util";
import { joinList } from "./public";

/*
 * Forms. Each form picks fields (email always, name and any custom contact fields), adds people to a list,
 * and can be used three ways:
 *   - on a Studio page (the page's sign-up block uses it)
 *   - embedded on any website: <div data-studio-form="ID"></div><script src="https://go.<domain>/f/ID.js" async></script>
 *     or as an iframe of https://go.<domain>/f/ID
 *   - posted to by an app: POST https://go.<domain>/f/ID with JSON {email, name, consent: true, fields: {…}}
 */

export const FIELD_TYPES = ["text", "textarea", "number", "date", "select", "multiselect", "checkbox"];

export interface FormField { key: string; label: string; type: string; options: string[]; required: boolean }
export interface PublicForm {
  id: string; name: string; site_id: string | null; list_id: string | null; status: string;
  button: string; success: string; redirect_url: string; fields: FormField[];
  accent: string; siteName: string | null; consentText: string;
}

export async function loadForm(env: Env, fid: string): Promise<PublicForm | null> {
  const f = await env.DB.prepare(`SELECT f.*, s.accent, s.name AS site_name FROM forms f LEFT JOIN sites s ON s.id = f.site_id WHERE f.id = ?`).bind(fid).first<any>();
  if (!f) return null;
  const chosen: Array<{ key: string; required?: boolean; label?: string }> = JSON.parse(f.fields || "[]");
  const { results } = await env.DB.prepare("SELECT key, label, type, options FROM contact_fields").all<{ key: string; label: string; type: string; options: string }>();
  const custom = new Map(results.map((r) => [r.key, r]));
  const fields: FormField[] = [{ key: "email", label: "Email", type: "email", options: [], required: true }];
  for (const c of chosen) {
    if (c.key === "email") continue;
    if (c.key === "name") { fields.push({ key: "name", label: c.label || "Name", type: "text", options: [], required: !!c.required }); continue; }
    const d = custom.get(c.key);
    if (d) fields.push({ key: d.key, label: c.label || d.label, type: d.type, options: JSON.parse(d.options || "[]"), required: !!c.required });
  }
  // Name reads naturally before email.
  const ni = fields.findIndex((x) => x.key === "name");
  if (ni > 0) fields.unshift(fields.splice(ni, 1)[0]);
  const settings = await getSettings(env);
  return {
    id: f.id, name: f.name, site_id: f.site_id, list_id: f.list_id, status: f.status, button: f.button, success: f.success,
    redirect_url: f.redirect_url, fields, accent: accentOf(f.accent || "slate")[0], siteName: f.site_name || null, consentText: settings.consent_text,
  };
}

/** The inputs for a form, with `sf-` classes so embeds can be styled without clashing. */
export function renderFields(f: PublicForm, prefix = "sf"): string {
  const idp = `${prefix}-${f.id.slice(-6)}`;
  const req = (x: FormField) => (x.required ? " required" : "");
  const out = f.fields.map((x) => {
    const iid = `${idp}-${x.key}`, name = x.key === "email" || x.key === "name" ? x.key : `fields[${x.key}]`;
    const lab = `<label class="sf-label" for="${iid}">${esc(x.label)}${x.required ? "" : ' <span class="sf-opt">optional</span>'}</label>`;
    switch (x.type) {
      case "email": return `<div class="sf-field">${lab}<input class="sf-input" id="${iid}" type="email" name="email" required maxlength="254" autocomplete="email" placeholder="you@email.com"></div>`;
      case "textarea": return `<div class="sf-field">${lab}<textarea class="sf-input" id="${iid}" name="${name}" maxlength="2000" rows="3"${req(x)}></textarea></div>`;
      case "number": return `<div class="sf-field">${lab}<input class="sf-input" id="${iid}" type="number" name="${name}" step="any"${req(x)}></div>`;
      case "date": return `<div class="sf-field">${lab}<input class="sf-input" id="${iid}" type="date" name="${name}"${req(x)}></div>`;
      case "select": return `<div class="sf-field">${lab}<select class="sf-input" id="${iid}" name="${name}"${req(x)}><option value="">Choose…</option>${x.options.map((o) => `<option>${esc(o)}</option>`).join("")}</select></div>`;
      case "multiselect": return `<fieldset class="sf-field sf-group"><legend class="sf-label">${esc(x.label)}${x.required ? "" : ' <span class="sf-opt">optional</span>'}</legend>${x.options.map((o, i) => `<label class="sf-check"><input type="checkbox" name="${name}" value="${esc(o)}" id="${iid}-${i}"> ${esc(o)}</label>`).join("")}</fieldset>`;
      case "checkbox": return `<div class="sf-field"><label class="sf-check"><input type="checkbox" name="${name}" value="yes" id="${iid}"${req(x)}> ${esc(x.label)}</label></div>`;
      default: return `<div class="sf-field">${lab}<input class="sf-input" id="${iid}" type="text" name="${name}" maxlength="300"${x.key === "name" ? ' autocomplete="name"' : ""}${req(x)}></div>`;
    }
  }).join("");
  return `${out}<div class="sf-hp" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<input type="hidden" name="sref" value="">
<label class="sf-check sf-consent"><input type="checkbox" name="consent" value="yes" required> <span>${esc(f.consentText)}</span></label>`;
}

/** FormData → plain object, with fields[key] grouped and repeated checkboxes as arrays. */
export function formToObject(fd: FormData): Record<string, any> {
  const out: Record<string, any> = { fields: {} };
  for (const [k, v] of fd.entries()) {
    const val = typeof v === "string" ? v : "";
    const m = k.match(/^fields\[([a-z0-9_]+)\]$/);
    if (m) {
      const cur = out.fields[m[1]];
      out.fields[m[1]] = cur === undefined ? val : Array.isArray(cur) ? cur.concat(val) : [cur, val];
    } else out[k] = val;
  }
  return out;
}

/** Check values against the form and turn them into contact properties. */
function validate(f: PublicForm, data: Record<string, any>): { email: string; name: string; props: Record<string, unknown> } {
  const email = String(data.email || "").trim().toLowerCase();
  if (!isEmail(email)) throw new HttpError(400, "That email address doesn’t look right. Check it and try again.");
  const consent = data.consent === true || data.consent === "yes" || data.consent === "true" || data.consent === 1;
  if (!consent) throw new HttpError(400, "Tick the box to say you’re happy to get emails.");
  const name = String(data.name || "").trim().slice(0, 80);
  const given: Record<string, any> = typeof data.fields === "object" && data.fields ? data.fields : {};
  const props: Record<string, unknown> = {};
  for (const x of f.fields) {
    if (x.key === "email") continue;
    if (x.key === "name") { if (x.required && !name) throw new HttpError(400, `Fill in ${x.label.toLowerCase()}.`); continue; }
    let v = given[x.key];
    const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
    if (empty) { if (x.required) throw new HttpError(400, `Fill in ${x.label.toLowerCase()}.`); continue; }
    switch (x.type) {
      case "number": { const n = Number(v); if (!Number.isFinite(n)) throw new HttpError(400, `${x.label} needs to be a number.`); props[x.key] = n; break; }
      case "date": { const d = String(v).slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, `${x.label} needs to be a date.`); props[x.key] = d; break; }
      case "checkbox": props[x.key] = v === true || v === "yes" || v === "true" || v === 1 || v === "1" ? 1 : 0; break;
      case "select": { const s = String(v); if (!x.options.includes(s)) throw new HttpError(400, `Pick one of the options for ${x.label.toLowerCase()}.`); props[x.key] = s; break; }
      case "multiselect": {
        const arr = (Array.isArray(v) ? v : String(v).split(",")).map((z) => String(z).trim()).filter(Boolean);
        const bad = arr.find((z) => !x.options.includes(z));
        if (bad) throw new HttpError(400, `“${bad}” isn’t one of the options for ${x.label.toLowerCase()}.`);
        props[x.key] = [...new Set(arr)];
        break;
      }
      default: props[x.key] = String(v).trim().slice(0, x.type === "textarea" ? 2000 : 300);
    }
  }
  return { email, name, props };
}

async function ipHash(env: Env, ip: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ip}|${day}|${env.ROOT_DOMAIN}`));
  return Array.from(new Uint8Array(d).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function ensureList(env: Env, f: PublicForm): Promise<string> {
  if (f.list_id && (await env.DB.prepare("SELECT 1 FROM lists WHERE id = ?").bind(f.list_id).first())) return f.list_id;
  const lid = id("l_");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO lists (id, name, welcome_subject, welcome_body, created_at) VALUES (?, ?, 'Welcome', ?, ?)").bind(lid, f.name.slice(0, 60), "Hi {{name}},\n\nThanks for signing up.\n\nAisling", now()),
    env.DB.prepare("UPDATE forms SET list_id = ? WHERE id = ?").bind(lid, f.id),
  ]);
  return lid;
}

/** Take one submission. */
export async function submitForm(env: Env, ctx: ExecutionContext, f: PublicForm, data: Record<string, any>,
  meta: { pageUrl: string; ip: string; source?: string }): Promise<{ status: string; message: string; redirect?: string }> {
  if (f.status !== "active") throw new HttpError(404, "This form has been switched off.");
  if (String(data.website || "").trim()) return { status: "subscribed", message: f.success }; // bot trap
  const iph = meta.ip ? await ipHash(env, meta.ip) : "";
  if (iph) {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM form_submissions WHERE ip_hash = ? AND created_at > ?").bind(iph, now() - 3600_000).first<{ n: number }>();
    if ((n?.n || 0) >= 20) throw new HttpError(429, "Too many sign-ups from here in the last hour. Try again later.");
  }
  const v = validate(f, data);
  const listId = await ensureList(env, f);
  const site = f.site_id ? await env.DB.prepare("SELECT name, accent FROM sites WHERE id = ?").bind(f.site_id).first<{ name: string; accent: string }>() : null;
  let source = meta.source || "";
  if (!source) { try { source = "form: " + f.name + (meta.pageUrl ? " on " + new URL(meta.pageUrl).hostname : ""); } catch { source = "form: " + f.name; } }
  const r = await joinList(env, ctx, { email: v.email, name: v.name, source: source.slice(0, 120), listId, site, props: v.props, sref: String(data.sref || "") });
  await env.DB.prepare("INSERT INTO form_submissions (id, form_id, contact_id, data, page_url, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id("fs_"), f.id, r.contactId, JSON.stringify({ name: v.name, ...v.props }), meta.pageUrl.slice(0, 500), iph, now()).run();
  const message = r.status === "pending" ? "Almost there. Check your inbox and tap the link to confirm." : f.success;
  return { status: r.status, message, redirect: /^https:\/\//.test(f.redirect_url) ? f.redirect_url : undefined };
}

/* ---------- public: go.<domain>/f/<id> ---------- */

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, accept", "access-control-max-age": "86400" };

export function formCss(accent: string): string {
  return `.sf{--sf-accent:${accent};display:flex;flex-direction:column;gap:12px;font:inherit;color:inherit;max-width:520px}
.sf *{box-sizing:border-box;border-radius:0}
.sf-field{display:flex;flex-direction:column;gap:5px;border:0;margin:0;padding:0;min-width:0}
.sf-label{font-size:.85em;font-weight:600}
.sf-opt{font-weight:400;opacity:.6}
.sf-input{font:inherit;width:100%;padding:10px 12px;border:1px solid color-mix(in srgb,currentColor 30%,transparent);background:transparent;color:inherit}
.sf-input:focus{outline:2px solid var(--sf-accent);outline-offset:1px}
.sf-group{gap:6px}
.sf-check{display:flex;gap:8px;align-items:flex-start;font-size:.92em;cursor:pointer}
.sf-check input{margin-top:.25em;accent-color:var(--sf-accent)}
.sf-consent{font-size:.82em;opacity:.85}
.sf-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
.sf-btn{font:inherit;font-weight:600;padding:11px 18px;border:0;background:var(--sf-accent);color:#fff;cursor:pointer;align-self:flex-start}
.sf-btn[disabled]{opacity:.6;cursor:wait}
.sf-msg{font-size:.92em;min-height:1em}
.sf-msg.ok{font-weight:600}
.sf-msg.err{color:#A63E2A}`;
}

function hostedPage(env: Env, f: PublicForm, msg = "", err = false, preview = false): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(f.name)}</title><style>html,body{margin:0;background:transparent}body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:16px;line-height:1.5;color:#161512;padding:4px}
@media (prefers-color-scheme:dark){body{color:#EEF0F4}}${formCss(f.accent)}</style></head><body>
<form class="sf" method="post" action="https://go.${esc(env.ROOT_DOMAIN)}/f/${esc(f.id)}">
${renderFields(f)}
<button class="sf-btn" type="submit">${esc(f.button)}</button><div class="sf-msg${msg ? (err ? " err" : " ok") : ""}" role="status" aria-live="polite">${esc(msg)}</div></form>
<script>
(function(){var r=new URLSearchParams(location.search).get("sref");if(r)document.querySelector("[name=sref]").value=r;
function size(){try{parent.postMessage({studioForm:${JSON.stringify(f.id)},height:document.documentElement.scrollHeight},"*")}catch(e){}}
size();new ResizeObserver(size).observe(document.body);
var fm=document.querySelector(".sf");fm.addEventListener("submit",function(e){e.preventDefault();var b=fm.querySelector(".sf-btn"),m=fm.querySelector(".sf-msg");${preview ? `m.className="sf-msg ok";m.textContent="Preview: this is what people see after signing up. Nothing was saved.";size();return;` : ""}b.disabled=true;m.className="sf-msg";m.textContent="";
fetch(fm.action,{method:"POST",body:new FormData(fm),headers:{accept:"application/json"}}).then(function(x){return x.json().then(function(d){return{ok:x.ok,d:d}})}).then(function(x){
if(x.ok&&x.d.redirect){try{top.location.href=x.d.redirect}catch(e){location.href=x.d.redirect}return}
m.className="sf-msg "+(x.ok?"ok":"err");m.textContent=x.ok?x.d.message:(x.d.error||"That didn’t work.");if(x.ok)fm.reset();b.disabled=false;size()}).catch(function(){m.className="sf-msg err";m.textContent="Couldn’t send. Check your connection.";b.disabled=false})})})();
</script></body></html>`;
}

function embedScript(env: Env, f: PublicForm): string {
  const htmlBlock = `<form class="sf" novalidate>${renderFields(f, "sfe")}<button class="sf-btn" type="submit">${esc(f.button)}</button><div class="sf-msg" role="status" aria-live="polite"></div></form>`;
  return `(function(){
var ID=${JSON.stringify(f.id)},URL=${JSON.stringify(`https://go.${env.ROOT_DOMAIN}/f/${f.id}`)},HTML=${JSON.stringify(htmlBlock)},CSS=${JSON.stringify(formCss(f.accent))};
if(!document.getElementById("studio-form-css")){var st=document.createElement("style");st.id="studio-form-css";st.textContent=CSS;document.head.appendChild(st)}
var ref=new URLSearchParams(location.search).get("sref")||"";
document.querySelectorAll('[data-studio-form="'+ID+'"]').forEach(function(host){
  if(host.dataset.studioReady)return;host.dataset.studioReady="1";host.innerHTML=HTML;
  var fm=host.querySelector("form"),sr=fm.querySelector("[name=sref]");if(sr)sr.value=ref;
  if(host.dataset.accent)fm.style.setProperty("--sf-accent",host.dataset.accent);
  fm.addEventListener("submit",function(e){e.preventDefault();if(!fm.reportValidity())return;var b=fm.querySelector(".sf-btn"),m=fm.querySelector(".sf-msg");b.disabled=true;m.className="sf-msg";m.textContent="";
    var fd=new FormData(fm);fd.append("page_url",location.href);
    fetch(URL,{method:"POST",body:fd,headers:{accept:"application/json"}}).then(function(x){return x.json().then(function(d){return{ok:x.ok,d:d}})}).then(function(x){
      if(x.ok&&x.d.redirect){location.href=x.d.redirect;return}
      m.className="sf-msg "+(x.ok?"ok":"err");m.textContent=x.ok?x.d.message:(x.d.error||"That didn’t work.");if(x.ok)fm.reset();b.disabled=false})
    .catch(function(){m.className="sf-msg err";m.textContent="Couldn’t send. Check your connection.";b.disabled=false})});
});})();`;
}

export async function handleFormPublic(req: Request, env: Env, ctx: ExecutionContext, raw: string): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const m = raw.match(/^([a-z0-9_]+)(\.js)?$/i);
  const f = m ? await loadForm(env, m[1]) : null;
  const isJs = !!m?.[2];
  if (!f || f.status !== "active") {
    if (isJs) return new Response("/* This Studio form is switched off. */", { status: 404, headers: { "content-type": "text/javascript", ...CORS } });
    return json({ error: "This form has been switched off." }, 404);
  }
  if (req.method === "GET" && isJs) return new Response(embedScript(env, f), { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=60", ...CORS } });
  if (req.method === "GET") return new Response(hostedPage(env, f, "", false, new URL(req.url).searchParams.get("preview") === "1"), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  const ct = req.headers.get("content-type") || "";
  const wantsJson = ct.includes("application/json") || (req.headers.get("accept") || "").includes("application/json");
  let data: Record<string, any>;
  try { data = ct.includes("application/json") ? await req.json<Record<string, any>>() : formToObject(await req.formData()); }
  catch { return json({ error: "That didn’t come through properly." }, 400); }
  const pageUrl = String(data.page_url || req.headers.get("referer") || "").slice(0, 500);
  try {
    const r = await submitForm(env, ctx, f, data, { pageUrl, ip: req.headers.get("cf-connecting-ip") || "" });
    if (wantsJson) return new Response(JSON.stringify({ ok: true, status: r.status, message: r.message, redirect: r.redirect || null }), { status: 201, headers: { "content-type": "application/json", ...CORS } });
    if (r.redirect) return Response.redirect(r.redirect, 303);
    return new Response(hostedPage(env, f, r.message), { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    if (wantsJson) return new Response(JSON.stringify({ ok: false, error: e.message }), { status: e.status, headers: { "content-type": "application/json", ...CORS } });
    return new Response(hostedPage(env, f, e.message, true), { status: e.status, headers: { "content-type": "text/html; charset=utf-8" } });
  }
}

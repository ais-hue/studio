import { Env, esc, getSettings, html, isEmail, now, token } from "./util";
import { sendTransactional } from "./email";

/*
 * Studio sign-in by email link.
 *  - Only addresses in ADMIN_EMAILS can sign in; everyone else gets the same neutral reply.
 *  - Links last 15 minutes and work once. They open a confirm page, so email scanners that
 *    prefetch links can't use them up.
 *  - Sessions last 30 days in an HttpOnly, Secure, SameSite=Lax cookie. Only hashes are stored.
 */

const LINK_TTL = 15 * 60 * 1000;
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const COOKIE = "studio_session";

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

function allowed(env: Env, email: string): boolean {
  return String(env.ADMIN_EMAILS || "").toLowerCase().split(/[\s,]+/).filter(Boolean).includes(email.toLowerCase());
}

function cookieValue(req: Request, name: string): string | null {
  const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}

export async function sessionEmail(req: Request, env: Env): Promise<string | null> {
  const raw = cookieValue(req, COOKIE);
  if (!raw) return null;
  const row = await env.DB.prepare("SELECT email, expires_at FROM sessions WHERE hash = ?").bind(await sha256(raw)).first<{ email: string; expires_at: number }>();
  if (!row || row.expires_at < now() || !allowed(env, row.email)) return null;
  return row.email;
}

function page(title: string, body: string, status = 200, headers: Record<string, string> = {}): Response {
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><title>${esc(title)} · Studio</title>
<link rel="stylesheet" href="/__proof/fonts/studio-fonts.css">
<style>
:root{color-scheme:light;--bg:#F5F5F2;--card:#FFFFFF;--line:#E3E3DE;--t1:#0E1628;--t2:#4B5367;--t3:#858B99;--coral:#EC7650;--sage:#4A6B52}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#111A2E;--card:#16203A;--line:#243049;--t1:#EEF0F4;--t2:#A3ACC0;--t3:#6F7A93;--sage:#BFD0BD}}
*{box-sizing:border-box;border-radius:0!important}
body{margin:0;min-height:100vh;display:grid;grid-template-columns:minmax(0,420px) minmax(0,1fr);background:var(--bg);color:var(--t1);font-family:"Poppins",system-ui,sans-serif;font-size:14px;line-height:1.55}
.side{background:#0E1628;color:#F1F2F5;padding:32px;display:flex;flex-direction:column;justify-content:space-between;gap:24px}
.brand{display:flex;align-items:center;gap:12px}
.mark{display:grid;grid-template-columns:repeat(2,1fr);gap:2px;width:26px;height:26px}
.mark i:nth-child(1),.mark i:nth-child(4){background:#BFD0BD}.mark i:nth-child(2){background:#EC7650}.mark i:nth-child(3){background:#E6D3AE}
.word{font-family:"Playfair Display",Georgia,serif;font-weight:600;font-size:24px;letter-spacing:.04em;text-transform:uppercase;line-height:1}
.side small{color:#6F7A93;font-size:12px}
main{display:flex;align-items:center;justify-content:center;padding:32px 16px}
.card{width:100%;max-width:400px;background:var(--card);border:1px solid var(--line);padding:28px;display:flex;flex-direction:column;gap:14px}
.eyebrow{font-size:10.5px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--sage)}
h1{margin:0;font-size:24px;font-weight:600;letter-spacing:-.015em;line-height:1.25}
p{margin:0;color:var(--t2)}
label{font-size:10.5px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--t2)}
input{width:100%;font:inherit;font-size:15px;padding:10px 12px;border:1px solid var(--line);background:var(--bg);color:var(--t1)}
input:focus{outline:none;border-color:var(--coral)}
button,.btn{font:inherit;font-weight:600;font-size:14px;padding:11px 16px;border:1px solid var(--coral);background:var(--coral);color:#0E1628;cursor:pointer;text-align:center;text-decoration:none;display:block;width:100%}
button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid var(--coral);outline-offset:2px}
.fine{font-size:12px;color:var(--t3)}
@media (max-width:760px){body{grid-template-columns:1fr}.side{padding:20px 16px}.side .tag{display:none}}
</style></head><body>
<aside class="side"><div class="brand"><span class="mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span><span class="word">Studio</span><br><small>aisling.online</small></span></div><small class="tag">Sites, contacts and email for everything you make.</small></aside>
<main><div class="card">${body}</div></main></body></html>`, status, { "cache-control": "no-store", "x-frame-options": "DENY", ...headers });
}

export function loginPage(message = ""): Response {
  return page("Sign in", `<span class="eyebrow">Studio</span><h1>Sign in</h1>
<p>We’ll email you a link. No password needed.</p>
<form method="post" action="/auth/request" style="display:flex;flex-direction:column;gap:12px">
<div style="display:flex;flex-direction:column;gap:6px"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254" autofocus></div>
<button type="submit">Email me a sign-in link</button></form>
${message ? `<p class="fine" role="status">${esc(message)}</p>` : ""}`);
}

export async function handleAuth(req: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
  const url = new URL(req.url);
  const p = url.pathname;

  if (p === "/login" && req.method === "GET") return loginPage();

  if (p === "/auth/request" && req.method === "POST") {
    const form = await req.formData().catch(() => null);
    const email = String(form?.get("email") || "").trim().toLowerCase();
    const done = page("Check your email", `<span class="eyebrow">Almost there</span><h1>Check your email</h1>
<p>If <b>${esc(email)}</b> can sign in to Studio, a link is on its way. It works once and expires in 15 minutes.</p>
<p class="fine">Nothing arrived? Check spam, or <a href="/login">try again</a>.</p>`);
    if (!isEmail(email) || !allowed(env, email)) return done;
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND created_at > ?").bind(email, now() - LINK_TTL).first<{ n: number }>();
    if ((recent?.n || 0) >= 5) return done;
    const raw = token();
    await env.DB.prepare("INSERT INTO login_tokens (hash, email, expires_at, created_at) VALUES (?, ?, ?, ?)").bind(await sha256(raw), email, now() + LINK_TTL, now()).run();
    const link = `${url.origin}/auth/verify?t=${encodeURIComponent(raw)}`;
    if (env.ROOT_DOMAIN === "localhost") console.log("Studio sign-in link:", link); // local testing only
    const settings = await getSettings(env);
    ctx.waitUntil(sendTransactional(env, {
      to: email,
      from: `Studio <${settings.sender_email}>`,
      subject: "Your Studio sign-in link",
      text: `Sign in to Studio:\n${link}\n\nThis link works once and expires in 15 minutes. If you didn’t ask for it, you can ignore this email.`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0E1628;max-width:480px">
<p style="font-family:Georgia,serif;font-size:20px;letter-spacing:.04em;text-transform:uppercase;margin:0 0 16px">Studio</p>
<p>Here’s your sign-in link. It works once and expires in 15 minutes.</p>
<p style="margin:24px 0"><a href="${esc(link)}" style="background:#EC7650;color:#0E1628;padding:12px 18px;text-decoration:none;font-weight:bold;display:inline-block">Sign in to Studio</a></p>
<p style="font-size:12px;color:#4B5367">If you didn’t ask for this, you can ignore it. Nobody can sign in without this link.</p></div>`,
    }).then((r) => { if (!r.ok) console.error("Sign-in email failed:", r.error); }));
    return done;
  }

  if (p === "/auth/verify") {
    const raw = url.searchParams.get("t") || "";
    const hash = await sha256(raw);
    const row = await env.DB.prepare("SELECT email, expires_at, used_at FROM login_tokens WHERE hash = ?").bind(hash).first<{ email: string; expires_at: number; used_at: number | null }>();
    const bad = !row || row.used_at || row.expires_at < now() || !allowed(env, row.email);
    if (bad) return page("Link expired", `<span class="eyebrow">Sign in</span><h1>That link has expired</h1><p>Sign-in links work once and last 15 minutes.</p><a class="btn" href="/login">Send a new link</a>`, 400);
    if (req.method !== "POST") {
      return page("Sign in", `<span class="eyebrow">Sign in</span><h1>Continue to Studio</h1><p>Signing in as <b>${esc(row!.email)}</b>.</p>
<form method="post"><button type="submit">Sign in</button></form>`);
    }
    const r = await env.DB.prepare("UPDATE login_tokens SET used_at = ? WHERE hash = ? AND used_at IS NULL").bind(now(), hash).run();
    if (!r.meta?.changes) return page("Link expired", `<h1>That link has already been used</h1><a class="btn" href="/login">Send a new link</a>`, 400);
    const session = token();
    await env.DB.prepare("INSERT INTO sessions (hash, email, expires_at, created_at, user_agent) VALUES (?, ?, ?, ?, ?)")
      .bind(await sha256(session), row!.email, now() + SESSION_TTL, now(), (req.headers.get("user-agent") || "").slice(0, 200)).run();
    ctx.waitUntil(env.DB.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(now() - 86400000).run());
    const secure = url.protocol === "https:" ? "; Secure" : "";
    return new Response(null, { status: 303, headers: {
      location: "/",
      "set-cookie": `${COOKIE}=${encodeURIComponent(session)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}${secure}`,
      "cache-control": "no-store",
    } });
  }

  if (p === "/auth/logout" && req.method === "POST") {
    const raw = cookieValue(req, COOKIE);
    if (raw) await env.DB.prepare("DELETE FROM sessions WHERE hash = ?").bind(await sha256(raw)).run();
    return new Response(null, { status: 303, headers: { location: "/login", "set-cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } });
  }

  return null;
}

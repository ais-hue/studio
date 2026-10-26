import { Env, HttpError, html, now } from "./util";
import { RenderOpts, Site, renderGate } from "./render";

/*
 * Password-protected sites. Site settings → Password stores a salted PBKDF2 hash in site_locks. Every request to a
 * locked site (its aisling.online address and its own domains) needs a signed cookie, which the password page sets.
 * The cookie is signed with the stored hash, so changing or removing the password signs everyone out.
 * Locked pages are never cached or indexed, robots.txt turns crawlers away and the sitemap is empty.
 */

const ITER = 100_000;                 // the most PBKDF2 rounds Workers allow
const COOKIE = "studio_pass";
const DAYS = 30;
const MAX_TRIES = 10, WINDOW = 15 * 60_000;

export interface Lock { site_id: string; hash: string; salt: string; iter: number; hint: string; updated_at: number }

const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iter: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return b64u(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function sign(lock: Lock, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode("studio-gate:" + lock.hash), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

export async function getLock(env: Env, siteId: string): Promise<Lock | null> {
  return await env.DB.prepare("SELECT * FROM site_locks WHERE site_id = ?").bind(siteId).first<Lock>();
}

/** Set or change a site's password. Studio's admin only; the password never comes back out. */
export async function setLock(env: Env, siteId: string, password: string, hint: string): Promise<void> {
  const pw = String(password || "");
  if (pw.length < 8) throw new HttpError(400, "Use at least 8 characters, so the password can’t be guessed.");
  if (pw.length > 200) throw new HttpError(400, "That password is too long. Keep it under 200 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pw, salt, ITER);
  await env.DB.prepare(`INSERT INTO site_locks (site_id, hash, salt, iter, hint, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(site_id) DO UPDATE SET hash = excluded.hash, salt = excluded.salt, iter = excluded.iter, hint = excluded.hint, updated_at = excluded.updated_at`)
    .bind(siteId, hash, b64u(salt), ITER, String(hint || "").trim().slice(0, 200), now()).run();
}

export async function setHint(env: Env, siteId: string, hint: string): Promise<void> {
  await env.DB.prepare("UPDATE site_locks SET hint = ? WHERE site_id = ?").bind(String(hint || "").trim().slice(0, 200), siteId).run();
}

export async function removeLock(env: Env, siteId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM site_locks WHERE site_id = ?").bind(siteId).run();
}

async function cookieOk(req: Request, lock: Lock): Promise<boolean> {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split(".");
  if (!exp || !sig || !(+exp > now())) return false;
  return same(sig, await sign(lock, `${lock.site_id}.${exp}`));
}

/** Whether this visitor may use a site: it has no password, or they've already entered it. */
export async function passes(req: Request, env: Env, siteId: string): Promise<boolean> {
  const lock = await getLock(env, siteId);
  return !lock || (await cookieOk(req, lock));
}

const safeNext =(p: unknown) => { const s = String(p || "/"); return s.startsWith("/") && !s.startsWith("//") && !s.includes("\\") ? s.slice(0, 500) : "/"; };

/** Headers every page of a locked site carries, so nothing private ends up in a cache or a search engine. */
export const PRIVATE_HEADERS = { "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "same-origin" };

/**
 * Called before a site serves anything. Returns a response when the visitor has to see the password page
 * (or has just sent the password), and null when they're allowed through. `locked` tells the caller to add
 * PRIVATE_HEADERS to what it serves.
 */
export async function gate(req: Request, env: Env, url: URL, site: Site, o: RenderOpts): Promise<{ res: Response | null; locked: boolean }> {
  const lock = await getLock(env, site.id);
  if (!lock) return { res: null, locked: false };
  const p = url.pathname;
  if (p === "/robots.txt") return { res: new Response("User-agent: *\nDisallow: /\n", { headers: { "content-type": "text/plain" } }), locked: true };
  if (p === "/sitemap.xml") return { res: new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`, { headers: { "content-type": "application/xml; charset=utf-8", ...PRIVATE_HEADERS } }), locked: true };

  if (p === "/__proof/unlock" && req.method === "POST") {
    const origin = req.headers.get("origin");
    if (origin && origin !== "null" && new URL(origin).host !== url.host) return { res: new Response("Cross-site request refused.", { status: 403 }), locked: true };
    const form = await req.formData().catch(() => null);
    const next = safeNext(form?.get("next"));
    const ip = req.headers.get("cf-connecting-ip") || "?";
    const k = `${site.id}:${ip}`;
    const t = now();
    const tries = await env.DB.prepare("SELECT n, since FROM gate_tries WHERE k = ?").bind(k).first<{ n: number; since: number }>();
    const fresh = !tries || t - tries.since > WINDOW;
    if (!fresh && tries!.n >= MAX_TRIES) {
      return { res: html(renderGate(site, { ...o, path: next }, lock.hint, "Too many tries. Wait 15 minutes, then try again.", next), 429, PRIVATE_HEADERS), locked: true };
    }
    const ok = same(await derive(String(form?.get("password") || ""), unb64u(lock.salt), lock.iter), lock.hash);
    if (!ok) {
      await env.DB.prepare(`INSERT INTO gate_tries (k, n, since) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET
        n = CASE WHEN ? - since > ? THEN 1 ELSE n + 1 END, since = CASE WHEN ? - since > ? THEN ? ELSE since END`)
        .bind(k, t, t, WINDOW, t, WINDOW, t).run();
      return { res: html(renderGate(site, { ...o, path: next }, lock.hint, "That password didn’t work. Check it and try again.", next), 401, PRIVATE_HEADERS), locked: true };
    }
    await env.DB.prepare("DELETE FROM gate_tries WHERE k = ?").bind(k).run();
    const exp = String(t + DAYS * 864e5);
    const val = encodeURIComponent(`${exp}.${await sign(lock, `${site.id}.${exp}`)}`);
    return {
      res: new Response(null, { status: 303, headers: { location: next, "set-cookie": `${COOKIE}=${val}; Max-Age=${DAYS * 86400}; Path=/; HttpOnly; Secure; SameSite=Lax`, ...PRIVATE_HEADERS } }),
      locked: true,
    };
  }

  if (await cookieOk(req, lock)) return { res: null, locked: true };
  // Anything else (sign-up posts included) waits behind the password.
  return { res: html(renderGate(site, o, lock.hint, "", safeNext(p + url.search)), 401, PRIVATE_HEADERS), locked: true };
}

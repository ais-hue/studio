import { Env, HttpError, json } from "./util";
import { authEmail } from "./auth";
import { handleApi } from "./api";
import { handleCustomHost, handlePublic, serveStatic } from "./public";
import { runScheduled } from "./email";
import { ALTERS, SCHEMA } from "./schema";
import { handleAuth } from "./login";
import { serveFile } from "./files";
import { authorize, studioProvider } from "./oauth";
import { handleUploadLink } from "./uploads";
import { finishConnect } from "./direct/engine";
import { legalPage } from "./legal";
import { serveFonts } from "./brandkit";

let schemaReady: Promise<unknown> | null = null;
async function applySchema(env: Env) {
  await env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q)));
  for (const q of ALTERS) {
    try { await env.DB.prepare(q).run(); }
    catch (e) { if (!/duplicate column/i.test(String((e as Error)?.message || e))) throw e; }
  }
}
function ensureSchema(env: Env) {
  if (!schemaReady) schemaReady = applySchema(env).catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

async function studio(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/__proof/site.css") return serveStatic(req, env, "/site.css");
  if (url.pathname.startsWith("/__proof/fonts/")) return serveStatic(req, env, url.pathname.replace("/__proof", ""));
  const gf = await serveFonts(req, url, ctx); if (gf) return gf;
  const legal = legalPage(env, url.pathname);
  if (legal) return legal;
  if (url.pathname === "/oauth/authorize") return authorize(req, env as any);
  if (url.pathname.startsWith("/up/")) return handleUploadLink(req, env, url.pathname);
  if (url.pathname === "/login" || url.pathname.startsWith("/auth/")) {
    if (req.method === "POST") {
      const origin = req.headers.get("origin");
      if (origin && origin !== "null" && new URL(origin).host !== url.host) return new Response("Cross-site request refused.", { status: 403 });
    }
    const r = await handleAuth(req, env, ctx);
    if (r) return r;
  }
  const user = await authEmail(req, env);
  if (!user) {
    if (url.pathname.startsWith("/api/")) return json({ error: "You’ve been signed out. Sign in again to continue." }, 401);
    return Response.redirect(new URL("/login", req.url).toString(), 302);
  }
  if (url.pathname.startsWith("/social/callback/")) {
    // Back from a platform's own log-in screen (Studio's developer app).
    const platform = url.pathname.split("/")[3] || "";
    return Response.redirect(new URL(await finishConnect(env, platform, url, url.origin), req.url).toString(), 302);
  }
  if (url.pathname === "/social/connected") {
    // Zernio sends people back here after they log in to a platform; hand the result to the app.
    const keep = new URLSearchParams();
    for (const k of ["connected", "username", "error", "error_message", "platform"]) { const v = url.searchParams.get(k); if (v) keep.set(k, v.slice(0, 200)); }
    const brand = url.searchParams.get("brand") || "";
    return Response.redirect(new URL(`/#/social${brand ? "/b/" + encodeURIComponent(brand) : ""}?${keep}`, req.url).toString(), 302);
  }
  if (url.pathname.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      // same-origin writes only
      const origin = req.headers.get("origin");
      if (origin && new URL(origin).host !== url.host) return json({ error: "Cross-site request refused." }, 403);
    }
    return handleApi(req, env, ctx, user);
  }
  const res = await env.ASSETS.fetch(req);
  if (res.status === 404) return env.ASSETS.fetch(new Request(new URL("/", req.url).toString(), req));
  return res;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const host = url.hostname.toLowerCase();
    const root = env.ROOT_DOMAIN.toLowerCase();
    try {
      await ensureSchema(env);
      if (host === `studio.${root}` || (root === "localhost" && host === "localhost")) {
        return env.OAUTH_KV ? await studioProvider(env, studio).fetch(req, env, ctx) : await studio(req, env, ctx);
      }
      if (host === `files.${root}`) return await serveFile(req, env, url);
      if (host.endsWith("." + root)) {
        const sub = host.slice(0, -(root.length + 1));
        if (!sub.includes(".")) return await handlePublic(req, env, ctx, host, sub);
        return new Response("Not found", { status: 404 });
      }
      // A site's own domain (ciunas.app). Needs a Worker route on that domain's Cloudflare zone.
      const custom = await handleCustomHost(req, env, ctx, host);
      if (custom) return custom;
      return new Response("This domain isn’t connected to a Studio site yet.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Something went wrong on the server. Try again, and if it keeps happening, tell Claude what you were doing." }, 500);
    }
  },
  async scheduled(_ev: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(ensureSchema(env).then(() => runScheduled(env)));
  },
} satisfies ExportedHandler<Env>;

import { Env, HttpError, json } from "./util";
import { authEmail } from "./auth";
import { handleApi } from "./api";
import { handlePublic, serveStatic } from "./public";
import { runScheduled } from "./email";
import { SCHEMA } from "./schema";

let schemaReady: Promise<unknown> | null = null;
function ensureSchema(env: Env) {
  if (!schemaReady) schemaReady = env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q))).catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}

async function studio(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const user = await authEmail(req, env);
  if (!user) {
    const msg = env.ACCESS_AUD ? "Sign in through Cloudflare Access to use the studio." : "The studio login isn’t set up yet.";
    return url.pathname.startsWith("/api/") ? json({ error: msg }, 401) : new Response(msg, { status: 401 });
  }
  if (url.pathname.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      // same-origin writes only
      const origin = req.headers.get("origin");
      if (origin && new URL(origin).host !== url.host) return json({ error: "Cross-site request refused." }, 403);
    }
    return handleApi(req, env, ctx, user);
  }
  if (url.pathname === "/__proof/site.css") return serveStatic(req, env, "/site.css");
  if (url.pathname.startsWith("/__proof/fonts/")) return serveStatic(req, env, url.pathname.replace("/__proof", ""));
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
      if (host === `studio.${root}`) return await studio(req, env, ctx);
      if (host.endsWith("." + root)) {
        const sub = host.slice(0, -(root.length + 1));
        if (!sub.includes(".")) return await handlePublic(req, env, ctx, host, sub);
      }
      return new Response("Not found", { status: 404 });
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

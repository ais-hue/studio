import { AuthorizationError, CimdFetchError, OAuthProvider, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Env, esc } from "./util";
import { handleMcp } from "./mcp";
import { authEmail } from "./auth";
import { page } from "./login";

/*
 * Studio as a Claude connector: OAuth 2.1 (PKCE, DCR and CIMD) handled by Cloudflare's provider library,
 * on studio.<domain> only. /oauth/authorize is Studio's own page: Aisling signs in with her email link,
 * sees who is asking and what they can do, and approves. The MCP endpoint is /mcp.
 */

export const SCOPE = "studio:draft";
const providers = new Map<string, OAuthProvider<Env>>();

type Studio = (req: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

export function studioProvider(env: Env, studio: Studio): OAuthProvider<Env> {
  const origin = env.ROOT_DOMAIN === "localhost" ? "http://localhost:8787" : `https://studio.${env.ROOT_DOMAIN}`;
  let p = providers.get(origin);
  if (!p) {
    p = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler: {
        fetch: async (req: Request, e: Env, ctx: any) => handleMcp(req, e, String(ctx?.props?.email || "")),
      } as any,
      defaultHandler: { fetch: (req: Request, e: Env, ctx: ExecutionContext) => studio(req, e, ctx) } as any,
      authorizeEndpoint: "/oauth/authorize",
      tokenEndpoint: "/oauth/token",
      clientRegistrationEndpoint: "/oauth/register",
      clientIdMetadataDocumentEnabled: true,
      scopesSupported: [SCOPE],
      resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: [SCOPE], resource_name: "Studio" },
      accessTokenTTL: 3600,
    } as any);
    providers.set(origin, p);
  }
  return p;
}

const CAN = [
  "See your brands, connected platforms, posting times and calendar",
  "Read your file library, and add files to it",
  "Save social posts and email campaigns as drafts, and edit drafts",
  "See how your posts are doing (likes, reach, link clicks, sign-ups)",
];
const CANT = ["Post, schedule or send anything", "Delete anything", "See or change your contacts"];

function consentHtml(clientName: string, clientId: string, redirectHost: string, handle: string, email: string): string {
  const local = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/.test(redirectHost);
  const cimd = clientId.startsWith("https://");
  const publisher = cimd ? `Published by <b>${esc(new URL(clientId).hostname)}</b>.` : "This app registered itself, so its name isn’t verified.";
  return `<span class="eyebrow">Connect</span><h1>Let ${esc(clientName)} use Studio?</h1>
<p>${publisher} Access goes to <b>${esc(redirectHost)}</b>.</p>
${local ? `<p><b>This sends access to an app on your computer</b>, such as Claude Code. Continue only if you just started connecting from it.</p>` : ""}
<div><p style="margin:0 0 6px;color:var(--t1);font-weight:600">It will be able to</p><ul style="margin:0;padding-left:18px;color:var(--t2)">${CAN.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
<div><p style="margin:0 0 6px;color:var(--t1);font-weight:600">It can’t</p><ul style="margin:0;padding-left:18px;color:var(--t2)">${CANT.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
<form method="post" style="display:flex;flex-direction:column;gap:10px">
<input type="hidden" name="handle" value="${esc(handle)}">
<button type="submit" name="decision" value="approve">Allow</button>
<button type="submit" name="decision" value="deny" style="background:none;color:var(--t1);border-color:var(--line)">Don’t allow</button>
</form>
<p class="fine">Signed in as ${esc(email)}. You can disconnect any time from Claude’s connector settings.</p>`;
}

/** GET and POST /oauth/authorize on the studio host. */
export async function authorize(req: Request, env: Env & { OAUTH_PROVIDER?: OAuthHelpers }): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  if (!oauth) return new Response("Not available", { status: 404 });
  const email = await authEmail(req, env);
  if (!email) {
    const url = new URL(req.url);
    if (req.method !== "GET") return page("Signed out", `<h1>You’ve been signed out</h1><p>Start connecting again from Claude.</p>`, 401);
    const next = encodeURIComponent(url.pathname + url.search);
    return new Response(null, { status: 302, headers: {
      location: "/login?connect=1",
      "set-cookie": `studio_next=${next}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900${url.protocol === "https:" ? "; Secure" : ""}`,
    } });
  }
  try {
    if (req.method === "GET") {
      const ar = await oauth.parseAuthRequest(req);
      const client = await oauth.lookupClient(ar.clientId);
      if (!client) return page("Can’t connect", `<h1>That app isn’t recognised</h1><p>Start connecting again from Claude.</p>`, 400);
      const consent = await oauth.beginConsent(ar);
      const res = page("Connect", consentHtml(client.clientName || client.clientId, client.clientId, new URL(ar.redirectUri).hostname, consent.handle, email));
      consent.headers.forEach((v, k) => { if (k.toLowerCase() !== "content-type") res.headers.append(k, v); });
      return res;
    }
    if (req.method === "POST") {
      const form = await req.formData();
      const handle = String(form.get("handle") || "");
      if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(req, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(req, handle, { scope: [SCOPE] });
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request, userId: email, metadata: { connectedAt: Date.now() },
        scope: approved.request.scope.filter((x) => x === SCOPE).length ? [SCOPE] : [SCOPE], props: { email },
      });
      approved.headers.set("location", redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }
    return new Response("Method not allowed", { status: 405 });
  } catch (e) {
    if (e instanceof AuthorizationError && e.redirectUri) {
      const r = new URL(e.redirectUri);
      r.searchParams.set("error", e.code);
      r.searchParams.set("error_description", e.description);
      if (e.state) r.searchParams.set("state", e.state);
      if (e.issuer) r.searchParams.set("iss", e.issuer);
      return Response.redirect(r.href, 302);
    }
    if (e instanceof AuthorizationError || e instanceof CimdFetchError) {
      const msg = e instanceof AuthorizationError ? e.description : "That app couldn’t be verified.";
      return page("Can’t connect", `<h1>That didn’t work</h1><p>${esc(msg)}</p><p>Start connecting again from Claude.</p>`, 400);
    }
    throw e;
  }
}

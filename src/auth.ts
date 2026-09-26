import { Env } from "./util";
import { sessionEmail } from "./login";

let certCache: { at: number; keys: Record<string, CryptoKey> } | null = null;

async function keys(team: string): Promise<Record<string, CryptoKey>> {
  if (certCache && Date.now() - certCache.at < 3600_000) return certCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error("certs");
  const { keys: jwks } = await res.json<{ keys: Array<JsonWebKey & { kid: string }> }>();
  const out: Record<string, CryptoKey> = {};
  for (const k of jwks) {
    out[k.kid] = await crypto.subtle.importKey("jwk", k, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  }
  certCache = { at: Date.now(), keys: out };
  return out;
}

const b64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** Returns the signed-in email, or null. Only Cloudflare Access can issue a valid token. */
export async function authEmail(req: Request, env: Env): Promise<string | null> {
  if (env.DEV_AUTH === "1") return "dev@localhost";
  const fromSession = await sessionEmail(req, env);
  if (fromSession) return fromSession;
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const jwt = req.headers.get("cf-access-jwt-assertion");
  if (!jwt) return null;
  const [h, p, s] = jwt.split(".");
  if (!h || !p || !s) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64u(h)));
    const payload = JSON.parse(new TextDecoder().decode(b64u(p)));
    const k = (await keys(env.ACCESS_TEAM_DOMAIN))[header.kid];
    if (!k) return null;
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", k, b64u(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(env.ACCESS_AUD)) return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    if (payload.iss && payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
    return String(payload.email || "");
  } catch {
    return null;
  }
}

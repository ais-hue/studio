import { Env } from "../util";

/*
 * Tokens and app secrets are encrypted with AES-GCM before they go into the database.
 * The key comes from the SOCIAL_KEY secret when it's set (recommended: keeps the key out of the database).
 * Without it, Studio makes a random key once and keeps it in the settings table.
 * Each value records which key sealed it ("e1." = the secret, "s1." = the stored key), so adding the
 * secret later doesn't break tokens saved before it.
 */

const keys = new Map<string, Promise<CryptoKey>>();

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function importRaw(material: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("studio-social:" + material));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function storedMaterial(env: Env): Promise<string> {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = 'social_token_key'").first<{ value: string }>();
  if (r?.value) return r.value;
  const fresh = b64(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('social_token_key', ?) ON CONFLICT(key) DO NOTHING").bind(fresh).run();
  const again = await env.DB.prepare("SELECT value FROM settings WHERE key = 'social_token_key'").first<{ value: string }>();
  return again!.value;
}

function key(env: Env, kind: "e1" | "s1"): Promise<CryptoKey> {
  let k = keys.get(kind);
  if (!k) {
    k = (kind === "e1" ? importRaw(String(env.SOCIAL_KEY)) : storedMaterial(env).then(importRaw));
    k.catch(() => keys.delete(kind));
    keys.set(kind, k);
  }
  return k;
}

export async function seal(env: Env, plain: string): Promise<string> {
  const kind = env.SOCIAL_KEY ? "e1" : "s1";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(env, kind), new TextEncoder().encode(plain));
  return `${kind}.${b64(iv)}.${b64(ct)}`;
}

export async function open(env: Env, sealed: string | null | undefined): Promise<string> {
  if (!sealed) return "";
  const [kind, iv, ct] = sealed.split(".");
  if ((kind !== "e1" && kind !== "s1") || !iv || !ct) throw new Error("Unreadable stored token.");
  if (kind === "e1" && !env.SOCIAL_KEY) throw new Error("This token was saved with the SOCIAL_KEY secret, which is no longer set.");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(env, kind), unb64(ct));
  return new TextDecoder().decode(pt);
}

/** PKCE helpers. */
export function verifier(): string { return b64(crypto.getRandomValues(new Uint8Array(32))); }
export async function challenge(v: string): Promise<string> {
  return b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
}

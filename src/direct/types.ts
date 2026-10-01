import { Env } from "../util";

/* Shared shapes for the directly connected platforms. */

export interface App { platform: string; client_id: string; secret: string; options: Record<string, any> }

export interface Account {
  id: string; profile_id: string; platform: string; external_id: string; username: string; display_name: string; picture: string;
  token: string; refresh_token: string; secret: string; expires_at: number | null; refresh_expires_at: number | null;
  token_issued_at: number; meta: Record<string, any>; status: string;
}

export interface Tokens {
  token: string; refresh_token?: string | null; secret?: string | null;
  expires_at?: number | null; refresh_expires_at?: number | null; meta?: Record<string, any>;
}
export interface Profile { external_id: string; username: string; display_name: string; picture: string }
export type Connected = Tokens & Profile;

export interface Media { url: string; type: string; name?: string } // type: image | gif | video

export interface Job {
  env: Env; app: App; account: Account;
  text: string;                      // caption for this platform, links already tracked
  media: Media[];
  options: Record<string, any>;      // the post's options (pinterest, tiktok…)
  step: string; data: Record<string, any>;
}

/** Either the next step (optionally after a wait), or finished. */
export type StepResult =
  | { step: string; data?: Record<string, any>; wait?: number }
  | { done: true; external_id: string; url: string | null };

/** Won't work however often it's tried (bad media, rejected caption…). */
export class Permanent extends Error {}
/** The account's sign-in has lapsed or been revoked: connect it again. */
export class Reconnect extends Permanent {}
/** Worth another go later (rate limit, platform hiccup). */
export class Retry extends Error { constructor(msg: string, public wait = 0) { super(msg); } }
/** The access token was refused early: renew it, then try again. */
export class Stale extends Retry {}

export interface Provider {
  platform: string;
  label: string;
  /** "oauth": normal log-in screen. "password": handle + app password (Bluesky). */
  kind: "oauth" | "password";
  /** Where to set up the developer app, and the redirect URI it needs. Shown in Settings. */
  setup: { console: string; note: string; needsSecret: boolean };
  authorize?(app: App, redirect: string, state: string, challenge: string): string;
  exchange?(app: App, code: string, redirect: string, verifier: string): Promise<Connected>;
  login?(handle: string, password: string): Promise<Connected>;
  /** True when the access token should be renewed now. */
  needsRefresh(acc: Account, t: number): boolean;
  refresh?(app: App, acc: Account): Promise<Tokens>;
  step(job: Job): Promise<StepResult>;
  metrics?(app: App, acc: Account, ids: string[]): Promise<Record<string, Record<string, number>>>;
}

/** fetch + JSON, with platform errors sorted into retry / reconnect / give up. */
export async function call<T = any>(label: string, url: string, init: RequestInit = {}, classify?: (status: number, body: any) => Error | null): Promise<T> {
  let res: Response;
  try { res = await fetch(url, init); }
  catch (e) { throw new Retry(`${label} couldn’t be reached (${(e as Error).message}).`, 60_000); }
  const text = await res.text();
  let body: any = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text.slice(0, 300) }; }
  const custom = classify?.(res.status, body);
  if (custom) throw custom;
  if (res.ok) return body as T;
  const msg = errMessage(body) || `${label} answered ${res.status}.`;
  if (res.status === 401) throw new Reconnect(`${label} sign-in has expired. Connect the account again. (${msg})`);
  if (res.status === 429) throw new Retry(`${label} is rate limiting Studio: ${msg}`, 15 * 60_000);
  if (res.status >= 500) throw new Retry(`${label} had a problem: ${msg}`, 2 * 60_000);
  throw new Permanent(`${label}: ${msg}`);
}

export function errMessage(body: any): string {
  if (!body || typeof body !== "object") return "";
  const e = body.error;
  return String(
    (e && typeof e === "object" && (e.error_user_msg || e.message || e.code)) || (typeof e === "string" && (body.error_description || body.message || e)) ||
    body.message || body.error_description || body.detail || "",
  ).slice(0, 400);
}

export const form = (o: Record<string, string | number | boolean | undefined | null>) => {
  const f = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) f.set(k, String(v));
  return f;
};

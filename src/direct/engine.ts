import { Env, HttpError, id, now } from "../util";
import { trackText } from "../links";
import { tagFor } from "../initiatives";
import { open, seal, verifier as newVerifier, challenge } from "./crypto";
import { Account, App, Connected, Job, Media, Permanent, Provider, Reconnect, Retry, Stale, StepResult, Tokens } from "./types";
import { instagram, threads } from "./meta";
import { tiktok, creatorInfo } from "./tiktok";
import { pinterest, boards } from "./pinterest";
import { bluesky } from "./bluesky";
import { simulated, PROVIDERS_SIM } from "./simulate";

/*
 * Studio's own posting engine.
 * - Accounts are connected through Studio's own developer app on each platform (or an app password for Bluesky)
 *   and stored in social_accounts with encrypted tokens.
 * - Publishing a post makes one social_deliveries row per directly connected account. The every-minute cron
 *   works through them step by step (upload, wait for processing, publish), so long video processing never
 *   holds up a request, and a failure on one platform doesn't stop the others.
 * - The post's overall status combines its deliveries with whatever part of it went through Zernio.
 */

export const PROVIDERS: Record<string, Provider> = { instagram, threads, tiktok, pinterest, bluesky };

const parse = <T>(s: string | null | undefined, d: T): T => { try { return s ? JSON.parse(s) as T : d; } catch { return d; } };
export const isDirect = (accountId: string) => accountId.startsWith("sa_");

/* ---------- developer apps ---------- */

interface AppRow { platform: string; client_id: string; secret: string; options: string; updated_at: number }

export async function getApp(env: Env, platform: string): Promise<App | null> {
  const r = await env.DB.prepare("SELECT * FROM social_apps WHERE platform = ?").bind(platform).first<AppRow>();
  if (!r) return null;
  return { platform, client_id: r.client_id, secret: await open(env, r.secret), options: parse(r.options, {}) };
}

/** Is posting to this platform set up to go straight from Studio? */
export async function directReady(env: Env, platform: string): Promise<boolean> {
  const p = PROVIDERS[platform];
  if (!p) return false;
  if (p.kind === "password") return true;
  return !!(await env.DB.prepare("SELECT 1 FROM social_apps WHERE platform = ?").bind(platform).first());
}

export async function appsStatus(env: Env, origin: string) {
  const { results } = await env.DB.prepare("SELECT platform, client_id, options, updated_at FROM social_apps").all<AppRow>();
  const { results: counts } = await env.DB.prepare("SELECT platform, COUNT(*) AS n, SUM(status = 'reconnect') AS bad FROM social_accounts GROUP BY platform").all<{ platform: string; n: number; bad: number }>();
  return Object.values(PROVIDERS).map((p) => {
    const r = results.find((x) => x.platform === p.platform);
    const c = counts.find((x) => x.platform === p.platform);
    return {
      platform: p.platform, label: p.label, kind: p.kind, console: p.setup.console, note: p.setup.note, needsSecret: p.setup.needsSecret,
      redirect: p.kind === "oauth" ? redirectUri(origin, p.platform) : null,
      configured: p.kind === "password" || !!r, client_id: r?.client_id || "", options: parse(r?.options, {}),
      accounts: c?.n || 0, needsReconnect: c?.bad || 0,
    };
  });
}

export async function saveApp(env: Env, platform: string, d: { client_id?: string; secret?: string; options?: Record<string, unknown> }): Promise<void> {
  const p = PROVIDERS[platform];
  if (!p || p.kind !== "oauth") throw new HttpError(400, "That platform doesn’t use a developer app.");
  const client = String(d.client_id || "").trim();
  const existing = await env.DB.prepare("SELECT secret FROM social_apps WHERE platform = ?").bind(platform).first<{ secret: string }>();
  if (!client) { // clearing the app
    const used = await env.DB.prepare("SELECT COUNT(*) AS n FROM social_accounts WHERE platform = ?").bind(platform).first<{ n: number }>();
    if (used?.n) throw new HttpError(409, `Disconnect the ${p.label} accounts that use this app first.`);
    await env.DB.prepare("DELETE FROM social_apps WHERE platform = ?").bind(platform).run();
    return;
  }
  if (!/^[\w.\-:]{4,200}$/.test(client)) throw new HttpError(400, "That app ID doesn’t look right.");
  const secret = String(d.secret || "").trim();
  if (!secret && !existing) throw new HttpError(400, "Paste the app secret too.");
  const options = { sandbox: !!d.options?.sandbox };
  await env.DB.prepare(`INSERT INTO social_apps (platform, client_id, secret, options, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(platform) DO UPDATE SET client_id = excluded.client_id, secret = excluded.secret, options = excluded.options, updated_at = excluded.updated_at`)
    .bind(platform, client, secret ? await seal(env, secret) : existing!.secret, JSON.stringify(options), now()).run();
}

/* ---------- accounts ---------- */

interface AccountRow {
  id: string; profile_id: string; platform: string; external_id: string; username: string; display_name: string; picture: string;
  token: string; refresh_token: string | null; secret: string | null; expires_at: number | null; refresh_expires_at: number | null;
  token_issued_at: number; meta: string; status: string; status_note: string | null;
}

async function decode(env: Env, r: AccountRow): Promise<Account> {
  return {
    id: r.id, profile_id: r.profile_id, platform: r.platform, external_id: r.external_id, username: r.username, display_name: r.display_name, picture: r.picture,
    token: await open(env, r.token), refresh_token: await open(env, r.refresh_token), secret: await open(env, r.secret),
    expires_at: r.expires_at, refresh_expires_at: r.refresh_expires_at, token_issued_at: r.token_issued_at, meta: parse(r.meta, {}), status: r.status,
  };
}

export async function getAccount(env: Env, accountId: string): Promise<Account> {
  const r = await env.DB.prepare("SELECT * FROM social_accounts WHERE id = ?").bind(accountId).first<AccountRow>();
  if (!r) throw new HttpError(404, "That account isn’t connected any more.");
  return decode(env, r);
}

/** Directly connected accounts for a brand, in the same shape as Zernio's. */
export async function listDirect(env: Env, profileId: string) {
  const { results } = await env.DB.prepare("SELECT id, platform, username, display_name, picture, status, status_note FROM social_accounts WHERE profile_id = ? ORDER BY platform")
    .bind(profileId).all<AccountRow>();
  return results.map((a) => ({
    _id: a.id, platform: a.platform, username: a.username, displayName: a.display_name, picture: a.picture,
    active: a.status === "ok", via: "studio" as const, note: a.status_note || "",
  }));
}

async function saveConnected(env: Env, platform: string, profileId: string, c: Connected): Promise<{ id: string; username: string }> {
  if (!c.external_id) throw new HttpError(502, `${PROVIDERS[platform].label} didn’t say which account signed in. Try again.`);
  const t = now();
  const existing = await env.DB.prepare("SELECT id FROM social_accounts WHERE profile_id = ? AND platform = ?").bind(profileId, platform).first<{ id: string }>();
  const aid = existing?.id || id("sa_");
  await env.DB.prepare(`INSERT INTO social_accounts (id, profile_id, platform, external_id, username, display_name, picture, token, refresh_token, secret,
      expires_at, refresh_expires_at, token_issued_at, meta, status, status_note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', NULL, ?, ?)
    ON CONFLICT(id) DO UPDATE SET external_id = excluded.external_id, username = excluded.username, display_name = excluded.display_name, picture = excluded.picture,
      token = excluded.token, refresh_token = excluded.refresh_token, secret = excluded.secret, expires_at = excluded.expires_at,
      refresh_expires_at = excluded.refresh_expires_at, token_issued_at = excluded.token_issued_at, meta = excluded.meta, status = 'ok', status_note = NULL, updated_at = excluded.updated_at`)
    .bind(aid, profileId, platform, c.external_id, c.username || "", c.display_name || "", c.picture || "",
      await seal(env, c.token), c.refresh_token ? await seal(env, c.refresh_token) : null, c.secret ? await seal(env, c.secret) : null,
      c.expires_at ?? null, c.refresh_expires_at ?? null, t, JSON.stringify(c.meta || {}), t, t).run();
  // A reconnected account picks its stuck posts back up.
  if (existing) await env.DB.prepare("UPDATE social_deliveries SET locked_until = 0 WHERE account_id = ? AND status IN ('queued','working')").bind(aid).run();
  return { id: aid, username: c.username };
}

export const redirectUri = (origin: string, platform: string) => `${origin}/social/callback/${platform}`;

/** The platform's log-in screen, for linking an account to a brand. */
export async function startConnect(env: Env, platform: string, profileId: string, origin: string): Promise<string> {
  const p = PROVIDERS[platform];
  if (!p?.authorize) throw new HttpError(400, "That platform connects with an app password instead.");
  const app = await getApp(env, platform);
  if (!app) throw new HttpError(409, `Set up Studio’s ${p.label} app in Settings first.`);
  const state = id("st_"), v = newVerifier();
  await env.DB.prepare("DELETE FROM social_oauth WHERE created_at < ?").bind(now() - 15 * 60_000).run();
  await env.DB.prepare("INSERT INTO social_oauth (state, platform, profile_id, verifier, created_at) VALUES (?, ?, ?, ?, ?)").bind(state, platform, profileId, v, now()).run();
  if (simulated(env, app)) return `${redirectUri(origin, platform)}?state=${state}&code=simulated`;
  return p.authorize(app, redirectUri(origin, platform), state, await challenge(v));
}

/** Back from the platform's log-in screen. Returns where to send the person next. */
export async function finishConnect(env: Env, platform: string, url: URL, origin: string): Promise<string> {
  const state = url.searchParams.get("state") || "";
  const row = await env.DB.prepare("SELECT * FROM social_oauth WHERE state = ?").bind(state).first<{ platform: string; profile_id: string; verifier: string; created_at: number }>();
  if (row) await env.DB.prepare("DELETE FROM social_oauth WHERE state = ?").bind(state).run();
  const back = (brand: string, q: Record<string, string>) => `/#/social${brand ? "/b/" + encodeURIComponent(brand) : ""}?${new URLSearchParams(q)}`;
  if (!row || row.platform !== platform || now() - row.created_at > 15 * 60_000) return back("", { error: "expired", error_message: "That sign-in took too long or was already used. Try connecting again." });
  const denied = url.searchParams.get("error_description") || url.searchParams.get("error_message") || url.searchParams.get("error");
  if (denied) return back(row.profile_id, { error: "denied", error_message: denied.slice(0, 200) });
  const code = url.searchParams.get("code") || "";
  if (!code) return back(row.profile_id, { error: "nocode", error_message: "The platform didn’t send a sign-in code back." });
  try {
    const app = (await getApp(env, platform))!;
    const c = simulated(env, app) ? await PROVIDERS_SIM.exchange(platform) : await PROVIDERS[platform].exchange!(app, code, redirectUri(origin, platform), row.verifier);
    const a = await saveConnected(env, platform, row.profile_id, c);
    return back(row.profile_id, { connected: platform, username: a.username });
  } catch (e) {
    console.error("Connect failed", platform, (e as Error).message);
    return back(row.profile_id, { error: "failed", error_message: (e as Error).message.slice(0, 200) });
  }
}

/** Bluesky: handle + app password. */
export async function connectPassword(env: Env, platform: string, profileId: string, handle: string, password: string) {
  const p = PROVIDERS[platform];
  if (!p?.login) throw new HttpError(400, "That platform connects with its log-in screen.");
  try {
    const c = env.DEV_AUTH === "1" && /\.simulate$/.test(handle) ? await PROVIDERS_SIM.exchange(platform, handle) : await p.login(handle, password);
    return await saveConnected(env, platform, profileId, c);
  } catch (e) {
    if (e instanceof Permanent || e instanceof Retry) throw new HttpError(400, e.message);
    throw e;
  }
}

export async function disconnectDirect(env: Env, accountId: string): Promise<void> {
  const t = now();
  const { results } = await env.DB.prepare("SELECT post_id FROM social_deliveries WHERE account_id = ? AND status IN ('queued','working')").bind(accountId).all<{ post_id: string }>();
  await env.DB.batch([
    env.DB.prepare("UPDATE social_deliveries SET status = 'failed', error = 'The account was disconnected.', updated_at = ? WHERE account_id = ? AND status IN ('queued','working')").bind(t, accountId),
    env.DB.prepare("DELETE FROM social_accounts WHERE id = ?").bind(accountId),
  ]);
  for (const r of results) await combine(env, r.post_id);
}

export async function directBoards(env: Env, accountId: string) {
  const acc = await fresh(env, await getAccount(env, accountId));
  const app = (await getApp(env, acc.platform))!;
  if (simulated(env, app)) return [{ id: "sim_b1", name: "Simulated board" }];
  return wrap(() => boards(app, acc));
}

export async function directTiktokInfo(env: Env, accountId: string) {
  const acc = await fresh(env, await getAccount(env, accountId));
  const app = (await getApp(env, acc.platform))!;
  const info = simulated(env, app) ? { privacy: ["SELF_ONLY", "PUBLIC_TO_EVERYONE"], maxDuration: 600, commentsOff: false, duetOff: false, stitchOff: false }
    : await wrap(() => creatorInfo(acc));
  return { privacy: info.privacy, labels: {} as Record<string, string>, maxDuration: info.maxDuration, commentsOff: info.commentsOff, duetOff: info.duetOff, stitchOff: info.stitchOff, canPostMore: true };
}

async function wrap<T>(f: () => Promise<T>): Promise<T> {
  try { return await f(); }
  catch (e) { if (e instanceof Permanent || e instanceof Retry) throw new HttpError(502, e.message); throw e; }
}

/* ---------- tokens ---------- */

async function markReconnect(env: Env, accountId: string, note: string) {
  await env.DB.prepare("UPDATE social_accounts SET status = 'reconnect', status_note = ?, updated_at = ? WHERE id = ?").bind(note.slice(0, 300), now(), accountId).run();
}

async function storeTokens(env: Env, acc: Account, t: Tokens): Promise<Account> {
  const next: Account = {
    ...acc, token: t.token, refresh_token: t.refresh_token ?? acc.refresh_token, secret: t.secret ?? acc.secret,
    expires_at: t.expires_at ?? acc.expires_at, refresh_expires_at: t.refresh_expires_at ?? acc.refresh_expires_at,
    meta: { ...acc.meta, ...(t.meta || {}) }, token_issued_at: now(),
  };
  await env.DB.prepare(`UPDATE social_accounts SET token = ?, refresh_token = ?, secret = ?, expires_at = ?, refresh_expires_at = ?, token_issued_at = ?, meta = ?, status = 'ok', status_note = NULL, updated_at = ? WHERE id = ?`)
    .bind(await seal(env, next.token), next.refresh_token ? await seal(env, next.refresh_token) : null, next.secret ? await seal(env, next.secret) : null,
      next.expires_at, next.refresh_expires_at, next.token_issued_at, JSON.stringify(next.meta), now(), acc.id).run();
  return next;
}

/** Renew the token when it's due (or when forced). Marks the account for reconnecting if that fails for good. */
export async function fresh(env: Env, acc: Account, force = false): Promise<Account> {
  const p = PROVIDERS[acc.platform];
  if (!p?.refresh || (!force && !p.needsRefresh(acc, now()))) return acc;
  const app = p.kind === "oauth" ? await getApp(env, acc.platform) : ({ platform: acc.platform, client_id: "", secret: "", options: {} } as App);
  if (!app) throw new Reconnect(`Studio’s ${p.label} app isn’t set up any more.`);
  if (simulated(env, app) || acc.meta.simulated) return storeTokens(env, acc, { token: "sim_" + id(), expires_at: now() + 86400_000 });
  try { return await storeTokens(env, acc, await p.refresh(app, acc)); }
  catch (e) {
    if (e instanceof Reconnect) await markReconnect(env, acc.id, e.message);
    throw e;
  }
}

/** Keep tokens alive for accounts that haven't posted in a while (Instagram and Threads lapse after 60 days). */
export async function refreshDue(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(`SELECT * FROM social_accounts WHERE status = 'ok' AND expires_at IS NOT NULL AND expires_at < ? AND platform != 'bluesky'
    ORDER BY expires_at LIMIT 5`).bind(now() + 16 * 864e5).all<AccountRow>();
  let n = 0;
  for (const r of results) {
    try { const a = await decode(env, r); if (PROVIDERS[a.platform]?.needsRefresh(a, now())) { await fresh(env, a); n++; } }
    catch (e) { console.error("Token refresh failed", r.platform, r.id, (e as Error).message); }
  }
  return n;
}

/* ---------- publishing ---------- */

interface DeliveryRow {
  id: string; post_id: string; account_id: string; platform: string; status: string; step: string; data: string;
  attempts: number; next_at: number; locked_until: number; external_id: string | null; url: string | null; error: string | null;
}
interface PostRow {
  id: string; profile_id: string; content: string; media: string; targets: string; options: string; status: string;
  scheduled_at: number | null; published_at: number | null; zernio_id: string | null; zernio_status: string | null; zernio_results: string | null;
  results: string; initiative_id?: string | null;
}

/** The caption each platform gets, with links swapped for tracked ones (as for Zernio). */
async function captionFor(env: Env, p: PostRow, platform: string, brandName: string): Promise<{ text: string; link: string }> {
  const opts = parse<any>(p.options, {});
  let text = String(opts.captions?.[platform] || p.content);
  let link = platform === "pinterest" ? String(opts.pinterest?.link || "") : "";
  if (opts.track !== false) {
    const ctx = { source_type: "social", source_id: p.id, platform, profile_id: p.profile_id, campaign: (await tagFor(env, p.initiative_id)) || brandName };
    text = await trackText(env, text, ctx);
    if (link) link = (await trackText(env, link, ctx)).trim();
  }
  return { text, link };
}

/** Queue a post for its directly connected accounts, now or at a time. */
export async function enqueue(env: Env, p: PostRow, targets: Array<{ platform: string; accountId: string }>, at: number | null, brandName: string): Promise<void> {
  const t = now();
  const stmts: D1PreparedStatement[] = [env.DB.prepare("DELETE FROM social_deliveries WHERE post_id = ?").bind(p.id)];
  for (const tg of targets) {
    const acc = await env.DB.prepare("SELECT id, status FROM social_accounts WHERE id = ?").bind(tg.accountId).first<{ id: string; status: string }>();
    if (!acc) throw new HttpError(409, `The ${PROVIDERS[tg.platform]?.label || tg.platform} account on this post isn’t connected any more. Pick it again.`);
    if (acc.status !== "ok") throw new HttpError(409, `${PROVIDERS[tg.platform]?.label || tg.platform} needs reconnecting before Studio can post to it.`);
    const c = await captionFor(env, p, tg.platform, brandName);
    stmts.push(env.DB.prepare(`INSERT INTO social_deliveries (id, post_id, account_id, platform, status, step, data, next_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'queued', 'start', ?, ?, ?, ?)`).bind(id("dl_"), p.id, tg.accountId, tg.platform, JSON.stringify({ text: c.text, link: c.link }), at || t, t, t));
  }
  await env.DB.batch(stmts);
}

/** Try failed deliveries again from the beginning. */
export async function retryFailed(env: Env, postId: string): Promise<number> {
  const r = await env.DB.prepare(`UPDATE social_deliveries SET status = 'queued', step = 'start', attempts = 0, error = NULL, next_at = ?, locked_until = 0, updated_at = ?
    WHERE post_id = ? AND status = 'failed'`).bind(now(), now(), postId).run();
  return r.meta.changes || 0;
}

/** Pull back deliveries that haven't started. False if some are already under way. */
export async function cancelQueued(env: Env, postId: string): Promise<boolean> {
  const busy = await env.DB.prepare("SELECT 1 FROM social_deliveries WHERE post_id = ? AND (status != 'queued' OR step != 'start')").bind(postId).first();
  if (busy) return false;
  await env.DB.prepare("DELETE FROM social_deliveries WHERE post_id = ?").bind(postId).run();
  return true;
}

export async function moveQueued(env: Env, postId: string, at: number): Promise<void> {
  await env.DB.prepare("UPDATE social_deliveries SET next_at = ?, updated_at = ? WHERE post_id = ? AND status = 'queued' AND step = 'start'").bind(at, now(), postId).run();
}

export async function hasDeliveries(env: Env, postId: string): Promise<boolean> {
  return !!(await env.DB.prepare("SELECT 1 FROM social_deliveries WHERE post_id = ?").bind(postId).first());
}

const BUDGET_MS = 25_000;

/** Work through due deliveries. Called by the every-minute cron, and straight away for "post now". */
export async function runDeliveries(env: Env, onlyPost?: string): Promise<number> {
  const started = now();
  const { results } = onlyPost
    ? await env.DB.prepare("SELECT * FROM social_deliveries WHERE post_id = ? AND status IN ('queued','working') AND next_at <= ? AND locked_until < ?").bind(onlyPost, started + 1000, started).all<DeliveryRow>()
    : await env.DB.prepare("SELECT * FROM social_deliveries WHERE status IN ('queued','working') AND next_at <= ? AND locked_until < ? ORDER BY next_at LIMIT 12").bind(started, started).all<DeliveryRow>();
  const touched = new Set<string>();
  for (const d of results) {
    if (now() - started > 40_000) break;
    const lock = await env.DB.prepare("UPDATE social_deliveries SET locked_until = ? WHERE id = ? AND locked_until < ?").bind(now() + 5 * 60_000, d.id, now()).run();
    if (!lock.meta.changes) continue; // another run has it
    touched.add(d.post_id);
    await work(env, d);
  }
  for (const pid of touched) await combine(env, pid);
  return touched.size;
}

async function work(env: Env, d: DeliveryRow): Promise<void> {
  const t0 = now();
  const save = (o: Partial<DeliveryRow>) => {
    const f = { ...d, ...o };
    return env.DB.prepare(`UPDATE social_deliveries SET status = ?, step = ?, data = ?, attempts = ?, next_at = ?, locked_until = 0, external_id = ?, url = ?, error = ?, updated_at = ? WHERE id = ?`)
      .bind(f.status, f.step, f.data, f.attempts, f.next_at, f.external_id, f.url, f.error, now(), d.id).run();
  };
  const post = await env.DB.prepare("SELECT * FROM social_posts WHERE id = ?").bind(d.post_id).first<PostRow>();
  if (!post) { await env.DB.prepare("DELETE FROM social_deliveries WHERE id = ?").bind(d.id).run(); return; }
  let data = parse<Record<string, any>>(d.data, {});
  let step = d.step;
  try {
    let acc = await getAccount(env, d.account_id).catch(() => { throw new Permanent("The account was disconnected."); });
    if (acc.status !== "ok") throw new Reconnect(`${PROVIDERS[acc.platform]?.label || acc.platform} needs reconnecting.`);
    const p = PROVIDERS[d.platform];
    if (!p) throw new Permanent("Studio can’t post to that platform directly.");
    const app = p.kind === "oauth" ? await getApp(env, d.platform) : ({ platform: d.platform, client_id: "", secret: "", options: {} } as App);
    if (!app) throw new Permanent(`Studio’s ${p.label} app isn’t set up any more.`);
    acc = await fresh(env, acc);
    const options = parse<any>(post.options, {});
    if (d.platform === "pinterest") options.pinterest = { ...(options.pinterest || {}), link: data.link || "" };
    const run = simulated(env, app) || acc.meta.simulated ? PROVIDERS_SIM.step : p.step;
    for (let i = 0; i < 8; i++) {
      const job: Job = { env, app, account: acc, text: String(data.text ?? post.content), media: parse<Media[]>(post.media, []), options, step, data };
      const r: StepResult = await run(job);
      if ("done" in r) {
        await save({ status: "done", step: "done", data: JSON.stringify({ text: data.text, link: data.link }), external_id: r.external_id, url: r.url, error: null });
        return;
      }
      step = r.step;
      data = { ...(r.data || {}), text: data.text, link: data.link };
      if ((r.wait || 0) > 3000 || now() - t0 > BUDGET_MS) {
        await save({ status: "working", step, data: JSON.stringify(data), next_at: now() + (r.wait || 0) });
        return;
      }
      if (r.wait) await new Promise((res) => setTimeout(res, r.wait));
    }
    await save({ status: "working", step, data: JSON.stringify(data), next_at: now() });
  } catch (e) {
    const err = e as Error;
    if (e instanceof Stale && d.attempts < 3) {
      try { await fresh(env, await getAccount(env, d.account_id), true); } catch { /* reported on the next try */ }
      await save({ status: "working", step, data: JSON.stringify(data), attempts: d.attempts + 1, next_at: now() + 5_000, error: err.message });
      return;
    }
    if (e instanceof Reconnect) await markReconnect(env, d.account_id, err.message);
    const permanent = e instanceof Permanent || d.attempts >= 6;
    if (permanent) {
      await save({ status: "failed", step, data: JSON.stringify(data), error: err.message.slice(0, 500) });
      return;
    }
    const backoff = Math.max(e instanceof Retry ? e.wait : 0, 60_000 * 2 ** d.attempts);
    if (!(e instanceof Retry)) console.error("Delivery error", d.id, d.platform, err);
    await save({ status: d.status === "queued" && step === "start" ? "queued" : "working", step, data: JSON.stringify(data), attempts: d.attempts + 1, next_at: now() + backoff, error: err.message.slice(0, 500) });
  }
}

/* ---------- combined status ---------- */

const NAME = (pl: string) => PROVIDERS[pl]?.label || pl;

/**
 * Work out a post's status and per-platform results from its direct deliveries plus its Zernio part.
 * Posts with neither (drafts, or Zernio posts from before this engine) are left alone.
 */
export async function combine(env: Env, postId: string): Promise<void> {
  const p = await env.DB.prepare("SELECT * FROM social_posts WHERE id = ?").bind(postId).first<PostRow>();
  if (!p || p.status === "draft") return;
  const { results: dl } = await env.DB.prepare("SELECT * FROM social_deliveries WHERE post_id = ?").bind(postId).all<DeliveryRow>();
  if (!dl.length && !p.zernio_status) return;
  const t = now();
  const rows: Array<{ platform: string; status: string; url: string | null; error: string | null }> = [];
  if (p.zernio_status) {
    const zr = parse<Array<{ platform: string; status: string; url: string | null; error: string | null }>>(p.zernio_results, []);
    const mine = new Set(dl.map((d) => d.platform));
    const theirs = zr.filter((r) => !mine.has(r.platform));
    if (theirs.length) rows.push(...theirs.map((r) => ({ ...r, status: r.error ? "failed" : r.status || p.zernio_status! })));
    else rows.push({ platform: "zernio", status: p.zernio_status, url: null, error: null });
  }
  for (const d of dl) {
    const status = d.status === "done" ? "published" : d.status === "failed" ? "failed"
      : d.status === "queued" && d.step === "start" && d.next_at > t + 30_000 && !d.attempts ? "scheduled" : "publishing";
    rows.push({ platform: d.platform, status, url: d.url, error: d.status === "failed" ? d.error : d.status !== "done" && d.attempts ? `Retrying: ${d.error || ""}` : null });
  }
  const st = rows.map((r) => r.status === "partial" ? "published" : r.status === "cancelled" ? "failed" : r.status);
  const pending = st.filter((s) => s === "scheduled" || s === "publishing" || s === "pending");
  let status: string;
  if (st.every((s) => s === "published")) status = "published";
  else if (pending.length) status = st.some((s) => s === "publishing" || s === "published" || s === "failed") || pending.some((s) => s !== "scheduled") ? "publishing" : "scheduled";
  else status = st.some((s) => s === "published") ? "partial" : "failed";
  const errors = rows.filter((r) => r.error && r.status === "failed").map((r) => `${NAME(r.platform)}: ${r.error}`);
  const shown = rows.filter((r) => r.platform !== "zernio").map((r) => ({ platform: r.platform, status: r.status, url: r.url, error: r.error }));
  await env.DB.prepare(`UPDATE social_posts SET status = ?, results = ?, error = ?, published_at = CASE WHEN ? THEN COALESCE(published_at, ?) ELSE published_at END, updated_at = ? WHERE id = ?`)
    .bind(status, JSON.stringify(shown), errors.join(" · ") || null, status === "published" || status === "partial" ? 1 : 0, t, t, postId).run();
}

/* ---------- performance ---------- */

/** Numbers for directly published posts from the last 90 days, merged into each post's metrics. */
export async function directMetrics(env: Env): Promise<number> {
  const since = now() - 90 * 864e5;
  const { results } = await env.DB.prepare(`SELECT d.post_id, d.account_id, d.platform, d.external_id, p.metrics FROM social_deliveries d JOIN social_posts p ON p.id = d.post_id
    WHERE d.status = 'done' AND d.external_id IS NOT NULL AND p.published_at > ?`).bind(since).all<{ post_id: string; account_id: string; platform: string; external_id: string; metrics: string | null }>();
  if (!results.length) return 0;
  const byAcc = new Map<string, typeof results>();
  for (const r of results) byAcc.set(r.account_id, [...(byAcc.get(r.account_id) || []), r]);
  const updates = new Map<string, Record<string, Record<string, number>>>();
  for (const [aid, rows] of byAcc) {
    try {
      let acc = await getAccount(env, aid);
      if (acc.status !== "ok") continue;
      const p = PROVIDERS[acc.platform];
      const app = p.kind === "oauth" ? await getApp(env, acc.platform) : ({ platform: acc.platform, client_id: "", secret: "", options: {} } as App);
      if (!app || !p.metrics) continue;
      acc = await fresh(env, acc);
      const nums = simulated(env, app) || acc.meta.simulated ? PROVIDERS_SIM.metrics(rows.map((r) => r.external_id)) : await p.metrics(app, acc, rows.map((r) => r.external_id));
      for (const r of rows) {
        const n = nums[r.external_id];
        if (!n || !Object.keys(n).length) continue;
        const m = updates.get(r.post_id) || parse<Record<string, Record<string, number>>>(r.metrics, {});
        m[r.platform] = n;
        updates.set(r.post_id, m);
      }
    } catch (e) { console.error("Direct metrics failed for", aid, (e as Error).message); }
  }
  const t = now();
  const st = env.DB.prepare("UPDATE social_posts SET metrics = ?, metrics_at = ? WHERE id = ?");
  const stmts = [...updates].map(([pid, m]) => st.bind(JSON.stringify(m), t, pid));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return stmts.length;
}

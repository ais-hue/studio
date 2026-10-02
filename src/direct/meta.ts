import { Account, App, Connected, Job, Media, Permanent, Provider, Reconnect, Retry, StepResult, Tokens, call, errMessage, form } from "./types";
import { transformed } from "./media";

/*
 * Instagram (Instagram API with Instagram Login) and Threads. Both publish the same way:
 * make a media "container" from a public URL, wait for it to be FINISHED, then publish it.
 * Carousels make one container per item first, then a parent container that lists them.
 * Tokens last 60 days and are renewed once they're a day old and within 15 days of running out.
 */

const DAY = 864e5;

/** Meta's error codes: 190 = token gone, 4/17/32/613 = rate limits, is_transient = try again. */
function metaError(label: string) {
  return (status: number, body: any): Error | null => {
    const e = body?.error;
    if (!e || typeof e !== "object") return null;
    const msg = `${label}: ${errMessage(body)}`;
    if (e.code === 190 || status === 401) return new Reconnect(`${label} sign-in has expired or was removed. Connect the account again.`);
    if ([4, 17, 32, 613].includes(Number(e.code)) || e.code === 9 || status === 429) return new Retry(msg, 30 * 60_000);
    if (e.is_transient || e.code === 1 || e.code === 2 || status >= 500) return new Retry(msg, 2 * 60_000);
    return new Permanent(msg);
  };
}

type Params = Record<string, string | boolean | undefined>;

interface Flow {
  label: string;
  base: string;
  create: (uid: string) => string;
  publish: (uid: string) => string;
  statusField: string;               // status_code (Instagram) or status (Threads)
  single(m: Media | null, text: string): Params;
  child(m: Media): Params;
  parent(ids: string[], text: string): Params;
}

const MAX_POLLS = 40; // containers checked every 30s for up to ~20 minutes

async function metaStep(f: Flow, job: Job): Promise<StepResult> {
  const { account, data } = job;
  const token = account.token, uid = account.external_id;
  const err = metaError(f.label);
  const post = (path: string, params: Params) =>
    call<any>(f.label, f.base + path, { method: "POST", body: form({ ...params, access_token: token }) }, err);
  const get = (path: string, fields: string) => call<any>(f.label, `${f.base}${path}?fields=${fields}&access_token=${encodeURIComponent(token)}`, {}, err);

  const statusOf = async (cid: string) => {
    const s = await get("/" + cid, f.statusField === "status" ? "status,error_message" : "status_code,status");
    return { state: String(s[f.statusField] || ""), detail: String(s.error_message || s.status || "") };
  };

  switch (job.step) {
    case "start": {
      if (job.media.length > 1) {
        const children: string[] = [];
        for (const m of job.media) children.push(String((await post(f.create(uid), f.child(m))).id));
        return { step: "children", data: { children, polls: 0 }, wait: 15_000 };
      }
      const c = await post(f.create(uid), f.single(job.media[0] || null, job.text));
      return { step: "container", data: { container: String(c.id), polls: 0 }, wait: job.media.some((m) => m.type === "video") ? 30_000 : 2_000 };
    }
    case "children": {
      for (const cid of data.children as string[]) {
        const s = await statusOf(cid);
        if (s.state === "ERROR" || s.state === "EXPIRED") throw new Permanent(`${f.label} couldn’t use one of the carousel items: ${s.detail || s.state}`);
        if (s.state !== "FINISHED") return wait(f, data);
      }
      const c = await post(f.create(uid), f.parent(data.children, job.text));
      return { step: "container", data: { ...data, container: String(c.id), polls: 0 }, wait: 2_000 };
    }
    case "container": {
      const s = await statusOf(data.container);
      if (s.state === "ERROR" || s.state === "EXPIRED") throw new Permanent(`${f.label} couldn’t process the post: ${s.detail || s.state}`);
      if (s.state !== "FINISHED" && s.state !== "PUBLISHED") return wait(f, data);
      return { step: "publish", data };
    }
    case "publish": {
      const r = await post(f.publish(uid), { creation_id: data.container });
      const mid = String(r.id);
      let url: string | null = null;
      try { url = String((await get("/" + mid, "permalink")).permalink || "") || null; } catch { url = null; }
      return { done: true, external_id: mid, url };
    }
  }
  throw new Permanent(`Unknown step ${job.step}.`);
}

function wait(f: Flow, data: Record<string, any>): StepResult {
  const polls = (data.polls || 0) + 1;
  if (polls > MAX_POLLS) throw new Permanent(`${f.label} was still processing the media after 20 minutes. Try a smaller file.`);
  return { step: data.container ? "container" : "children", data: { ...data, polls }, wait: 30_000 };
}

const refreshDue = (acc: Account, t: number) => !!acc.expires_at && acc.expires_at - t < 15 * DAY && t - acc.token_issued_at > DAY;

function insightNumbers(d: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of Array.isArray(d?.data) ? d.data : []) {
    const v = x.total_value?.value ?? x.values?.[0]?.value;
    if (typeof v === "number") out[x.name === "saved" ? "saves" : x.name] = v;
  }
  return out;
}

/* ---------- Instagram ---------- */

const IG = "https://graph.instagram.com/v23.0";
const igFlow = (env: Job["env"]): Flow => ({
  label: "Instagram", base: IG, statusField: "status_code",
  create: (uid) => `/${uid}/media`, publish: (uid) => `/${uid}/media_publish`,
  single: (m, text) => {
    if (!m) throw new Permanent("Instagram needs a picture or video.");
    if (m.type === "gif") throw new Permanent("Instagram doesn’t take GIFs. Use a video instead.");
    return m.type === "video" ? { media_type: "REELS", video_url: m.url, caption: text, share_to_feed: true } : { image_url: transformed(env, m.url, { jpeg: true }), caption: text };
  },
  child: (m) => {
    if (m.type === "gif") throw new Permanent("Instagram doesn’t take GIFs. Use a video instead.");
    return m.type === "video" ? { media_type: "VIDEO", video_url: m.url, is_carousel_item: true } : { image_url: transformed(env, m.url, { jpeg: true }), is_carousel_item: true };
  },
  parent: (ids, text) => ({ media_type: "CAROUSEL", children: ids.join(","), caption: text }),
});

export const instagram: Provider = {
  platform: "instagram", label: "Instagram", kind: "oauth",
  setup: {
    console: "https://developers.facebook.com/apps/",
    note: "A Meta app with the “Instagram API with Instagram Login” product (Business type). Use its Instagram app ID and secret, not the Meta app ID. The account must be a professional (Business or Creator) account. Until App Review, add your own Instagram accounts as Instagram testers on the app.",
    needsSecret: true,
  },
  authorize: (app, redirect, state) =>
    `https://www.instagram.com/oauth/authorize?${form({ client_id: app.client_id, redirect_uri: redirect, response_type: "code", state,
      scope: "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights" })}`,
  async exchange(app, code, redirect): Promise<Connected> {
    const err = metaError("Instagram");
    const short = await call<any>("Instagram", "https://api.instagram.com/oauth/access_token", { method: "POST", body: form({
      client_id: app.client_id, client_secret: app.secret, grant_type: "authorization_code", redirect_uri: redirect, code: code.replace(/#_$/, "") }) }, err);
    const s = Array.isArray(short.data) ? short.data[0] : short;
    const long = await call<any>("Instagram", `https://graph.instagram.com/access_token?${form({ grant_type: "ig_exchange_token", client_secret: app.secret, access_token: s.access_token })}`, {}, err);
    const me = await call<any>("Instagram", `${IG}/me?fields=user_id,username,name,profile_picture_url&access_token=${encodeURIComponent(long.access_token)}`, {}, err);
    return {
      token: long.access_token, expires_at: Date.now() + Number(long.expires_in || 5184000) * 1000,
      external_id: String(me.user_id || s.user_id), username: String(me.username || ""), display_name: String(me.name || me.username || ""), picture: String(me.profile_picture_url || ""),
    };
  },
  needsRefresh: refreshDue,
  async refresh(_app, acc): Promise<Tokens> {
    const r = await call<any>("Instagram", `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(acc.token)}`, {}, metaError("Instagram"));
    return { token: r.access_token, expires_at: Date.now() + Number(r.expires_in || 5184000) * 1000 };
  },
  step: (job) => metaStep(igFlow(job.env), job),
  async metrics(_app, acc, ids) {
    const out: Record<string, Record<string, number>> = {};
    for (const mid of ids) {
      const q = (m: string) => call<any>("Instagram", `${IG}/${mid}/insights?metric=${m}&access_token=${encodeURIComponent(acc.token)}`, {}, metaError("Instagram"));
      try { out[mid] = insightNumbers(await q("views,reach,likes,comments,shares,saved,total_interactions")); }
      catch (e) {
        if (e instanceof Reconnect) throw e;
        try { out[mid] = insightNumbers(await q("reach,likes,comments,shares,saved")); } catch { /* post deleted or too new */ }
      }
    }
    return out;
  },
};

/* ---------- Threads ---------- */

const TH = "https://graph.threads.net/v1.0";
const thFlow: Flow = {
  label: "Threads", base: TH, statusField: "status",
  create: (uid) => `/${uid}/threads`, publish: (uid) => `/${uid}/threads_publish`,
  single: (m, text) => !m ? { media_type: "TEXT", text }
    : m.type === "video" ? { media_type: "VIDEO", video_url: m.url, text } : { media_type: "IMAGE", image_url: m.url, text },
  child: (m) => m.type === "video" ? { media_type: "VIDEO", video_url: m.url, is_carousel_item: true } : { media_type: "IMAGE", image_url: m.url, is_carousel_item: true },
  parent: (ids, text) => ({ media_type: "CAROUSEL", children: ids.join(","), text }),
};

export const threads: Provider = {
  platform: "threads", label: "Threads", kind: "oauth",
  setup: {
    console: "https://developers.facebook.com/apps/",
    note: "A Meta app with the “Access the Threads API” use case. Use the Threads app ID and secret. Until App Review, add your own Threads accounts as Threads testers on the app.",
    needsSecret: true,
  },
  authorize: (app, redirect, state) =>
    `https://threads.net/oauth/authorize?${form({ client_id: app.client_id, redirect_uri: redirect, response_type: "code", state,
      scope: "threads_basic,threads_content_publish,threads_manage_insights" })}`,
  async exchange(app, code, redirect): Promise<Connected> {
    const err = metaError("Threads");
    const short = await call<any>("Threads", "https://graph.threads.net/oauth/access_token", { method: "POST", body: form({
      client_id: app.client_id, client_secret: app.secret, grant_type: "authorization_code", redirect_uri: redirect, code: code.replace(/#_$/, "") }) }, err);
    const long = await call<any>("Threads", `https://graph.threads.net/access_token?${form({ grant_type: "th_exchange_token", client_secret: app.secret, access_token: short.access_token })}`, {}, err);
    const me = await call<any>("Threads", `${TH}/me?fields=id,username,name,threads_profile_picture_url&access_token=${encodeURIComponent(long.access_token)}`, {}, err);
    return {
      token: long.access_token, expires_at: Date.now() + Number(long.expires_in || 5184000) * 1000,
      external_id: String(me.id || short.user_id), username: String(me.username || ""), display_name: String(me.name || me.username || ""), picture: String(me.threads_profile_picture_url || ""),
    };
  },
  needsRefresh: refreshDue,
  async refresh(_app, acc): Promise<Tokens> {
    const r = await call<any>("Threads", `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(acc.token)}`, {}, metaError("Threads"));
    return { token: r.access_token, expires_at: Date.now() + Number(r.expires_in || 5184000) * 1000 };
  },
  step: (job) => metaStep(thFlow, job),
  async metrics(_app, acc, ids) {
    const out: Record<string, Record<string, number>> = {};
    for (const mid of ids) {
      try { out[mid] = insightNumbers(await call<any>("Threads", `${TH}/${mid}/insights?metric=views,likes,replies,reposts,quotes,shares&access_token=${encodeURIComponent(acc.token)}`, {}, metaError("Threads"))); }
      catch (e) { if (e instanceof Reconnect) throw e; }
    }
    return out;
  },
};

export type { App };

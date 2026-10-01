import { Account, App, Connected, Job, Permanent, Provider, Reconnect, Retry, StepResult, Tokens, call, errMessage, form } from "./types";
import { bytes, sizeOf } from "./media";

/*
 * Pinterest API v5. Picture pins are made from a public URL; video pins are uploaded to Pinterest first
 * and checked on until they're processed. With trial access, set "sandbox" on the app: pins then go to
 * Pinterest's sandbox, where only you can see them. Access tokens last 30 days; with continuous refresh
 * the refresh token renews itself each time it's used.
 */

const DAY = 864e5;
const base = (app: App) => app.options?.sandbox ? "https://api-sandbox.pinterest.com/v5" : "https://api.pinterest.com/v5";

const pinError = (status: number, body: any): Error | null => {
  if (status < 400) return null;
  const msg = `Pinterest: ${errMessage(body) || status}`;
  if (status === 401) return new Reconnect("Pinterest sign-in has expired. Connect the account again.");
  if (status === 429) return new Retry(msg, 15 * 60_000);
  if (status >= 500) return new Retry(msg, 2 * 60_000);
  return new Permanent(msg);
};

const pin = <T = any>(app: App, acc: Account, path: string, init: RequestInit = {}) => call<T>("Pinterest", base(app) + path, {
  ...init, headers: { authorization: `Bearer ${acc.token}`, ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers || {}) },
}, pinError);

async function tokens(app: App, params: Record<string, string>): Promise<Tokens> {
  const r = await call<any>("Pinterest", "https://api.pinterest.com/v5/oauth/token", {
    method: "POST",
    headers: { authorization: "Basic " + btoa(`${app.client_id}:${app.secret}`), "content-type": "application/x-www-form-urlencoded" },
    body: form(params),
  }, (status, body) => status >= 400 ? (status >= 500 ? new Retry(`Pinterest: ${errMessage(body)}`, 60_000) : new Reconnect(`Pinterest: ${errMessage(body) || "sign-in refused"}`)) : null);
  const t = Date.now();
  return {
    token: r.access_token, ...(r.refresh_token ? { refresh_token: r.refresh_token } : {}),
    expires_at: t + Number(r.expires_in || 30 * 86400) * 1000,
    ...(r.refresh_token_expires_in ? { refresh_expires_at: t + Number(r.refresh_token_expires_in) * 1000 } : {}),
  };
}

export async function boards(app: App, acc: Account): Promise<Array<{ id: string; name: string }>> {
  const out: Array<{ id: string; name: string }> = [];
  let bookmark = "";
  for (let i = 0; i < 5; i++) {
    const d = await pin<any>(app, acc, `/boards?page_size=100${bookmark ? "&bookmark=" + encodeURIComponent(bookmark) : ""}`);
    for (const b of d.items || []) out.push({ id: String(b.id), name: String(b.name || "Board") });
    bookmark = d.bookmark || "";
    if (!bookmark) break;
  }
  return out;
}

export const pinterest: Provider = {
  platform: "pinterest", label: "Pinterest", kind: "oauth",
  setup: {
    console: "https://developers.pinterest.com/apps/",
    note: "A Pinterest developer app. Scopes: boards:read, boards:write, pins:read, pins:write, user_accounts:read. With trial access, tick “Sandbox”: pins then only appear in Pinterest’s sandbox. Request Standard access with a short video of connecting and pinning from Studio.",
    needsSecret: true,
  },
  authorize: (app, redirect, state) =>
    `https://www.pinterest.com/oauth/?${form({ client_id: app.client_id, redirect_uri: redirect, response_type: "code", state,
      scope: "boards:read,boards:write,pins:read,pins:write,user_accounts:read" })}`,
  async exchange(app, code, redirect): Promise<Connected> {
    const t = await tokens(app, { grant_type: "authorization_code", code, redirect_uri: redirect, continuous_refresh: "true" });
    const me = await call<any>("Pinterest", base(app) + "/user_account", { headers: { authorization: `Bearer ${t.token}` } }, pinError);
    return { ...t, external_id: String(me.id || me.username), username: String(me.username || ""), display_name: String(me.business_name || me.username || ""), picture: String(me.profile_image || "") };
  },
  needsRefresh: (acc, t) => !!acc.expires_at && acc.expires_at - t < 5 * DAY,
  refresh: (app, acc) => tokens(app, { grant_type: "refresh_token", refresh_token: acc.refresh_token }),

  async step(job: Job): Promise<StepResult> {
    const { app, account: acc, data } = job;
    const o = job.options.pinterest || {};
    const boardId = String(o.boardId || "");
    if (!boardId) throw new Permanent("Pick a Pinterest board.");
    const details = {
      board_id: boardId,
      description: job.text.slice(0, 800),
      ...(o.title ? { title: String(o.title).slice(0, 100) } : {}),
      ...(o.link ? { link: String(o.link) } : {}),
    };
    const done = (p: any): StepResult => ({ done: true, external_id: String(p.id), url: `https://www.pinterest.com/pin/${p.id}/` });

    switch (job.step) {
      case "start": {
        const video = job.media.find((m) => m.type === "video");
        if (video) {
          if (job.media.length > 1) throw new Permanent("A Pinterest video pin holds one video.");
          const { size } = await sizeOf(job.env, video.url);
          if (size > 95 * 1024 * 1024) throw new Permanent("Studio can send Pinterest videos up to 95 MB for now.");
          const reg = await pin<any>(app, acc, "/media", { method: "POST", body: JSON.stringify({ media_type: "video" }) });
          return { step: "upload", data: { media_id: String(reg.media_id), upload_url: reg.upload_url, params: reg.upload_parameters || {} } };
        }
        const pics = job.media.filter((m) => m.type === "image" || m.type === "gif");
        if (!pics.length) throw new Permanent("Pinterest needs a picture or video.");
        const media_source = pics.length === 1
          ? { source_type: "image_url", url: pics[0].url }
          : { source_type: "multiple_image_urls", items: pics.slice(0, 5).map((m) => ({ url: m.url })), index: 0 };
        return done(await pin<any>(app, acc, "/pins", { method: "POST", body: JSON.stringify({ ...details, media_source }) }));
      }
      case "upload": {
        const video = job.media.find((m) => m.type === "video")!;
        const file = await bytes(job.env, video.url);
        const f = new FormData();
        for (const [k, v] of Object.entries(data.params as Record<string, string>)) f.append(k, v);
        f.append("file", new Blob([file.data], { type: file.type || "video/mp4" }), video.name || "video.mp4");
        const res = await fetch(data.upload_url, { method: "POST", body: f });
        if (!res.ok && res.status !== 204) throw new Retry(`The upload to Pinterest didn’t go through (${res.status}).`, 60_000);
        return { step: "processing", data: { media_id: data.media_id, polls: 0 }, wait: 20_000 };
      }
      case "processing": {
        const m = await pin<any>(app, acc, `/media/${encodeURIComponent(data.media_id)}`);
        if (m.status === "failed") throw new Permanent("Pinterest couldn’t process the video.");
        if (m.status !== "succeeded") {
          const polls = (data.polls || 0) + 1;
          if (polls > 60) throw new Permanent("Pinterest was still processing the video after 30 minutes.");
          return { step: "processing", data: { ...data, polls }, wait: 30_000 };
        }
        return done(await pin<any>(app, acc, "/pins", { method: "POST", body: JSON.stringify({
          ...details, media_source: { source_type: "video_id", media_id: data.media_id, cover_image_key_frame_time: 1 },
        }) }));
      }
    }
    throw new Permanent(`Unknown step ${job.step}.`);
  },

  async metrics(app, acc, ids) {
    const out: Record<string, Record<string, number>> = {};
    const day = (t: number) => new Date(t).toISOString().slice(0, 10);
    for (const pid of ids) {
      try {
        const d = await pin<any>(app, acc, `/pins/${encodeURIComponent(pid)}/analytics?${form({
          start_date: day(Date.now() - 89 * DAY), end_date: day(Date.now()), metric_types: "IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK" })}`);
        const s = d?.all?.summary_metrics || {};
        out[pid] = { impressions: s.IMPRESSION || 0, saves: s.SAVE || 0, clicks: s.PIN_CLICK || 0, outbound_clicks: s.OUTBOUND_CLICK || 0 };
      } catch (e) { if (e instanceof Reconnect) throw e; }
    }
    return out;
  },
};

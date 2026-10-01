import { Account, Connected, Job, Permanent, Provider, Reconnect, Retry, StepResult, Tokens, call, form } from "./types";
import { bytes, sizeOf, transformed } from "./media";

/*
 * TikTok Content Posting API, Direct Post.
 * Videos are sent as bytes in chunks straight from the file library (FILE_UPLOAD), so no domain check is needed.
 * Photo posts can only be pulled from a URL, so files.<domain> must be verified as a URL prefix in the TikTok
 * developer portal before photo posts work.
 * Until the app passes TikTok's audit, every post is forced to private (SELF_ONLY).
 * Access tokens last 24 hours; refresh tokens a year.
 */

const API = "https://open.tiktokapis.com";
const CHUNK = 10 * 1024 * 1024;
const MAX_POLLS = 90;

const tkError = (status: number, body: any): Error | null => {
  const code = String(body?.error?.code || "");
  if ((!code || code === "ok") && status < 400) return null;
  const msg = `TikTok: ${body?.error?.message || code || status}`;
  if (code === "access_token_invalid" || code === "scope_not_authorized" || status === 401) return new Reconnect("TikTok sign-in has expired or lost permission. Connect the account again.");
  if (code === "rate_limit_exceeded" || status === 429) return new Retry(msg, 5 * 60_000);
  if (code === "spam_risk_too_many_posts" || code === "spam_risk_user_banned_from_posting") return new Permanent("TikTok has hit its daily posting limit for this account. Try again tomorrow.");
  if (code === "unaudited_client_can_only_post_to_private_accounts") return new Permanent("TikTok only lets Studio post to private accounts until its app passes TikTok’s audit. Set the TikTok account to private, or wait for the audit.");
  if (code === "url_ownership_unverified") return new Permanent(`TikTok photo posts need files.<your domain> verified as a URL prefix in the TikTok developer portal.`);
  if (status >= 500 || code === "internal_error") return new Retry(msg, 2 * 60_000);
  return new Permanent(msg);
};

const tk = <T = any>(acc: Account, path: string, body?: unknown) => call<T>("TikTok", API + path, {
  method: "POST", headers: { authorization: `Bearer ${acc.token}`, "content-type": "application/json; charset=UTF-8" }, body: JSON.stringify(body ?? {}),
}, tkError);

export interface CreatorInfo { privacy: string[]; maxDuration: number | null; commentsOff: boolean; duetOff: boolean; stitchOff: boolean; nickname: string; username: string }

export async function creatorInfo(acc: Account): Promise<CreatorInfo> {
  const d = (await tk<any>(acc, "/v2/post/publish/creator_info/query/")).data || {};
  return {
    privacy: Array.isArray(d.privacy_level_options) ? d.privacy_level_options.map(String) : ["SELF_ONLY"],
    maxDuration: Number(d.max_video_post_duration_sec) || null,
    commentsOff: !!d.comment_disabled, duetOff: !!d.duet_disabled, stitchOff: !!d.stitch_disabled,
    nickname: String(d.creator_nickname || ""), username: String(d.creator_username || ""),
  };
}

async function tokens(app: Job["app"], params: Record<string, string>): Promise<Tokens & { open_id?: string }> {
  const r = await call<any>("TikTok", API + "/v2/oauth/token/", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ client_key: app.client_id, client_secret: app.secret, ...params }),
  }, (status, body) => body?.error && typeof body.error === "string" ? (status >= 500 ? new Retry(`TikTok: ${body.error_description || body.error}`, 60_000) : new Reconnect(`TikTok: ${body.error_description || body.error}`)) : null);
  const t = Date.now();
  return {
    token: r.access_token, refresh_token: r.refresh_token, open_id: r.open_id,
    expires_at: t + Number(r.expires_in || 86400) * 1000, refresh_expires_at: t + Number(r.refresh_expires_in || 31536000) * 1000,
  };
}

export const tiktok: Provider = {
  platform: "tiktok", label: "TikTok", kind: "oauth",
  setup: {
    console: "https://developers.tiktok.com/apps/",
    note: "A TikTok developer app with Login Kit and the Content Posting API (Direct Post switched on). Scopes: user.info.basic, user.info.profile, video.publish, video.list. Until the audit, posts go out as private. For photo posts, verify files.<your domain> as a URL prefix.",
    needsSecret: true,
  },
  authorize: (app, redirect, state) =>
    `https://www.tiktok.com/v2/auth/authorize/?${form({ client_key: app.client_id, response_type: "code", redirect_uri: redirect, state,
      scope: "user.info.basic,user.info.profile,video.publish,video.list" })}`,
  async exchange(app, code, redirect): Promise<Connected> {
    const t = await tokens(app, { code, grant_type: "authorization_code", redirect_uri: redirect });
    let user: any = {};
    try {
      user = (await call<any>("TikTok", `${API}/v2/user/info/?fields=open_id,avatar_url,display_name,username`, { headers: { authorization: `Bearer ${t.token}` } }, tkError)).data?.user || {};
    } catch (e) { if (e instanceof Reconnect) throw e; }
    return { ...t, external_id: String(user.open_id || t.open_id || ""), username: String(user.username || ""), display_name: String(user.display_name || user.username || ""), picture: String(user.avatar_url || "") };
  },
  needsRefresh: (acc, t) => !!acc.expires_at && acc.expires_at - t < 2 * 3600_000,
  refresh: (app, acc) => tokens(app, { grant_type: "refresh_token", refresh_token: acc.refresh_token }),

  async step(job: Job): Promise<StepResult> {
    const { account: acc, data } = job;
    const o = job.options.tiktok || {};
    switch (job.step) {
      case "start": {
        const info = await creatorInfo(acc);
        const privacy = String(o.privacy_level || "");
        if (!privacy) throw new Permanent("Choose who can see it on TikTok.");
        if (!info.privacy.includes(privacy)) throw new Permanent(`TikTok won’t take that privacy setting for this account right now. It allows: ${info.privacy.join(", ")}.`);
        const video = job.media.find((m) => m.type === "video");
        if (video) {
          if (job.media.length > 1) throw new Permanent("TikTok takes one video, or photos only.");
          const { size } = await sizeOf(job.env, video.url);
          if (!size) throw new Permanent("Couldn’t tell how big the video is.");
          const chunk = size < 5 * 1024 * 1024 ? size : CHUNK;
          const count = Math.max(1, Math.floor(size / chunk));
          const r = await tk<any>(acc, "/v2/post/publish/video/init/", {
            post_info: {
              title: job.text.slice(0, 2200), privacy_level: privacy,
              disable_comment: info.commentsOff || o.allow_comment === false,
              disable_duet: info.duetOff || o.allow_duet === false,
              disable_stitch: info.stitchOff || o.allow_stitch === false,
              brand_content_toggle: false, brand_organic_toggle: !!o.brand,
            },
            source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunk, total_chunk_count: count },
          });
          return { step: "upload", data: { publish_id: r.data.publish_id, upload_url: r.data.upload_url, size, chunk, count, next: 0, username: info.username } };
        }
        const photos = job.media.filter((m) => m.type === "image");
        if (!photos.length) throw new Permanent("TikTok needs a video or photos.");
        if (photos.length > 35) throw new Permanent("TikTok photo posts hold up to 35 photos.");
        const first = job.text.split("\n")[0].trim();
        const r = await tk<any>(acc, "/v2/post/publish/content/init/", {
          post_info: {
            title: first.slice(0, 90), description: job.text.slice(0, 4000), privacy_level: privacy,
            disable_comment: info.commentsOff || o.allow_comment === false, auto_add_music: true,
            brand_content_toggle: false, brand_organic_toggle: !!o.brand,
          },
          source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: photos.map((m) => transformed(job.env, m.url, { jpeg: true })) },
          post_mode: "DIRECT_POST", media_type: "PHOTO",
        });
        return { step: "status", data: { publish_id: r.data.publish_id, polls: 0, username: info.username }, wait: 10_000 };
      }
      case "upload": {
        const video = job.media.find((m) => m.type === "video")!;
        let next = Number(data.next) || 0;
        const started = Date.now();
        while (next < data.count && Date.now() - started < 20_000) {
          const start = next * data.chunk;
          const end = next === data.count - 1 ? data.size - 1 : start + data.chunk - 1;
          const part = await bytes(job.env, video.url, { offset: start, length: end - start + 1 });
          let res: Response;
          try {
            res = await fetch(data.upload_url, { method: "PUT", body: part.data, headers: {
              "content-type": /quicktime/.test(part.type) ? "video/quicktime" : /webm/.test(part.type) ? "video/webm" : "video/mp4",
              "content-range": `bytes ${start}-${end}/${data.size}`,
            } });
          } catch (e) { throw new Retry(`The upload to TikTok was interrupted (${(e as Error).message}).`, 30_000); }
          if (![200, 201, 206].includes(res.status)) {
            const body = await res.text();
            if (res.status === 404 || res.status === 403) throw new Permanent("TikTok’s upload link expired before the video finished uploading. Try again.");
            throw new Retry(`TikTok refused part ${next + 1} of the upload (${res.status} ${body.slice(0, 120)}).`, 30_000);
          }
          next++;
        }
        if (next < data.count) return { step: "upload", data: { ...data, next } };
        return { step: "status", data: { publish_id: data.publish_id, polls: 0, username: data.username }, wait: 15_000 };
      }
      case "status": {
        const d = (await tk<any>(acc, "/v2/post/publish/status/fetch/", { publish_id: data.publish_id })).data || {};
        const s = String(d.status || "");
        if (s === "FAILED") throw new Permanent(`TikTok couldn’t publish it: ${d.fail_reason || "no reason given"}.`);
        if (s === "PUBLISH_COMPLETE") {
          const ids: string[] = (d.publicaly_available_post_id || d.publicly_available_post_id || []).map(String);
          const vid = ids[0] || "";
          const user = data.username || acc.username;
          return { done: true, external_id: vid || String(data.publish_id), url: vid && user ? `https://www.tiktok.com/@${user}/video/${vid}` : null };
        }
        const polls = (data.polls || 0) + 1;
        if (polls > MAX_POLLS) throw new Permanent("TikTok was still processing the post after 30 minutes. Check the TikTok app.");
        return { step: "status", data: { ...data, polls }, wait: 20_000 };
      }
    }
    throw new Permanent(`Unknown step ${job.step}.`);
  },

  async metrics(_app, acc, ids) {
    const out: Record<string, Record<string, number>> = {};
    const real = ids.filter((x) => /^\d+$/.test(x)); // publish ids (private posts) have no public numbers
    for (let i = 0; i < real.length; i += 20) {
      const d = await call<any>("TikTok", `${API}/v2/video/query/?fields=id,like_count,comment_count,share_count,view_count`, {
        method: "POST", headers: { authorization: `Bearer ${acc.token}`, "content-type": "application/json" },
        body: JSON.stringify({ filters: { video_ids: real.slice(i, i + 20) } }),
      }, tkError);
      for (const v of d.data?.videos || []) out[String(v.id)] = { likes: v.like_count || 0, comments: v.comment_count || 0, shares: v.share_count || 0, views: v.view_count || 0 };
    }
    return out;
  },
};

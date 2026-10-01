import { Account, Connected, Job, Media, Permanent, Provider, Reconnect, Retry, Stale, StepResult, Tokens, call, errMessage } from "./types";
import { bytes, sizeOf, transformed } from "./media";

/*
 * Bluesky (AT Protocol). No developer app or review: the account owner makes an app password
 * (Settings → Privacy and security → App passwords) and pastes it into Studio once.
 * Studio signs in to the account's own server (PDS), keeps the session, and renews it; if the session
 * lapses it signs in again with the app password.
 * Pictures (up to 4, about 1 MB each) go up as blobs; a video goes through Bluesky's video service.
 */

const MAX_IMAGE = 976_000;
const VIDEO = "https://video.bsky.app";

const xrpcError = (status: number, body: any): Error | null => {
  if (status < 400) return null;
  const code = String(body?.error || "");
  const msg = `Bluesky: ${body?.message || code || status}`;
  if (code === "ExpiredToken" || code === "InvalidToken") return new Stale(msg, 0);
  if (code === "AuthenticationRequired" || code === "AccountTakedown" || code === "AccountDeactivated" || status === 401) return new Reconnect(`${msg}. Connect the account again.`);
  if (status === 429 || code === "RateLimitExceeded") return new Retry(msg, 15 * 60_000);
  if (status >= 500) return new Retry(msg, 2 * 60_000);
  return new Permanent(msg);
};

const jwtExp = (jwt: string): number | null => {
  try { const p = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return p.exp ? p.exp * 1000 : null; } catch { return null; }
};

async function resolvePds(handle: string): Promise<{ did: string; pds: string }> {
  const h = handle.replace(/^@/, "").trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) && !h.startsWith("did:")) throw new Permanent("That doesn’t look like a Bluesky handle (for example ciunas.bsky.social).");
  const did = h.startsWith("did:") ? h
    : String((await call<any>("Bluesky", `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(h)}`, {}, xrpcError)).did);
  const docUrl = did.startsWith("did:plc:") ? `https://plc.directory/${did}` : did.startsWith("did:web:") ? `https://${did.slice(8)}/.well-known/did.json` : "";
  if (!docUrl) throw new Permanent("Studio can’t work out where that Bluesky account lives.");
  const doc = await call<any>("Bluesky", docUrl, {}, xrpcError);
  const svc = (doc.service || []).find((s: any) => String(s.id).endsWith("#atproto_pds"));
  if (!svc?.serviceEndpoint) throw new Permanent("That Bluesky account has no server listed.");
  return { did, pds: String(svc.serviceEndpoint).replace(/\/+$/, "") };
}

function session(r: any, pds: string, password: string): Connected {
  return {
    token: r.accessJwt, refresh_token: r.refreshJwt, secret: password,
    expires_at: jwtExp(r.accessJwt) || Date.now() + 3600_000, refresh_expires_at: jwtExp(r.refreshJwt),
    meta: { pds, did: r.did, handle: r.handle },
    external_id: String(r.did), username: String(r.handle || ""), display_name: String(r.handle || ""), picture: "",
  };
}

async function signIn(pds: string, identifier: string, password: string): Promise<Connected> {
  const r = await call<any>("Bluesky", `${pds}/xrpc/com.atproto.server.createSession`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ identifier, password }),
  }, (status, body) => status === 401 || body?.error === "AuthenticationRequired"
    ? new Permanent("Bluesky didn’t accept that handle and app password.") : xrpcError(status, body));
  return session(r, pds, password);
}

/** Link and hashtag facets, with the UTF-8 byte offsets Bluesky wants. */
export function facets(text: string): any[] {
  const enc = new TextEncoder();
  const at = (i: number) => enc.encode(text.slice(0, i)).length;
  const out: any[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>"]+/g)) {
    const url = m[0].replace(/[.,;:!?)\]'"]+$/, "");
    out.push({ index: { byteStart: at(m.index!), byteEnd: at(m.index! + url.length) }, features: [{ $type: "app.bsky.richtext.facet#link", uri: url }] });
  }
  for (const m of text.matchAll(/(^|\s)#([^\s#.,;:!?()[\]'"]+)/g)) {
    const tag = m[2];
    if (/^\d+$/.test(tag) || tag.length > 64) continue;
    const start = m.index! + m[1].length;
    out.push({ index: { byteStart: at(start), byteEnd: at(start + 1 + tag.length) }, features: [{ $type: "app.bsky.richtext.facet#tag", tag }] });
  }
  return out;
}

const xrpc = <T = any>(acc: Account, path: string, init: RequestInit = {}) =>
  call<T>("Bluesky", `${acc.meta.pds}/xrpc/${path}`, { ...init, headers: { authorization: `Bearer ${acc.token}`, ...(init.headers || {}) } }, xrpcError);

async function imageBlob(job: Job, m: Media): Promise<any> {
  let file = await bytes(job.env, m.url);
  for (const shrink of [{ maxWidth: 2000, quality: 82 }, { maxWidth: 1400, quality: 72 }]) {
    if (file.data.byteLength <= MAX_IMAGE && /^image\/(jpeg|png|webp)$/.test(file.type)) break;
    const smaller = transformed(job.env, m.url, shrink);
    if (smaller === m.url) break;
    file = await bytes(job.env, smaller);
  }
  if (file.data.byteLength > MAX_IMAGE) throw new Permanent(`${m.name || "A picture"} is too big for Bluesky (about 1 MB at most).`);
  const r = await xrpc<any>(job.account, "com.atproto.repo.uploadBlob", { method: "POST", headers: { "content-type": file.type }, body: file.data });
  return r.blob;
}

async function createPost(job: Job, embed: any): Promise<StepResult> {
  const acc = job.account;
  const text = job.text;
  const record: any = { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString() };
  const f = facets(text);
  if (f.length) record.facets = f;
  if (embed) record.embed = embed;
  const r = await xrpc<any>(acc, "com.atproto.repo.createRecord", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo: acc.meta.did || acc.external_id, collection: "app.bsky.feed.post", record }),
  });
  const rkey = String(r.uri).split("/").pop();
  return { done: true, external_id: String(r.uri), url: `https://bsky.app/profile/${acc.meta.handle || acc.username || acc.external_id}/post/${rkey}` };
}

export const bluesky: Provider = {
  platform: "bluesky", label: "Bluesky", kind: "password",
  setup: { console: "https://bsky.app/settings/app-passwords", note: "No developer app needed. Connect each account with its handle and an app password made in Bluesky’s settings.", needsSecret: false },

  async login(handle: string, password: string): Promise<Connected> {
    if (!/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(password.trim())) throw new Permanent("Use an app password from Bluesky’s settings (it looks like abcd-efgh-ijkl-mnop), not your main password.");
    const { pds } = await resolvePds(handle);
    const c = await signIn(pds, handle.replace(/^@/, "").trim(), password.trim());
    try {
      const p = await call<any>("Bluesky", `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(c.external_id)}`, {}, xrpcError);
      c.display_name = String(p.displayName || p.handle || c.username); c.picture = String(p.avatar || "");
    } catch { /* profile is a nicety */ }
    return c;
  },
  needsRefresh: (acc, t) => !acc.expires_at || acc.expires_at - t < 10 * 60_000,
  async refresh(_app, acc): Promise<Tokens> {
    try {
      const r = await call<any>("Bluesky", `${acc.meta.pds}/xrpc/com.atproto.server.refreshSession`, { method: "POST", headers: { authorization: `Bearer ${acc.refresh_token}` } }, xrpcError);
      return session(r, acc.meta.pds, acc.secret);
    } catch (e) {
      if (!acc.secret || (e instanceof Retry && !(e instanceof Stale))) throw e;
      try { return await signIn(acc.meta.pds, acc.meta.did || acc.external_id, acc.secret); }
      catch { throw new Reconnect("Bluesky no longer accepts the saved app password. Connect the account again."); }
    }
  },

  async step(job: Job): Promise<StepResult> {
    const { account: acc, data } = job;
    switch (job.step) {
      case "start": {
        const video = job.media.find((m) => m.type === "video");
        if (video) {
          if (job.media.length > 1) throw new Permanent("A Bluesky post holds one video, or up to 4 pictures.");
          const { size } = await sizeOf(job.env, video.url);
          if (size > 100 * 1024 * 1024) throw new Permanent("Bluesky videos can be up to 100 MB.");
          const host = new URL(acc.meta.pds).host;
          const auth = await xrpc<any>(acc, `com.atproto.server.getServiceAuth?aud=${encodeURIComponent("did:web:" + host)}&lxm=com.atproto.repo.uploadBlob&exp=${Math.floor(Date.now() / 1000) + 1800}`);
          const file = await bytes(job.env, video.url);
          const res = await fetch(`${VIDEO}/xrpc/app.bsky.video.uploadVideo?did=${encodeURIComponent(acc.meta.did || acc.external_id)}&name=${encodeURIComponent((video.name || "video.mp4").replace(/[^\w.-]/g, "_"))}`, {
            method: "POST", headers: { authorization: `Bearer ${auth.token}`, "content-type": file.type || "video/mp4" }, body: file.data,
          });
          const body: any = await res.json().catch(() => ({}));
          const jobId = body.jobId || body.jobStatus?.jobId;
          if (!jobId) {
            if (res.status === 401 || res.status === 403) throw new Permanent(`Bluesky won’t take videos from this account yet: ${errMessage(body) || res.status}. The account needs a verified email.`);
            throw new Retry(`Bluesky’s video service: ${errMessage(body) || res.status}`, 2 * 60_000);
          }
          return { step: "video", data: { jobId, polls: 0 }, wait: 10_000 };
        }
        const pics = job.media.filter((m) => m.type === "image" || m.type === "gif");
        if (pics.length > 4) throw new Permanent("Bluesky posts hold up to 4 pictures.");
        if (!pics.length) return createPost(job, null);
        const images = [];
        for (const m of pics) images.push({ alt: "", image: await imageBlob(job, m) });
        return createPost(job, { $type: "app.bsky.embed.images", images });
      }
      case "video": {
        const d = await call<any>("Bluesky", `${VIDEO}/xrpc/app.bsky.video.getJobStatus?jobId=${encodeURIComponent(data.jobId)}`, {}, xrpcError);
        const s = d.jobStatus || d;
        if (s.state === "JOB_STATE_FAILED") throw new Permanent(`Bluesky couldn’t process the video: ${s.error || s.message || "no reason given"}.`);
        if (s.state !== "JOB_STATE_COMPLETED" || !s.blob) {
          const polls = (data.polls || 0) + 1;
          if (polls > 90) throw new Permanent("Bluesky was still processing the video after 15 minutes.");
          return { step: "video", data: { ...data, polls }, wait: 10_000 };
        }
        return createPost(job, { $type: "app.bsky.embed.video", video: s.blob });
      }
    }
    throw new Permanent(`Unknown step ${job.step}.`);
  },

  async metrics(_app, _acc, ids) {
    const out: Record<string, Record<string, number>> = {};
    for (let i = 0; i < ids.length; i += 25) {
      const q = ids.slice(i, i + 25).map((u) => "uris=" + encodeURIComponent(u)).join("&");
      const d = await call<any>("Bluesky", `https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?${q}`, {}, xrpcError);
      for (const p of d.posts || []) out[String(p.uri)] = { likes: p.likeCount || 0, reposts: p.repostCount || 0, replies: p.replyCount || 0, quotes: p.quoteCount || 0 };
    }
    return out;
  },
};

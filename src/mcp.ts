import { Env, HttpError, getSettings, id, isEmail, json, now } from "./util";
import { PLATFORMS, SocialPost, getSlots, listAccounts, listProfiles, nextSlot, problems } from "./social";
import { FileRow, fileUrl, storeBytes, storeStream, typeFromName } from "./files";
import { createUploadLink, uploadLinkStatus } from "./uploads";
import { performance } from "./performance";
import { linkStats } from "./links";
import { VERSION } from "./version";

/*
 * Studio as an MCP server for Claude (Streamable HTTP, JSON responses, no sessions).
 * Everything Claude can do here makes or reads drafts: nothing is posted, scheduled or emailed.
 * Aisling reviews and sends from Studio.
 */

const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const s = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);

type Tool = {
  name: string; title: string; description: string; inputSchema: Record<string, unknown>;
  readOnly?: boolean; run: (env: Env, a: any) => Promise<unknown>;
};

async function studioUrl(env: Env, hash: string) { return `https://studio.${env.ROOT_DOMAIN}/#/${hash}`; }

async function findBrand(env: Env, ref: string) {
  const brands = await listProfiles(env);
  const r = s(ref, 80).toLowerCase();
  const b = brands.find((x) => x._id === ref) || brands.find((x) => x.name.toLowerCase() === r) || (brands.length === 1 && !r ? brands[0] : null);
  if (!b) throw new HttpError(404, `No brand called “${ref}”. Brands: ${brands.map((x) => x.name).join(", ") || "none yet"}.`);
  return b;
}

const PLATFORM_ALIASES: Record<string, string> = { x: "twitter", twitter: "twitter", ig: "instagram", insta: "instagram", fb: "facebook" };
const normPlatform = (p: string) => { const k = s(p, 20).toLowerCase(); return PLATFORM_ALIASES[k] || k; };

async function mediaFromArgs(env: Env, a: any, folder: string): Promise<Array<{ url: string; type: string; name: string }>> {
  const out: Array<{ url: string; type: string; name: string }> = [];
  const ids: string[] = Array.isArray(a.file_ids) ? a.file_ids.slice(0, 20).map(String) : [];
  for (const fid of ids) {
    const f = await env.DB.prepare("SELECT * FROM files WHERE id = ? AND status = 'ready'").bind(fid).first<FileRow>();
    if (!f) throw new HttpError(404, `No file with id ${fid}. Use list_files or upload_file first.`);
    if (f.kind !== "image" && f.kind !== "video") throw new HttpError(400, `${f.name} isn’t an image or video.`);
    out.push({ url: fileUrl(env, f.key), type: f.kind === "video" ? "video" : f.type === "image/gif" ? "gif" : "image", name: f.name });
  }
  const urls: string[] = Array.isArray(a.image_urls) ? a.image_urls.slice(0, 10).map(String) : [];
  for (const u of urls) {
    const f = await importUrl(env, u, folder, "");
    out.push({ url: fileUrl(env, f.key), type: f.kind === "video" ? "video" : f.type === "image/gif" ? "gif" : "image", name: f.name });
  }
  return out;
}

async function importUrl(env: Env, u: string, folder: string, alt: string, name?: string): Promise<FileRow> {
  let url: URL;
  try { url = new URL(u); } catch { throw new HttpError(400, `That isn’t a link: ${u.slice(0, 100)}`); }
  if (url.protocol !== "https:") throw new HttpError(400, "Only https links can be imported.");
  if (url.hostname === `files.${env.ROOT_DOMAIN}`) {
    const f = await env.DB.prepare("SELECT * FROM files WHERE key = ?").bind(decodeURIComponent(url.pathname.slice(1))).first<FileRow>();
    if (f) return f;
  }
  // Share links from Google Drive and Dropbox: go straight to the file.
  const drive = url.hostname.endsWith("drive.google.com") && (url.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] || url.searchParams.get("id"));
  if (drive) url = new URL(`https://drive.usercontent.google.com/download?id=${drive}&export=download&confirm=t`);
  if (/(^|\.)dropbox\.com$/.test(url.hostname)) url.searchParams.set("dl", "1");
  const res = await fetch(url.toString(), { redirect: "follow", headers: { "user-agent": "Studio/1.0 (+https://studio." + env.ROOT_DOMAIN + ")" } });
  if (!res.ok || !res.body) throw new HttpError(502, `Couldn’t download ${url.hostname}: ${res.status}. If it’s private, make it “anyone with the link”, or use create_upload_link.`);
  let type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (type.startsWith("text/html")) throw new HttpError(400, `${url.hostname} sent a web page, not a file. The link may be private or need a sign-in. Use create_upload_link instead.`);
  const cd = res.headers.get("content-disposition") || "";
  const cdName = decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || cd.match(/filename="?([^";]+)"?/i)?.[1] || "").trim());
  const fileName = name || cdName || decodeURIComponent(url.pathname.split("/").pop() || "") || "download";
  if (!type || type === "application/octet-stream" || type === "binary/octet-stream") type = typeFromName(fileName) || type;
  const len = Number(res.headers.get("content-length")) || 0;
  const MAX = 500 * 1024 * 1024;
  if (len > MAX) throw new HttpError(413, "That file is over 500 MB. Use create_upload_link so it can go up in parts.");
  if (len > 20 * 1024 * 1024) return storeStream(env, res.body, len, { name: fileName, type, folder, alt });
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > 60 * 1024 * 1024) throw new HttpError(413, "That file is too big to copy without knowing its size. Use create_upload_link instead.");
  return storeBytes(env, bytes, { name: fileName, type, folder, alt });
}

function b64bytes(data: string): Uint8Array {
  const clean = data.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const TYPE_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", pdf: "application/pdf", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mp3: "audio/mpeg" };

function postView(env: Env, p: SocialPost) {
  const o = JSON.parse(p.options || "{}");
  return {
    id: p.id, status: p.status, caption: p.content, platform_captions: o.captions || {},
    platforms: JSON.parse(p.targets || "[]").map((t: any) => PLATFORMS[t.platform]?.name || t.platform),
    media: JSON.parse(p.media || "[]").map((m: any) => m.name || m.url),
    scheduled_for: p.scheduled_at && p.status === "scheduled" ? new Date(p.scheduled_at).toISOString() : null,
    published_at: p.published_at ? new Date(p.published_at).toISOString() : null,
    still_needed: problems(p),
  };
}

const TOOLS: Tool[] = [
  {
    name: "list_brands", title: "List brands", readOnly: true,
    description: "List Aisling's social brands in Studio (like Ciúnas), which platforms each has connected, their posting times, and the next free posting slot. Call this first so drafts go to the right brand and platforms.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (env) => {
      const tz = (await getSettings(env)).timezone;
      const brands = await listProfiles(env);
      return { timezone: tz, brands: await Promise.all(brands.map(async (b) => ({
        id: b._id, name: b.name,
        platforms: (await listAccounts(env, b._id)).map((x) => ({ platform: PLATFORMS[x.platform]?.name || x.platform, key: x.platform, handle: x.username, character_limit: PLATFORMS[x.platform]?.limit, needs_media: PLATFORMS[x.platform]?.needsMedia })),
        posting_times: (await getSlots(env, b._id)).map((x) => `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][x.day]} ${x.time}`),
        next_free_slot: await nextSlot(env, b._id, tz).then((t) => (t ? new Date(t).toISOString() : null)),
      }))) };
    },
  },
  {
    name: "create_social_draft", title: "Draft a social post",
    description: "Save a social post as a DRAFT in Studio for Aisling to review. It is never posted or scheduled by this tool. Give one main caption, and optionally a different caption for particular platforms (e.g. a shorter one for Bluesky/X, hashtags for Instagram). Attach media with file_ids from list_files/upload_file, or image_urls (https) which are copied into Studio's files first. Instagram, TikTok and Pinterest need at least one image or video. Links in captions are tracked automatically when posted.",
    inputSchema: {
      type: "object", required: ["brand", "caption"], additionalProperties: false,
      properties: {
        brand: { type: "string", description: "Brand name or id from list_brands." },
        caption: { type: "string", description: "Main caption used on every platform without its own version." },
        platforms: { type: "array", items: { type: "string" }, description: "Platform keys to post to (instagram, tiktok, linkedin, threads, bluesky, twitter, pinterest, facebook). Defaults to every connected platform." },
        platform_captions: { type: "object", additionalProperties: { type: "string" }, description: "Optional per-platform caption, keyed by platform key." },
        file_ids: { type: "array", items: { type: "string" }, description: "Studio file ids to attach, in order." },
        image_urls: { type: "array", items: { type: "string" }, description: "https links to images to copy into Studio and attach." },
        pinterest_title: { type: "string" }, pinterest_link: { type: "string", description: "Where the pin should link to." },
        track_links: { type: "boolean", description: "Turn links into tracked links when posted. Default true." },
      },
    },
    run: async (env, a) => {
      const b = await findBrand(env, a.brand);
      const accounts = await listAccounts(env, b._id);
      const want: string[] = Array.isArray(a.platforms) && a.platforms.length ? a.platforms.map(normPlatform) : accounts.map((x) => x.platform);
      const missing = want.filter((p) => !accounts.some((x) => x.platform === p));
      if (missing.length) throw new HttpError(400, `${b.name} has no ${missing.map((m) => PLATFORMS[m]?.name || m).join(", ")} account connected. Connected: ${accounts.map((x) => PLATFORMS[x.platform]?.name).join(", ") || "none"}.`);
      const targets = want.map((p) => ({ platform: p, accountId: accounts.find((x) => x.platform === p)!._id }));
      const captions: Record<string, string> = {};
      for (const [k, v] of Object.entries(a.platform_captions || {})) if (s(v, 10) && PLATFORMS[normPlatform(k)]) captions[normPlatform(k)] = String(v).slice(0, 70000);
      const media = await mediaFromArgs(env, a, b.name);
      const options: any = { captions, track: a.track_links !== false };
      if (a.pinterest_title || a.pinterest_link) options.pinterest = { title: s(a.pinterest_title, 100), link: s(a.pinterest_link, 500) };
      const pid = id("sp_"), t = now();
      await env.DB.prepare("INSERT INTO social_posts (id, profile_id, content, media, targets, options, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(pid, b._id, String(a.caption || "").slice(0, 70000), JSON.stringify(media), JSON.stringify(targets), JSON.stringify(options), t, t).run();
      const p = (await env.DB.prepare("SELECT * FROM social_posts WHERE id = ?").bind(pid).first<SocialPost>())!;
      return { saved_as: "draft", brand: b.name, ...postView(env, p), open_in_studio: await studioUrl(env, "social/p/" + pid),
        note: "Aisling reviews and posts or schedules it from Studio." + (problems(p).length ? " Some things are still needed before it can go out (see still_needed)." : "") };
    },
  },
  {
    name: "update_social_draft", title: "Edit a social draft",
    description: "Change a social post that is still a draft: caption, per-platform captions, platforms or media. Scheduled or posted posts can't be changed here.",
    inputSchema: {
      type: "object", required: ["post_id"], additionalProperties: false,
      properties: {
        post_id: { type: "string" }, caption: { type: "string" },
        platforms: { type: "array", items: { type: "string" } },
        platform_captions: { type: "object", additionalProperties: { type: "string" }, description: "Replaces all per-platform captions. Use an empty string to clear one." },
        file_ids: { type: "array", items: { type: "string" }, description: "Replaces the attached media." },
        image_urls: { type: "array", items: { type: "string" } },
      },
    },
    run: async (env, a) => {
      const p = await env.DB.prepare("SELECT * FROM social_posts WHERE id = ?").bind(s(a.post_id, 80)).first<SocialPost>();
      if (!p) throw new HttpError(404, "No post with that id.");
      if (p.status !== "draft") throw new HttpError(409, `That post is ${p.status}, not a draft. Aisling can pull it back to a draft in Studio.`);
      const opts = JSON.parse(p.options || "{}");
      let targets = p.targets, media = p.media;
      if (Array.isArray(a.platforms)) {
        const accounts = await listAccounts(env, p.profile_id);
        const want = a.platforms.map(normPlatform);
        const bad = want.filter((x: string) => !accounts.some((y) => y.platform === x));
        if (bad.length) throw new HttpError(400, `Not connected for this brand: ${bad.join(", ")}.`);
        targets = JSON.stringify(want.map((x: string) => ({ platform: x, accountId: accounts.find((y) => y.platform === x)!._id })));
      }
      if (a.platform_captions && typeof a.platform_captions === "object") {
        opts.captions = {};
        for (const [k, v] of Object.entries(a.platform_captions)) if (s(v, 10)) opts.captions[normPlatform(k)] = String(v).slice(0, 70000);
      }
      if (Array.isArray(a.file_ids) || Array.isArray(a.image_urls)) {
        const brands = await listProfiles(env).catch(() => []);
        media = JSON.stringify(await mediaFromArgs(env, a, brands.find((x) => x._id === p.profile_id)?.name || ""));
      }
      await env.DB.prepare("UPDATE social_posts SET content = ?, targets = ?, media = ?, options = ?, updated_at = ? WHERE id = ?")
        .bind(a.caption !== undefined ? String(a.caption).slice(0, 70000) : p.content, targets, media, JSON.stringify(opts), now(), p.id).run();
      const q = (await env.DB.prepare("SELECT * FROM social_posts WHERE id = ?").bind(p.id).first<SocialPost>())!;
      return { ...postView(env, q), open_in_studio: await studioUrl(env, "social/p/" + p.id) };
    },
  },
  {
    name: "list_social_posts", title: "List social posts", readOnly: true,
    description: "List recent social posts for a brand, newest first: drafts, scheduled, posted or failed.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      brand: { type: "string" }, status: { type: "string", enum: ["draft", "scheduled", "published", "failed", "partial"] }, limit: { type: "integer", minimum: 1, maximum: 50 } } },
    run: async (env, a) => {
      const where: string[] = [], vals: unknown[] = [];
      if (a.brand) { const b = await findBrand(env, a.brand); where.push("profile_id = ?"); vals.push(b._id); }
      if (a.status) { where.push("status = ?"); vals.push(s(a.status, 20)); }
      const { results } = await env.DB.prepare(`SELECT * FROM social_posts ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC LIMIT ?`)
        .bind(...vals, Math.min(50, Number(a.limit) || 15)).all<SocialPost>();
      return { posts: results.map((p) => postView(env, p)) };
    },
  },
  {
    name: "upload_file", title: "Save a file to Studio",
    description: "Save an image, video, PDF or audio file into Studio's file library so it can be used in posts, emails and pages. Give either base64 data (small files you made, up to about 20 MB) or an https source_url to copy from (up to 500 MB; Google Drive and Dropbox share links work if they're set to anyone-with-the-link). For videos and other big files on Aisling's computer or in this chat, use create_upload_link instead. Returns a file id and public link.",
    inputSchema: { type: "object", required: ["name"], additionalProperties: false, properties: {
      name: { type: "string", description: "File name with extension, e.g. autumn-candles.png" },
      base64: { type: "string", description: "File contents, base64-encoded (a data: URL is fine)." },
      source_url: { type: "string", description: "https link to copy the file from instead." },
      content_type: { type: "string", description: "MIME type. Worked out from the name if left out." },
      folder: { type: "string", description: "Folder, usually the brand name." },
      alt: { type: "string", description: "Short description of an image, for screen readers." } } },
    run: async (env, a) => {
      if (!env.FILES) throw new HttpError(409, "File storage isn’t switched on.");
      const name = s(a.name, 160) || "file";
      let f: FileRow;
      if (a.source_url) f = await importUrl(env, s(a.source_url, 2000), s(a.folder, 60), s(a.alt, 300), name);
      else {
        if (!a.base64) throw new HttpError(400, "Give base64 or source_url.");
        const bytes = b64bytes(String(a.base64));
        if (bytes.byteLength > 25 * 1024 * 1024) throw new HttpError(413, "That’s over 25 MB. Use source_url, or upload it in Studio.");
        const ext = (name.split(".").pop() || "").toLowerCase();
        const type = s(a.content_type, 80) || TYPE_BY_EXT[ext] || "";
        f = await storeBytes(env, bytes, { name, type, folder: s(a.folder, 60), alt: s(a.alt, 300) });
      }
      return { id: f.id, name: f.name, url: fileUrl(env, f.key), kind: f.kind, size_bytes: f.size, width: f.width, height: f.height, folder: f.folder };
    },
  },
  {
    name: "create_upload_link", title: "Make an upload link",
    description: "Make a one-time link for getting big files, like marketing videos, into Studio's file library. Two ways to use it: (1) give the link to Aisling to open in her browser and drag the files in (works for anything, up to 4 GB each); or (2) if you can run shell commands and have the file, upload it yourself: `curl -T video.mp4 -H 'content-type: video/mp4' <url>` for files up to 90 MB, or the parts steps returned for bigger ones. Then call check_upload_link to get the file ids to attach to a draft. Links expire (default 60 minutes).",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      folder: { type: "string", description: "Folder to put the files in, usually the brand name." },
      note: { type: "string", description: "Short line shown on the upload page, e.g. which videos to add." },
      max_files: { type: "integer", minimum: 1, maximum: 50, description: "Default 10." },
      minutes: { type: "integer", minimum: 10, maximum: 1440, description: "How long the link works. Default 60." } } },
    run: async (env, a) => {
      const l = await createUploadLink(env, { folder: s(a.folder, 60), note: s(a.note, 300), maxFiles: a.max_files, minutes: a.minutes });
      return {
        upload_link_id: l.id, url: l.url, expires_at: new Date(l.expires_at).toISOString(),
        for_aisling: "Open the link in a browser and drag the files in. Big videos go up in parts with a progress bar.",
        for_scripts: {
          small_files: `curl -T FILE -H "content-type: video/mp4" -H "x-filename: NAME.mp4" ${l.url}   (up to 90 MB)`,
          big_files: [
            `1. POST ${l.url}/start with headers content-type, x-filename and x-size (bytes) → returns {id, partSize}`,
            `2. For each partSize chunk n = 1, 2, …: PUT ${l.url}/parts/n?file=ID with the chunk as the body → returns {partNumber, etag}`,
            `3. POST ${l.url}/finish with JSON {"file": ID, "parts": [every {partNumber, etag}]}`,
          ],
        },
        next: "Call check_upload_link with upload_link_id to get the file ids once they're in.",
      };
    },
  },
  {
    name: "check_upload_link", title: "Check an upload link", readOnly: true,
    description: "See which files have arrived through an upload link, with their file ids and links, so you can attach them to a draft.",
    inputSchema: { type: "object", required: ["upload_link_id"], additionalProperties: false, properties: { upload_link_id: { type: "string" } } },
    run: async (env, a) => uploadLinkStatus(env, s(a.upload_link_id, 40)),
  },
  {
    name: "list_files", title: "List files", readOnly: true,
    description: "Search Studio's file library. Returns ids and public links you can attach to drafts or put in emails as ![description](link).",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      folder: { type: "string" }, query: { type: "string" }, kind: { type: "string", enum: ["image", "video", "document"] }, limit: { type: "integer", minimum: 1, maximum: 100 } } },
    run: async (env, a) => {
      const where = ["status = 'ready'"], vals: unknown[] = [];
      if (a.folder !== undefined) { where.push("folder = ?"); vals.push(s(a.folder, 60)); }
      if (a.query) { where.push("(name LIKE ? OR alt LIKE ?)"); vals.push(`%${s(a.query, 100)}%`, `%${s(a.query, 100)}%`); }
      if (a.kind) { where.push("kind = ?"); vals.push(s(a.kind, 20)); }
      const { results } = await env.DB.prepare(`SELECT * FROM files WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`).bind(...vals, Math.min(100, Number(a.limit) || 30)).all<FileRow>();
      return { files: results.map((f) => ({ id: f.id, name: f.name, url: fileUrl(env, f.key), kind: f.kind, folder: f.folder, alt: f.alt, width: f.width, height: f.height })) };
    },
  },
  {
    name: "list_email_lists", title: "List email lists", readOnly: true,
    description: "List Aisling's email lists and how many subscribed people are on each.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async (env) => {
      const { results } = await env.DB.prepare(`SELECT l.id, l.name, s.name AS site,
        (SELECT COUNT(*) FROM list_members m JOIN contacts c ON c.id = m.contact_id WHERE m.list_id = l.id AND c.status = 'subscribed') AS subscribed
        FROM lists l LEFT JOIN sites s ON s.id = l.site_id ORDER BY l.created_at`).all();
      const all = await env.DB.prepare("SELECT COUNT(*) AS n FROM contacts WHERE status = 'subscribed'").first<{ n: number }>();
      return { everyone_subscribed: all?.n || 0, lists: results };
    },
  },
  {
    name: "create_email_draft", title: "Draft an email campaign",
    description: "Save an email campaign as a DRAFT in Studio. It is never sent by this tool. Write the body in Markdown (## headings, **bold**, [links](https://…), - lists, ![image](https://files…)). {{name}} becomes each person's first name. Studio adds the unsubscribe link and address footer.",
    inputSchema: { type: "object", required: ["subject", "body_markdown"], additionalProperties: false, properties: {
      subject: { type: "string" }, body_markdown: { type: "string" },
      preview_line: { type: "string", description: "Grey text shown after the subject in inboxes." },
      name: { type: "string", description: "Internal name only Aisling sees." },
      list: { type: "string", description: "List name or id. Leave out to address everyone subscribed." },
      style_as_site: { type: "string", description: "Site name whose colour and name the email uses." } } },
    run: async (env, a) => {
      let listId: string | null = null, siteId: string | null = null;
      if (a.list) {
        const l = await env.DB.prepare("SELECT id FROM lists WHERE id = ? OR lower(name) = lower(?)").bind(s(a.list, 80), s(a.list, 80)).first<{ id: string }>();
        if (!l) throw new HttpError(404, `No list called “${a.list}”. Use list_email_lists.`);
        listId = l.id;
      }
      if (a.style_as_site) {
        const st = await env.DB.prepare("SELECT id FROM sites WHERE id = ? OR lower(name) = lower(?) OR subdomain = lower(?)").bind(s(a.style_as_site, 80), s(a.style_as_site, 80), s(a.style_as_site, 80)).first<{ id: string }>();
        if (st) siteId = st.id;
      }
      const cid = id("cp_"), t = now();
      await env.DB.prepare("INSERT INTO campaigns (id, name, subject, preheader, body, list_id, site_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(cid, s(a.name, 80) || s(a.subject, 80) || "Draft from Claude", s(a.subject, 150), s(a.preview_line, 200), String(a.body_markdown || "").slice(0, 50000), listId, siteId, t, t).run();
      return { saved_as: "draft", id: cid, open_in_studio: await studioUrl(env, "emails/" + cid), note: "Aisling sends a test and sends or schedules it from Studio." };
    },
  },
  {
    name: "get_calendar", title: "See what's planned", readOnly: true,
    description: "What's scheduled over the coming days (social posts and emails), plus unscheduled social drafts. Useful before drafting so new posts fill gaps rather than clash.",
    inputSchema: { type: "object", additionalProperties: false, properties: { days_ahead: { type: "integer", minimum: 1, maximum: 90 } } },
    run: async (env, a) => {
      const t = now(), to = t + Math.min(90, Number(a.days_ahead) || 21) * 864e5;
      const [posts, camps, drafts] = await env.DB.batch([
        env.DB.prepare("SELECT id, profile_id, content, targets, scheduled_at FROM social_posts WHERE status = 'scheduled' AND scheduled_at BETWEEN ? AND ? ORDER BY scheduled_at").bind(t, to),
        env.DB.prepare("SELECT id, name, subject, scheduled_at FROM campaigns WHERE status = 'scheduled' AND scheduled_at BETWEEN ? AND ? ORDER BY scheduled_at").bind(t, to),
        env.DB.prepare("SELECT id, profile_id, content, targets, updated_at FROM social_posts WHERE status = 'draft' ORDER BY updated_at DESC LIMIT 20"),
      ]);
      const brands = await listProfiles(env).catch(() => [] as Array<{ _id: string; name: string }>);
      const bn = (pid: string) => brands.find((b) => b._id === pid)?.name || pid;
      const pl = (tj: string) => JSON.parse(tj || "[]").map((x: any) => PLATFORMS[x.platform]?.name || x.platform);
      return {
        timezone: (await getSettings(env)).timezone,
        scheduled_social: (posts.results as any[]).map((p) => ({ id: p.id, brand: bn(p.profile_id), when: new Date(p.scheduled_at).toISOString(), platforms: pl(p.targets), first_line: String(p.content || "").split("\n")[0].slice(0, 140) })),
        scheduled_emails: (camps.results as any[]).map((c) => ({ id: c.id, when: new Date(c.scheduled_at).toISOString(), subject: c.subject || c.name })),
        social_drafts: (drafts.results as any[]).map((p) => ({ id: p.id, brand: bn(p.profile_id), platforms: pl(p.targets), first_line: String(p.content || "").split("\n")[0].slice(0, 140) })),
      };
    },
  },
  {
    name: "get_performance", title: "How posts are doing", readOnly: true,
    description: "For one brand: likes, comments, shares and reach per platform, the best-performing recent posts, the best days and times to post, and clicks and sign-ups from tracked links. Use it to learn what works before drafting.",
    inputSchema: { type: "object", required: ["brand"], additionalProperties: false, properties: { brand: { type: "string" }, days: { type: "integer", minimum: 7, maximum: 365 } } },
    run: async (env, a) => {
      const b = await findBrand(env, a.brand);
      const days = Math.min(365, Math.max(7, Number(a.days) || 90));
      const p = await performance(env, b._id, days);
      const links = await linkStats(env, { since: now() - days * 864e5, profile_id: b._id });
      const top = [];
      for (const x of p.top) {
        const row = await env.DB.prepare("SELECT content FROM social_posts WHERE id = ?").bind(x.id).first<{ content: string }>();
        top.push({ ...x, published: new Date(x.at).toISOString(), caption: String(row?.content || "").slice(0, 600) });
      }
      return { brand: b.name, days, posts: p.posts, posts_with_numbers: p.measured, per_platform: p.totals, top_posts: top,
        best_time: p.best, enough_data_for_best_time: p.enough, link_clicks_and_signups: links };
    },
  },
];

/* ---------- JSON-RPC over HTTP ---------- */
function rpcResult(idv: unknown, result: unknown) { return { jsonrpc: "2.0", id: idv, result }; }
function rpcError(idv: unknown, code: number, message: string) { return { jsonrpc: "2.0", id: idv ?? null, error: { code, message } }; }

async function handleOne(env: Env, msg: any): Promise<unknown | null> {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "Invalid request");
  const isNote = msg.id === undefined || msg.id === null;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion || "");
      return rpcResult(msg.id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "studio", title: "Studio", version: VERSION },
        instructions: "Studio is Aisling's marketing workspace. These tools read her brands, files, calendar and results, and save social posts and emails as drafts. Nothing is ever posted, scheduled or emailed from here: tell Aisling the draft is ready and give her the Studio link. Start with list_brands; check get_calendar and get_performance before planning several posts.",
      });
    }
    case "ping": return isNote ? null : rpcResult(msg.id, {});
    case "tools/list":
      return rpcResult(msg.id, { tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
        annotations: { title: t.title, readOnlyHint: !!t.readOnly, destructiveHint: false, idempotentHint: !!t.readOnly, openWorldHint: t.name === "upload_file" || t.name === "create_social_draft" } })) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === msg.params?.name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${msg.params?.name}`);
      try {
        const out = await tool.run(env, msg.params?.arguments || {});
        return rpcResult(msg.id, { content: [{ type: "text", text: JSON.stringify(out, null, 1) }], structuredContent: out, isError: false });
      } catch (e) {
        const text = e instanceof HttpError ? e.message : "Studio hit a problem: " + String((e as Error)?.message || e).slice(0, 300);
        if (!(e instanceof HttpError)) console.error("MCP tool error", tool.name, e);
        return rpcResult(msg.id, { content: [{ type: "text", text }], isError: true });
      }
    }
    default:
      if (msg.method.startsWith("notifications/")) return null;
      return isNote ? null : rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcp(req: Request, env: Env, email: string): Promise<Response> {
  const allowed = String(env.ADMIN_EMAILS || "").toLowerCase().split(/[\s,]+/).includes(email.toLowerCase());
  if (!(env.DEV_AUTH === "1" && email === "dev@localhost") && (!isEmail(email) || !allowed)) {
    return json({ error: "This Studio account can’t be used any more." }, 403);
  }
  if (req.method === "GET" || req.method === "DELETE") return new Response(null, { status: 405, headers: { allow: "POST" } });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  let body: any;
  try { body = await req.json(); } catch { return json(rpcError(null, -32700, "Parse error"), 400); }
  const batch = Array.isArray(body);
  const replies = (await Promise.all((batch ? body : [body]).slice(0, 20).map((m: any) => handleOne(env, m)))).filter((x) => x !== null);
  if (!replies.length) return new Response(null, { status: 202 });
  return new Response(JSON.stringify(batch ? replies : replies[0]), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

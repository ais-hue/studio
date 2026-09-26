import { Env, HttpError, id, json, now, slugify } from "./util";

/*
 * File library on R2. Small files upload in one request; big ones (videos) upload in 50 MB parts
 * through R2 multipart, because a single Worker request is capped at 100 MB.
 * Files are public at https://files.<domain>/<key> so emails, pages and social platforms can load them.
 * Keys start with a random id, so they can't be guessed.
 */

export const PART_SIZE = 50 * 1024 * 1024;
const MAX_SIZE = 4 * 1024 * 1024 * 1024; // 4 GB, TikTok's ceiling
export const FREE_BYTES = 10 * 1024 * 1024 * 1024;

export interface FileRow {
  id: string; key: string; name: string; folder: string; type: string; kind: string; size: number;
  width: number | null; height: number | null; alt: string; status: string; upload_id: string | null;
  created_at: number; updated_at: number;
}

const ALLOWED = /^(image\/(jpeg|png|webp|gif|avif|svg\+xml)|video\/(mp4|quicktime|webm)|application\/pdf|audio\/(mpeg|mp4|wav|x-wav))$/;

export const TYPE_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", svg: "image/svg+xml", pdf: "application/pdf", mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav" };
export function typeFromName(name: string): string { return TYPE_BY_EXT[(name.split(".").pop() || "").toLowerCase()] || ""; }

export function kindOf(type: string): string {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type === "application/pdf") return "document";
  return "other";
}

export function fileUrl(env: Env, key: string): string {
  return `https://files.${env.ROOT_DOMAIN}/${key}`;
}

function bucket(env: Env): R2Bucket {
  if (!env.FILES) throw new HttpError(409, "File storage isn’t switched on yet. Turn on R2 in Cloudflare first.");
  return env.FILES;
}

function newKey(name: string, type: string): string {
  const dot = name.lastIndexOf(".");
  const ext = (dot > 0 ? name.slice(dot + 1) : type.split("/")[1] || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
  const base = slugify(dot > 0 ? name.slice(0, dot) : name, 60) || "file";
  return `${id("").slice(0, 12)}/${base}.${ext}`;
}

function meta(req: Request) {
  const type = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const name = decodeURIComponent(req.headers.get("x-filename") || "file").replace(/[\u0000-\u001f\/\\]+/g, " ").trim().slice(0, 160) || "file";
  const folder = decodeURIComponent(req.headers.get("x-folder") || "").trim().slice(0, 60);
  const w = Number(req.headers.get("x-width")) || null, h = Number(req.headers.get("x-height")) || null;
  const size = Number(req.headers.get("x-size")) || 0;
  return { type, name, folder, width: w && w < 100000 ? Math.round(w) : null, height: h && h < 100000 ? Math.round(h) : null, size };
}

export const view = (env: Env, f: FileRow) => ({ ...f, url: fileUrl(env, f.key), upload_id: undefined });

/** One-request upload (up to ~95 MB). */
export async function uploadSmall(env: Env, req: Request, o: { folder?: string; link?: string } = {}): Promise<FileRow> {
  const m = meta(req);
  if (o.folder !== undefined) m.folder = o.folder;
  if (!ALLOWED.test(m.type)) m.type = typeFromName(m.name) || m.type;
  if (!ALLOWED.test(m.type)) throw new HttpError(400, "Studio stores images, videos, PDFs and audio. That file type isn’t one of them.");
  const len = Number(req.headers.get("content-length")) || 0;
  if (!req.body || !len) throw new HttpError(400, "That file is empty.");
  if (len > 95 * 1024 * 1024) throw new HttpError(413, "That file is too big for one go. Refresh Studio and try again.");
  const key = newKey(m.name, m.type);
  const obj = await bucket(env).put(key, req.body, { httpMetadata: { contentType: m.type, cacheControl: "public, max-age=31536000, immutable" } });
  const t = now(), fid = id("f_");
  await env.DB.prepare(`INSERT INTO files (id, key, name, folder, type, kind, size, width, height, upload_link, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(fid, key, m.name, m.folder, m.type, kindOf(m.type), obj?.size || len, m.width, m.height, o.link || null, t, t).run();
  return (await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(fid).first<FileRow>())!;
}

/** Read width and height from PNG, GIF, JPEG or WebP bytes. */
export function imageDims(b: Uint8Array): { w: number; h: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (b[0] === 0x89 && b[1] === 0x50) return { w: dv.getUint32(16), h: dv.getUint32(20) };
    if (b[0] === 0x47 && b[1] === 0x49) return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
    if (b[0] === 0x52 && b[8] === 0x57 && b[12] === 0x56) {
      const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (kind === "VP8X") return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      if (kind === "VP8 ") return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff };
      if (kind === "VP8L") { const v = dv.getUint32(21, true); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length - 9) {
        if (b[i] !== 0xff) { i++; continue; }
        const mk = b[i + 1], len = dv.getUint16(i + 2);
        if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { w: dv.getUint16(i + 7), h: dv.getUint16(i + 5) };
        i += 2 + len;
      }
    }
  } catch { /* not an image we can read */ }
  return null;
}

/** Save bytes Studio already has (from Claude, or fetched from a link) as a library file. */
export async function storeBytes(env: Env, bytes: Uint8Array, o: { name: string; type: string; folder?: string; alt?: string }): Promise<FileRow> {
  const type = (ALLOWED.test(o.type.toLowerCase()) ? o.type : typeFromName(o.name) || o.type).toLowerCase();
  if (!ALLOWED.test(type)) throw new HttpError(400, "Studio stores images, videos, PDFs and audio. That file type isn’t one of them.");
  if (!bytes.byteLength) throw new HttpError(400, "That file is empty.");
  const key = newKey(o.name, type);
  await bucket(env).put(key, bytes, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
  const dim = type.startsWith("image/") ? imageDims(bytes) : null;
  const t = now(), fid = id("f_");
  await env.DB.prepare(`INSERT INTO files (id, key, name, folder, type, kind, size, width, height, alt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(fid, key, o.name.slice(0, 160), (o.folder || "").slice(0, 60), type, kindOf(type), bytes.byteLength, dim?.w || null, dim?.h || null, (o.alt || "").slice(0, 300), t, t).run();
  return (await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(fid).first<FileRow>())!;
}

/** Stream a large download straight into the library without holding it in memory. */
export async function storeStream(env: Env, body: ReadableStream, len: number, o: { name: string; type: string; folder?: string; alt?: string; link?: string }): Promise<FileRow> {
  const type = (ALLOWED.test(o.type) ? o.type : typeFromName(o.name) || o.type).toLowerCase();
  if (!ALLOWED.test(type)) throw new HttpError(400, "Studio stores images, videos, PDFs and audio. That file type isn’t one of them.");
  if (!(len > 0) || len > MAX_SIZE) throw new HttpError(413, "That file is too big, or its size is unknown.");
  const key = newKey(o.name, type);
  const { readable, writable } = new FixedLengthStream(len);
  const pipe = body.pipeTo(writable);
  await bucket(env).put(key, readable, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
  await pipe;
  const t = now(), fid = id("f_");
  await env.DB.prepare(`INSERT INTO files (id, key, name, folder, type, kind, size, alt, upload_link, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(fid, key, o.name.slice(0, 160), (o.folder || "").slice(0, 60), type, kindOf(type), len, (o.alt || "").slice(0, 300), o.link || null, t, t).run();
  return (await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(fid).first<FileRow>())!;
}

/** Start a big upload. The browser then sends parts of PART_SIZE bytes. */
export async function startBig(env: Env, req: Request, o: { folder?: string; link?: string } = {}): Promise<{ file: FileRow; partSize: number }> {
  const m = meta(req);
  if (o.folder !== undefined) m.folder = o.folder;
  if (!ALLOWED.test(m.type)) m.type = typeFromName(m.name) || m.type;
  if (!ALLOWED.test(m.type)) throw new HttpError(400, "Studio stores images, videos, PDFs and audio. That file type isn’t one of them.");
  if (!m.size) throw new HttpError(400, "That file is empty.");
  if (m.size > MAX_SIZE) throw new HttpError(413, "That file is over 4 GB. Make it smaller first.");
  const key = newKey(m.name, m.type);
  const up = await bucket(env).createMultipartUpload(key, { httpMetadata: { contentType: m.type, cacheControl: "public, max-age=31536000, immutable" } });
  const t = now(), fid = id("f_");
  await env.DB.prepare(`INSERT INTO files (id, key, name, folder, type, kind, size, width, height, status, upload_id, upload_link, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?, ?)`)
    .bind(fid, key, m.name, m.folder, m.type, kindOf(m.type), m.size, m.width, m.height, up.uploadId, o.link || null, t, t).run();
  return { file: (await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(fid).first<FileRow>())!, partSize: PART_SIZE };
}

async function pending(env: Env, fid: string): Promise<FileRow> {
  const f = await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(fid).first<FileRow>();
  if (!f) throw new HttpError(404, "That upload doesn’t exist any more.");
  if (f.status !== "uploading" || !f.upload_id) throw new HttpError(409, "That upload has already finished.");
  return f;
}

export async function uploadPart(env: Env, req: Request, fid: string, n: number): Promise<{ partNumber: number; etag: string }> {
  const f = await pending(env, fid);
  if (!(n >= 1 && n <= 10000) || !req.body) throw new HttpError(400, "That part of the upload is missing.");
  const up = bucket(env).resumeMultipartUpload(f.key, f.upload_id!);
  const part = await up.uploadPart(n, req.body);
  return { partNumber: part.partNumber, etag: part.etag };
}

export async function finishBig(env: Env, fid: string, parts: Array<{ partNumber: number; etag: string }>): Promise<FileRow> {
  const f = await pending(env, fid);
  const up = bucket(env).resumeMultipartUpload(f.key, f.upload_id!);
  const obj = await up.complete(parts.map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })).sort((a, b) => a.partNumber - b.partNumber));
  await env.DB.prepare("UPDATE files SET status = 'ready', upload_id = NULL, size = ?, updated_at = ? WHERE id = ?").bind(obj.size, now(), fid).run();
  return (await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(fid).first<FileRow>())!;
}

export async function removeFile(env: Env, f: FileRow): Promise<void> {
  if (f.status === "uploading" && f.upload_id && env.FILES) {
    try { await env.FILES.resumeMultipartUpload(f.key, f.upload_id).abort(); } catch { /* already gone */ }
  }
  if (env.FILES) await env.FILES.delete(f.key);
  await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(f.id).run();
}

/** Clear out big uploads that were abandoned more than a day ago. */
export async function cleanUploads(env: Env): Promise<void> {
  const { results } = await env.DB.prepare("SELECT * FROM files WHERE status = 'uploading' AND created_at < ? LIMIT 20").bind(now() - 86400_000).all<FileRow>();
  for (const f of results) await removeFile(env, f);
}

/** files.<domain>/<key>: public file serving with range support for video. */
export async function serveFile(req: Request, env: Env, url: URL): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!key || !env.FILES) return new Response("Not found", { status: 404 });
  const obj = await env.FILES.get(key, { range: req.headers, onlyIf: req.headers });
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("access-control-allow-origin", "*");
  headers.set("x-content-type-options", "nosniff");
  if ((headers.get("content-type") || "").includes("svg")) headers.set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'");
  if (!("body" in obj)) return new Response(null, { status: 304, headers });
  const body = obj as R2ObjectBody;
  const r = body.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (r && req.headers.has("range")) {
    const offset = r.suffix !== undefined ? obj.size - r.suffix : r.offset || 0;
    const length = r.suffix !== undefined ? r.suffix : r.length ?? obj.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("content-length", String(length));
    return new Response(req.method === "HEAD" ? null : body.body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response(req.method === "HEAD" ? null : body.body, { headers });
}

export { json };

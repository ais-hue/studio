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
export async function uploadSmall(env: Env, req: Request): Promise<FileRow> {
  const m = meta(req);
  if (!ALLOWED.test(m.type)) throw new HttpError(400, "Studio stores images, videos, PDFs and audio. That file type isn’t one of them.");
  const len = Number(req.headers.get("content-length")) || 0;
  if (!req.body || !len) throw new HttpError(400, "That file is empty.");
  if (len > 95 * 1024 * 1024) throw new HttpError(413, "That file is too big for one go. Refresh Studio and try again.");
  const key = newKey(m.name, m.type);
  const obj = await bucket(env).put(key, req.body, { httpMetadata: { contentType: m.type, cacheControl: "public, max-age=31536000, immutable" } });
  const t = now(), fid = id("f_");
  await env.DB.prepare(`INSERT INTO files (id, key, name, folder, type, kind, size, width, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(fid, key, m.name, m.folder, m.type, kindOf(m.type), obj?.size || len, m.width, m.height, t, t).run();
  return (await env.DB.prepare("SELECT * FROM files WHERE id = ?").bind(fid).first<FileRow>())!;
}

/** Start a big upload. The browser then sends parts of PART_SIZE bytes. */
export async function startBig(env: Env, req: Request): Promise<{ file: FileRow; partSize: number }> {
  const m = meta(req);
  if (!ALLOWED.test(m.type)) throw new HttpError(400, "Studio stores images, videos, PDFs and audio. That file type isn’t one of them.");
  if (!m.size) throw new HttpError(400, "That file is empty.");
  if (m.size > MAX_SIZE) throw new HttpError(413, "That file is over 4 GB. Make it smaller first.");
  const key = newKey(m.name, m.type);
  const up = await bucket(env).createMultipartUpload(key, { httpMetadata: { contentType: m.type, cacheControl: "public, max-age=31536000, immutable" } });
  const t = now(), fid = id("f_");
  await env.DB.prepare(`INSERT INTO files (id, key, name, folder, type, kind, size, width, height, status, upload_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?)`)
    .bind(fid, key, m.name, m.folder, m.type, kindOf(m.type), m.size, m.width, m.height, up.uploadId, t, t).run();
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

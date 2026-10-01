import { Env } from "../util";
import { Permanent } from "./types";

/* Helpers for media held in Studio's own file library (files.<domain>/<key>, backed by R2). */

/** The R2 key behind a files.<domain> URL, or null if the file lives somewhere else. */
export function fileKey(env: Env, url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() !== `files.${env.ROOT_DOMAIN.toLowerCase()}`) return null;
    return decodeURIComponent(u.pathname.replace(/^\/+/, "")) || null;
  } catch { return null; }
}

const isJpeg = (url: string) => /\.jpe?g($|\?)/i.test(new URL(url).pathname);

/**
 * A version of an image a platform will accept. Instagram only takes JPEG and Bluesky caps images at about 1 MB,
 * so Studio's own files go through Cloudflare's image transformations (they must be switched on for the zone:
 * Images → Transformations). Files hosted elsewhere are passed through untouched.
 */
export function transformed(env: Env, url: string, opts: { jpeg?: boolean; maxWidth?: number; quality?: number }): string {
  const key = fileKey(env, url);
  if (!key) return url;
  const parts: string[] = [];
  if (opts.jpeg || opts.quality || opts.maxWidth) parts.push("format=jpeg");
  if (opts.maxWidth) parts.push(`width=${opts.maxWidth}`, "fit=scale-down");
  if (opts.quality) parts.push(`quality=${opts.quality}`);
  if (!parts.length || (opts.jpeg && !opts.maxWidth && !opts.quality && isJpeg(url))) return url;
  return `https://files.${env.ROOT_DOMAIN}/cdn-cgi/image/${parts.join(",")}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/** Fetch media bytes: straight from R2 when it's Studio's own file, otherwise over the web. */
export async function bytes(env: Env, url: string, range?: { offset: number; length: number }): Promise<{ data: ArrayBuffer; type: string; size: number }> {
  const key = fileKey(env, url);
  if (key && env.FILES && !url.includes("/cdn-cgi/")) {
    const obj = await env.FILES.get(key, range ? { range } : undefined);
    if (!obj) throw new Permanent(`The file ${key.split("/").pop()} isn’t in the library any more.`);
    return { data: await obj.arrayBuffer(), type: obj.httpMetadata?.contentType || "application/octet-stream", size: obj.size };
  }
  const res = await fetch(url, range ? { headers: { range: `bytes=${range.offset}-${range.offset + range.length - 1}` } } : {});
  if (!res.ok) throw new Permanent(`Couldn’t load ${url.split("/").pop()} (${res.status}).`);
  const total = Number((res.headers.get("content-range") || "").split("/")[1]) || Number(res.headers.get("content-length")) || 0;
  const data = await res.arrayBuffer();
  return { data, type: (res.headers.get("content-type") || "application/octet-stream").split(";")[0], size: total || data.byteLength };
}

/** Size of a media file without downloading it. */
export async function sizeOf(env: Env, url: string): Promise<{ size: number; type: string }> {
  const key = fileKey(env, url);
  if (key && env.FILES) {
    const head = await env.FILES.head(key);
    if (!head) throw new Permanent(`The file ${key.split("/").pop()} isn’t in the library any more.`);
    return { size: head.size, type: head.httpMetadata?.contentType || "" };
  }
  const res = await fetch(url, { method: "HEAD" });
  if (!res.ok) throw new Permanent(`Couldn’t reach ${url.split("/").pop()} (${res.status}).`);
  return { size: Number(res.headers.get("content-length")) || 0, type: (res.headers.get("content-type") || "").split(";")[0] };
}

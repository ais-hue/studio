export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ROOT_DOMAIN: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  DEV_AUTH: string;
  RESEND_API_KEY?: string;
  ADMIN_EMAILS: string;
}

export const now = () => Date.now();

export function id(prefix = ""): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return prefix + Array.from(b, (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 18);
}

export function token(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function slugify(s: string, max = 40): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

export const RESERVED_SUBDOMAINS = new Set(["studio", "go", "www", "mail", "email", "api", "admin", "app"]);

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function html(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...extra },
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function isEmail(s: string): boolean {
  return /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/.test(s) && s.length <= 254;
}

/** Colours a site can use. Values are [light-theme ink, dark-theme ink]. */
export const ACCENTS: Record<string, [string, string]> = {
  brass: ["#8E6F33", "#C6A66A"],
  oxblood: ["#7A2E2A", "#C27A72"],
  slate: ["#3D5360", "#93A9B5"],
  plum: ["#5A3E5B", "#AE92AE"],
  moss: ["#4D5C37", "#A0AE83"],
};
export const accentOf = (a: string) => ACCENTS[a] || ACCENTS.brass;

/* ---------- tiny, safe markdown ---------- */
function inline(s: string): string {
  let out = esc(s);
  // links [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t, u) => {
    const url = u.replace(/&amp;/g, "&");
    if (!/^(https?:\/\/|mailto:|\/)/i.test(url)) return t;
    return `<a href="${esc(url)}">${t}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  return out;
}

export function markdown(src: string): string {
  const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.type}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      flushPara(); flushList();
      const level = m[1].length + 1; // # -> h2
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
      continue;
    }
    if (/^(---|\*\*\*)$/.test(line.trim())) { flushPara(); flushList(); out.push("<hr>"); continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      flushPara();
      if (!list || list.type !== "ul") { flushList(); list = { type: "ul", items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (!list || list.type !== "ol") { flushList(); list = { type: "ol", items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    if ((m = line.match(/^>\s?(.*)$/))) { flushPara(); flushList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join("\n");
}

export function plainText(md: string): string {
  return String(md || "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/[*`#>]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function getSettings(env: Env): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  const s: Record<string, string> = {
    sender_name: "Aisling",
    sender_email: "hello@" + env.ROOT_DOMAIN,
    reply_to: "",
    postal_address: "",
    consent_text: "I’d like to get emails about this. I can unsubscribe any time.",
  };
  for (const r of results) s[r.key] = r.value;
  return s;
}

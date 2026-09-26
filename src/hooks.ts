import { Env, json, now } from "./util";
import { exitAll } from "./automation";

/*
 * Resend delivery events, signed the Svix way:
 *   signature = base64(HMAC-SHA256(base64decode(secret without "whsec_"), `${id}.${timestamp}.${body}`))
 * Hard bounces and spam complaints stop all email to that address and take them out of automations.
 */

export const WEBHOOK_EVENTS = ["email.delivered", "email.bounced", "email.complained", "email.failed", "email.suppressed"];

function b64decode(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
function b64encode(b: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(b)));
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function verifySvix(secret: string, headers: Headers, body: string, at = Date.now()): Promise<boolean> {
  const msgId = headers.get("svix-id") || headers.get("webhook-id");
  const ts = headers.get("svix-timestamp") || headers.get("webhook-timestamp");
  const sigs = headers.get("svix-signature") || headers.get("webhook-signature");
  if (!msgId || !ts || !sigs || !secret) return false;
  if (!/^\d+$/.test(ts) || Math.abs(at / 1000 - Number(ts)) > 5 * 60) return false;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("raw", b64decode(secret.replace(/^whsec_/, "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  } catch { return false; }
  const expected = b64encode(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${msgId}.${ts}.${body}`)));
  return sigs.split(" ").some((part) => {
    const [v, sig] = part.split(",");
    return v === "v1" && !!sig && safeEqual(sig, expected);
  });
}

async function webhookSecret(env: Env): Promise<string> {
  if (env.RESEND_WEBHOOK_SECRET) return env.RESEND_WEBHOOK_SECRET;
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = 'resend_webhook_secret'").first<{ value: string }>();
  return r?.value || "";
}

export async function handleResendWebhook(req: Request, env: Env): Promise<Response> {
  const body = await req.text();
  const secret = await webhookSecret(env);
  if (!secret) return json({ error: "Not set up" }, 503);
  if (!(await verifySvix(secret, req.headers, body))) return json({ error: "Bad signature" }, 401);

  let ev: any;
  try { ev = JSON.parse(body); } catch { return json({ error: "Bad JSON" }, 400); }
  const type = String(ev?.type || "");
  const data = ev?.data || {};
  const providerId = data.email_id ? String(data.email_id) : null;
  const to: string[] = Array.isArray(data.to) ? data.to.map((x: unknown) => String(x).toLowerCase()) : data.to ? [String(data.to).toLowerCase()] : [];
  const msgId = req.headers.get("svix-id") || req.headers.get("webhook-id") || "";
  const t = now();

  // Repeats of the same event are ignored.
  const detail = type === "email.bounced" ? [data.bounce?.type, data.bounce?.subType, data.bounce?.message].filter(Boolean).join(" · ")
    : type === "email.failed" ? String(data.failed?.reason || data.reason || "") : "";
  const ins = await env.DB.prepare("INSERT OR IGNORE INTO email_events (id, type, provider_id, email, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(msgId, type, providerId, to[0] || null, detail.slice(0, 500), t).run();
  if (!ins.meta?.changes) return json({ ok: true, repeat: true });

  const send = providerId ? await env.DB.prepare("SELECT id, contact_id FROM sends WHERE provider_id = ?").bind(providerId).first<{ id: string; contact_id: string | null }>() : null;
  const contacts: Array<{ id: string }> = [];
  if (send?.contact_id) contacts.push({ id: send.contact_id });
  else for (const e of to) {
    const c = await env.DB.prepare("SELECT id FROM contacts WHERE email = ?").bind(e).first<{ id: string }>();
    if (c) contacts.push(c);
  }

  const stopAll = async (status: string) => {
    for (const c of contacts) {
      await env.DB.prepare("UPDATE contacts SET status = ?, updated_at = ? WHERE id = ?").bind(status, t, c.id).run();
      await exitAll(env, c.id, status);
    }
  };

  switch (type) {
    case "email.delivered":
      if (send) await env.DB.prepare("UPDATE sends SET delivered_at = COALESCE(delivered_at, ?) WHERE id = ?").bind(t, send.id).run();
      break;
    case "email.bounced": {
      // Only permanent ("hard") bounces stop email. Temporary ones (full inbox, server down) are just recorded.
      const hard = !data.bounce?.type || /permanent/i.test(String(data.bounce.type));
      if (send) await env.DB.prepare("UPDATE sends SET bounced_at = COALESCE(bounced_at, ?), error = ? WHERE id = ?").bind(t, detail || "Bounced", send.id).run();
      if (hard) await stopAll("bounced");
      break;
    }
    case "email.suppressed":
      if (send) await env.DB.prepare("UPDATE sends SET bounced_at = COALESCE(bounced_at, ?), error = ? WHERE id = ?").bind(t, "On Resend’s do-not-send list", send.id).run();
      await stopAll("bounced");
      break;
    case "email.complained":
      if (send) await env.DB.prepare("UPDATE sends SET complained_at = COALESCE(complained_at, ?) WHERE id = ?").bind(t, send.id).run();
      await stopAll("complained");
      break;
    case "email.failed":
      if (send) await env.DB.prepare("UPDATE sends SET status = 'failed', error = ? WHERE id = ?").bind(detail || "The email provider couldn’t send it", send.id).run();
      break;
  }
  return json({ ok: true });
}

/** Try to register the webhook with Resend using the sending key. Works only if the key is allowed to. */
export async function connectResendWebhook(env: Env): Promise<{ ok: boolean; error?: string; needsManual?: boolean }> {
  if (!env.RESEND_API_KEY) return { ok: false, error: "Add your Resend key first." };
  const res = await fetch("https://api.resend.com/webhooks", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ endpoint: `https://go.${env.ROOT_DOMAIN}/hooks/resend`, events: WEBHOOK_EVENTS }),
  });
  const data = await res.json<any>().catch(() => ({}));
  if (!res.ok || !data?.signing_secret) {
    const restricted = res.status === 401 || res.status === 403 || /restricted|permission|not allowed/i.test(String(data?.message || ""));
    return { ok: false, needsManual: true, error: restricted
      ? "Your Resend key can only send email, so it can’t set this up by itself. Use the three steps below instead."
      : String(data?.message || `Resend answered with an error (${res.status}).`) };
  }
  await env.DB.batch([
    env.DB.prepare("INSERT INTO settings (key, value) VALUES ('resend_webhook_secret', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(data.signing_secret)),
    env.DB.prepare("INSERT INTO settings (key, value) VALUES ('resend_webhook_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(data.id || "")),
  ]);
  return { ok: true };
}

export async function webhookStatus(env: Env): Promise<{ connected: boolean; lastEvent: number | null; bounced: number; complained: number }> {
  const secret = await webhookSecret(env);
  const [last, counts] = await env.DB.batch([
    env.DB.prepare("SELECT MAX(created_at) AS t FROM email_events"),
    env.DB.prepare("SELECT SUM(status = 'bounced') AS bounced, SUM(status = 'complained') AS complained FROM contacts"),
  ]);
  const c = (counts.results[0] || {}) as any;
  return { connected: !!secret, lastEvent: (last.results[0] as any)?.t || null, bounced: c.bounced || 0, complained: c.complained || 0 };
}


import { Env, accentOf, esc, getSettings, id, markdown, now, plainText, slugify } from "./util";
import { tagUrl } from "./links";
import { segmentWhere } from "./segments";
import { runSequences } from "./automation";
import { syncSocial } from "./social";
import { cleanUploads } from "./files";
import { syncMetrics } from "./performance";

interface SendRow {
  id: string; campaign_id: string | null; list_id: string | null; step_id: string | null; kind: string;
  contact_id: string | null; email: string; name: string | null; token: string | null; cstatus: string | null;
}
interface Campaign {
  id: string; name: string; subject: string; preheader: string; body: string;
  list_id: string | null; site_id: string | null; status: string; segment_id?: string | null;
}

export interface Rendered { subject: string; html: string; text: string; headers: Record<string, string> }

function fill(s: string, vars: Record<string, string>): string {
  return s.replace(/\{\{\s*(\w+)(?:\s*\|\s*([^}]*))?\s*\}\}/g, (_m, k, dflt) => {
    const v = vars[k];
    return v ? v : (dflt ?? (k === "name" ? "there" : "")).trim();
  });
}

export function renderEmail(
  env: Env, settings: Record<string, string>,
  opts: { subject: string; preheader?: string; body: string; accent?: string; siteName?: string;
          name?: string; email: string; sendId?: string; token?: string; test?: boolean; utmCampaign?: string },
): Rendered {
  const go = `https://go.${env.ROOT_DOMAIN}`;
  const vars = { name: (opts.name || "").split(" ")[0], email: opts.email };
  const subject = fill(opts.subject, vars);
  const bodyMd = fill(opts.body, vars);
  const [accent] = accentOf(opts.accent || "brass");
  let body = markdown(bodyMd)
    .replace(/<p>/g, `<p style="margin:0 0 16px;">`)
    .replace(/<h2>/g, `<h2 style="font-family:Arial Black,Helvetica,Arial,sans-serif;font-size:20px;line-height:1.2;text-transform:uppercase;margin:24px 0 10px;">`)
    .replace(/<h3>/g, `<h3 style="font-family:Arial Black,Helvetica,Arial,sans-serif;font-size:17px;line-height:1.2;text-transform:uppercase;margin:20px 0 8px;">`)
    .replace(/<blockquote>/g, `<blockquote style="margin:16px 0;padding-left:14px;border-left:4px solid ${accent};">`)
    .replace(/<ul>/g, `<ul style="margin:0 0 16px;padding-left:20px;">`)
    .replace(/<ol>/g, `<ol style="margin:0 0 16px;padding-left:20px;">`)
    .replace(/<hr>/g, `<hr style="border:0;border-top:1px solid #161512;margin:24px 0;">`)
    .replace(/<a href="/g, `<a style="color:${accent};" href="`)
    .replace(/<img src="/g, `<img style="display:block;width:100%;max-width:544px;height:auto;border:0;margin:0 0 16px;" width="544" src="`);
  if (opts.sendId && !opts.test) {
    const campaign = slugify(opts.utmCampaign || "", 40);
    body = body.replace(/href="(https?:\/\/[^"]+)"/g, (_m, u) => {
      let dest = u.replace(/&amp;/g, "&");
      if (campaign && !dest.startsWith(go)) dest = tagUrl(env, dest, { utm_source: "studio", utm_medium: "email", utm_campaign: campaign });
      return `href="${go}/c/${opts.sendId}?u=${encodeURIComponent(dest)}"`;
    });
  }
  const unsub = opts.token ? `${go}/u/${opts.token}` : `${go}/u/preview`;
  const addr = settings.postal_address ? esc(settings.postal_address) : "";
  const from = esc(opts.siteName || settings.sender_name);
  const pixel = opts.sendId && !opts.test ? `<img src="${go}/o/${opts.sendId}.gif" width="1" height="1" alt="" style="display:block;border:0;">` : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#ECE9E1;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(fill(opts.preheader || "", vars))}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ECE9E1;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#F7F5EF;border:1px solid #161512;">
<tr><td style="padding:22px 28px 14px;border-bottom:4px solid #161512;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="12" height="12" style="background:${accent};font-size:0;line-height:0;">&nbsp;</td><td style="padding-left:10px;font-family:Arial Black,Helvetica,Arial,sans-serif;font-size:14px;letter-spacing:.02em;text-transform:uppercase;color:#161512;">${from}</td></tr></table>
</td></tr>
<tr><td style="padding:26px 28px 10px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#161512;">${opts.test ? `<p style="margin:0 0 18px;padding:8px 10px;border:1px dashed #8C877C;font-size:13px;color:#5C5850;">Test email. Links aren’t tracked and the unsubscribe link does nothing.</p>` : ""}${body}</td></tr>
<tr><td style="padding:16px 28px 22px;border-top:1px solid #161512;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#5C5850;">
You’re getting this because you signed up at ${esc(env.ROOT_DOMAIN)}. <a href="${unsub}" style="color:#5C5850;">Unsubscribe</a>${addr ? `<br>${addr}` : ""}
</td></tr></table>${pixel}
</td></tr></table></body></html>`;
  const text = `${plainText(bodyMd)}\n\n—\nUnsubscribe: ${unsub}${settings.postal_address ? "\n" + settings.postal_address : ""}`;
  const headers: Record<string, string> = opts.token && !opts.test
    ? { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {};
  return { subject: (opts.test ? "[Test] " : "") + subject, html, text, headers };
}

function fromLine(settings: Record<string, string>, siteName?: string): string {
  const n = (siteName ? `${settings.sender_name} at ${siteName}` : settings.sender_name).replace(/["<>]/g, "");
  return `${n} <${settings.sender_email}>`;
}

/** Send up to 100 messages in one call. Returns one result per message. */
async function resendBatch(env: Env, msgs: Array<Record<string, unknown>>): Promise<Array<{ ok: boolean; id?: string; error?: string }>> {
  if (!env.RESEND_API_KEY) {
    if (env.DEV_AUTH === "1") return msgs.map(() => ({ ok: true, id: "dev-" + id() }));
    return msgs.map(() => ({ ok: false, error: "Email sending isn’t connected yet." }));
  }
  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(msgs),
  });
  const data = await res.json<any>().catch(() => ({}));
  if (!res.ok) {
    const err = String(data?.message || data?.name || `Email provider error ${res.status}`);
    return msgs.map(() => ({ ok: false, error: err }));
  }
  const ids: Array<{ id: string }> = data?.data || [];
  return msgs.map((_m, i) => (ids[i]?.id ? { ok: true, id: ids[i].id } : { ok: false, error: "No id returned" }));
}

/** One transactional email (sign-in links). */
export async function sendTransactional(env: Env, m: { to: string; from: string; subject: string; html: string; text: string }): Promise<{ ok: boolean; error?: string }> {
  const [r] = await resendBatch(env, [{ from: m.from, to: [m.to], subject: m.subject, html: m.html, text: m.text }]);
  return r;
}

export async function sendTest(env: Env, c: Campaign, to: string): Promise<{ ok: boolean; error?: string }> {
  const settings = await getSettings(env);
  const site = c.site_id ? await env.DB.prepare("SELECT name, accent FROM sites WHERE id = ?").bind(c.site_id).first<{ name: string; accent: string }>() : null;
  const r = renderEmail(env, settings, { subject: c.subject, preheader: c.preheader, body: c.body, accent: site?.accent, siteName: site?.name, email: to, name: "Aisling", test: true });
  const [res] = await resendBatch(env, [{ from: fromLine(settings, site?.name), to: [to], subject: r.subject, html: r.html, text: r.text, ...(settings.reply_to ? { reply_to: settings.reply_to } : {}) }]);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** Queue one send row per subscribed recipient. */
export async function enqueueCampaign(env: Env, c: Campaign): Promise<number> {
  const t = now();
  let stmt: D1PreparedStatement;
  if (c.segment_id) {
    const w = await segmentWhere(env, c.segment_id);
    stmt = env.DB.prepare(`SELECT c.id, c.email FROM contacts c WHERE c.status = 'subscribed' AND ${w.sql}`).bind(...w.params);
  } else if (c.list_id) {
    stmt = env.DB.prepare(`SELECT c.id, c.email FROM contacts c JOIN list_members m ON m.contact_id = c.id WHERE m.list_id = ? AND c.status = 'subscribed'`).bind(c.list_id);
  } else stmt = env.DB.prepare(`SELECT id, email FROM contacts WHERE status = 'subscribed'`);
  const { results } = await stmt.all<{ id: string; email: string }>();
  const ins = env.DB.prepare("INSERT INTO sends (id, campaign_id, kind, contact_id, email, created_at) VALUES (?, ?, 'campaign', ?, ?, ?)");
  for (let i = 0; i < results.length; i += 50) {
    await env.DB.batch(results.slice(i, i + 50).map((r) => ins.bind(id("s_"), c.id, r.id, r.email, t)));
  }
  await env.DB.prepare("UPDATE campaigns SET status = 'sending', sent_at = ?, updated_at = ? WHERE id = ?").bind(t, t, c.id).run();
  if (!results.length) await env.DB.prepare("UPDATE campaigns SET status = 'sent' WHERE id = ?").bind(c.id).run();
  return results.length;
}

export async function processQueue(env: Env, max = 300): Promise<number> {
  const { results } = await env.DB.prepare(`SELECT s.id, s.campaign_id, s.list_id, s.step_id, s.kind, s.contact_id, s.email, c.name, c.token, c.status AS cstatus
    FROM sends s LEFT JOIN contacts c ON c.id = s.contact_id WHERE s.status = 'queued' ORDER BY s.created_at LIMIT ?`).bind(max).all<SendRow>();
  if (!results.length) return 0;
  const settings = await getSettings(env);
  const campaigns = new Map<string, (Campaign & { accent?: string; siteName?: string }) | null>();
  const lists = new Map<string, { welcome_subject: string; welcome_body: string; accent?: string; siteName?: string } | null>();
  const steps = new Map<string, { subject: string; preheader: string; body: string; accent?: string; siteName?: string; seqName?: string } | null>();
  const skip: string[] = [];
  const out: Array<{ row: SendRow; msg: Record<string, unknown> }> = [];

  for (const row of results) {
    if (!row.contact_id || row.cstatus !== "subscribed") { skip.push(row.id); continue; }
    let r;
    if (row.kind === "campaign" && row.campaign_id) {
      if (!campaigns.has(row.campaign_id)) {
        campaigns.set(row.campaign_id, await env.DB.prepare(`SELECT cp.*, s.accent, s.name AS siteName FROM campaigns cp LEFT JOIN sites s ON s.id = cp.site_id WHERE cp.id = ?`).bind(row.campaign_id).first());
      }
      const c = campaigns.get(row.campaign_id);
      if (!c) { skip.push(row.id); continue; }
      r = renderEmail(env, settings, { subject: c.subject, preheader: c.preheader, body: c.body, accent: c.accent, siteName: c.siteName, email: row.email, name: row.name || "", sendId: row.id, token: row.token || "", utmCampaign: c.name });
      out.push({ row, msg: { from: fromLine(settings, c.siteName), to: [row.email], subject: r.subject, html: r.html, text: r.text, headers: r.headers, ...(settings.reply_to ? { reply_to: settings.reply_to } : {}) } });
    } else if (row.kind === "welcome" && row.list_id) {
      if (!lists.has(row.list_id)) {
        lists.set(row.list_id, await env.DB.prepare(`SELECT l.welcome_subject, l.welcome_body, s.accent, s.name AS siteName FROM lists l LEFT JOIN sites s ON s.id = l.site_id WHERE l.id = ?`).bind(row.list_id).first());
      }
      const l = lists.get(row.list_id);
      if (!l) { skip.push(row.id); continue; }
      r = renderEmail(env, settings, { subject: l.welcome_subject, body: l.welcome_body, accent: l.accent, siteName: l.siteName, email: row.email, name: row.name || "", sendId: row.id, token: row.token || "", utmCampaign: "welcome" });
      out.push({ row, msg: { from: fromLine(settings, l.siteName), to: [row.email], subject: r.subject, html: r.html, text: r.text, headers: r.headers, ...(settings.reply_to ? { reply_to: settings.reply_to } : {}) } });
    } else if (row.kind === "sequence" && row.step_id) {
      if (!steps.has(row.step_id)) {
        steps.set(row.step_id, await env.DB.prepare(`SELECT st.subject, st.preheader, st.body, s.accent, s.name AS siteName, q.name AS seqName FROM sequence_steps st
          JOIN sequences q ON q.id = st.sequence_id LEFT JOIN sites s ON s.id = q.site_id WHERE st.id = ?`).bind(row.step_id).first());
      }
      const st = steps.get(row.step_id);
      if (!st || !st.subject.trim()) { skip.push(row.id); continue; }
      r = renderEmail(env, settings, { subject: st.subject, preheader: st.preheader, body: st.body, accent: st.accent, siteName: st.siteName, email: row.email, name: row.name || "", sendId: row.id, token: row.token || "", utmCampaign: "automation-" + (st.seqName || "") });
      out.push({ row, msg: { from: fromLine(settings, st.siteName), to: [row.email], subject: r.subject, html: r.html, text: r.text, headers: r.headers, ...(settings.reply_to ? { reply_to: settings.reply_to } : {}) } });
    } else skip.push(row.id);
  }

  const t = now();
  if (skip.length) {
    const st = env.DB.prepare("UPDATE sends SET status = 'skipped' WHERE id = ?");
    await env.DB.batch(skip.map((s) => st.bind(s)));
  }
  let sent = 0;
  for (let i = 0; i < out.length; i += 100) {
    const chunk = out.slice(i, i + 100);
    const res = await resendBatch(env, chunk.map((x) => x.msg));
    const upd = env.DB.prepare("UPDATE sends SET status = ?, provider_id = ?, error = ?, sent_at = ? WHERE id = ?");
    await env.DB.batch(chunk.map((x, j) => upd.bind(res[j].ok ? "sent" : "failed", res[j].id || null, res[j].error || null, res[j].ok ? t : null, x.row.id)));
    sent += res.filter((r) => r.ok).length;
    if (!res.some((r) => r.ok) && res[0]?.error?.includes("isn’t connected")) break;
  }
  // close out finished campaigns
  await env.DB.prepare(`UPDATE campaigns SET status = 'sent', updated_at = ? WHERE status = 'sending'
    AND NOT EXISTS (SELECT 1 FROM sends WHERE sends.campaign_id = campaigns.id AND sends.status = 'queued')`).bind(t).run();
  return sent;
}

export async function runScheduled(env: Env): Promise<void> {
  const due = (await env.DB.prepare("SELECT * FROM campaigns WHERE status = 'scheduled' AND scheduled_at <= ?").bind(now()).all<Campaign>()).results;
  for (const c of due) await enqueueCampaign(env, c);
  await runSequences(env, 300);
  await processQueue(env, 500);
  await syncSocial(env).catch((e) => console.error("Social sync:", e));
  const minute = new Date().getUTCMinutes();
  if (minute === 7) await cleanUploads(env).catch((e) => console.error("File cleanup:", e));
  if (minute === 23) await syncMetrics(env).catch((e) => console.error("Performance sync:", e));
}

/** Test one automation email. */
export async function sendStepTest(env: Env, step: { subject: string; preheader: string; body: string }, siteId: string | null, to: string): Promise<{ ok: boolean; error?: string }> {
  return sendTest(env, { id: "", name: "", subject: step.subject, preheader: step.preheader, body: step.body, list_id: null, site_id: siteId, status: "draft" }, to);
}

/** Double opt-in: ask a new signup to confirm before anything else is sent. */
export async function sendConfirmation(env: Env, c: { email: string; name: string; token: string }, site: { name: string; accent: string } | null): Promise<{ ok: boolean; error?: string }> {
  const settings = await getSettings(env);
  const link = `https://go.${env.ROOT_DOMAIN}/confirm/${c.token}`;
  const what = site ? `**${site.name}**` : "my emails";
  const r = renderEmail(env, settings, {
    subject: site ? `Confirm your email for ${site.name}` : "Confirm your email",
    preheader: "One tap and you’re in.",
    body: `Hi {{name}},\n\nYou (or someone using this address) signed up for ${what}. Tap below to confirm it’s you.\n\n[Yes, sign me up](${link})\n\nIf this wasn’t you, ignore this email and you won’t hear from us again.`,
    accent: site?.accent, siteName: site?.name, email: c.email, name: c.name, token: c.token,
  });
  const [res] = await resendBatch(env, [{ from: fromLine(settings, site?.name), to: [c.email], subject: r.subject, html: r.html, text: r.text, ...(settings.reply_to ? { reply_to: settings.reply_to } : {}) }]);
  return res;
}

export type { Campaign };

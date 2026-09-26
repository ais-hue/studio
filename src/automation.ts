import { Env, id, now } from "./util";

/*
 * Automations: a trigger (joins a list, clicks a link in an email, or added by hand) starts a person
 * on a sequence of emails. Each step waits, checks an optional condition about the previous email,
 * then queues a send. The minute-by-minute cron moves everyone along; the normal send queue delivers.
 * People leave automatically when they unsubscribe, bounce or mark an email as spam.
 */

export interface Sequence {
  id: string; name: string; status: string; trigger: string;
  trigger_list_id: string | null; trigger_campaign_id: string | null; site_id: string | null;
  created_at: number; updated_at: number;
}
export interface Step {
  id: string; sequence_id: string; position: number; delay_minutes: number; condition: string;
  subject: string; preheader: string; body: string; created_at: number; updated_at: number;
}

export const CONDITIONS = ["always", "opened", "not_opened", "clicked", "not_clicked"];

async function firstDelay(env: Env, seqId: string): Promise<number | null> {
  const s = await env.DB.prepare("SELECT delay_minutes FROM sequence_steps WHERE sequence_id = ? ORDER BY position LIMIT 1").bind(seqId).first<{ delay_minutes: number }>();
  return s ? s.delay_minutes : null;
}

/** Start one person on an automation. Does nothing if they've been on it before. */
export async function enroll(env: Env, seqId: string, contactId: string): Promise<boolean> {
  const delay = await firstDelay(env, seqId);
  const t = now();
  const r = await env.DB.prepare(`INSERT OR IGNORE INTO enrollments (id, sequence_id, contact_id, step_index, status, next_at, created_at, updated_at)
    VALUES (?, ?, ?, 0, 'active', ?, ?, ?)`).bind(id("en_"), seqId, contactId, t + (delay || 0) * 60_000, t, t).run();
  return (r.meta?.changes || 0) > 0;
}

/** Start everyone currently subscribed on a list. Returns how many were newly started. */
export async function enrollList(env: Env, seqId: string, listId: string): Promise<number> {
  const delay = (await firstDelay(env, seqId)) || 0;
  const t = now();
  const r = await env.DB.prepare(`INSERT OR IGNORE INTO enrollments (id, sequence_id, contact_id, step_index, status, next_at, created_at, updated_at)
    SELECT 'en_' || lower(hex(randomblob(9))), ?, c.id, 0, 'active', ?, ?, ?
    FROM contacts c JOIN list_members m ON m.contact_id = c.id WHERE m.list_id = ? AND c.status = 'subscribed'`)
    .bind(seqId, t + delay * 60_000, t, t, listId).run();
  return r.meta?.changes || 0;
}

/** Someone confirmed their place on a list: welcome email plus any list automations. */
export async function onListJoin(env: Env, listId: string, contactId: string, email: string): Promise<boolean> {
  let queued = false;
  const list = await env.DB.prepare("SELECT welcome_enabled FROM lists WHERE id = ?").bind(listId).first<{ welcome_enabled: number }>();
  if (list?.welcome_enabled) {
    const already = await env.DB.prepare("SELECT 1 FROM sends WHERE kind = 'welcome' AND list_id = ? AND contact_id = ?").bind(listId, contactId).first();
    if (!already) {
      await env.DB.prepare("INSERT INTO sends (id, list_id, kind, contact_id, email, created_at) VALUES (?, ?, 'welcome', ?, ?, ?)")
        .bind(id("s_"), listId, contactId, email, now()).run();
      queued = true;
    }
  }
  const { results } = await env.DB.prepare("SELECT id FROM sequences WHERE status = 'active' AND trigger = 'list' AND trigger_list_id = ?").bind(listId).all<{ id: string }>();
  for (const s of results) if (await enroll(env, s.id, contactId)) queued = true;
  return queued;
}

/** Someone clicked a link in a campaign: start any automations waiting for that. */
export async function onCampaignClick(env: Env, campaignId: string, contactId: string): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id FROM sequences WHERE status = 'active' AND trigger = 'click' AND trigger_campaign_id = ?").bind(campaignId).all<{ id: string }>();
  for (const s of results) await enroll(env, s.id, contactId);
}

/** Take people out of every automation (unsubscribed, bounced, complained). */
export async function exitAll(env: Env, contactId: string, reason: string): Promise<void> {
  await env.DB.prepare("UPDATE enrollments SET status = 'exited', exit_reason = ?, next_at = NULL, updated_at = ? WHERE contact_id = ? AND status = 'active'")
    .bind(reason, now(), contactId).run();
}

function passes(cond: string, prev: { opened_at: number | null; clicked_at: number | null } | null): boolean {
  switch (cond) {
    case "opened": return !!prev?.opened_at;
    case "not_opened": return !!prev && !prev.opened_at;
    case "clicked": return !!prev?.clicked_at;
    case "not_clicked": return !!prev && !prev.clicked_at;
    default: return true;
  }
}

/** Move everyone whose next step is due. Queues sends; processQueue delivers them. */
export async function runSequences(env: Env, max = 200): Promise<number> {
  const t = now();
  const { results: due } = await env.DB.prepare(`SELECT e.id, e.sequence_id, e.contact_id, e.step_index, e.last_send_id, c.email, c.status AS cstatus
    FROM enrollments e JOIN sequences s ON s.id = e.sequence_id JOIN contacts c ON c.id = e.contact_id
    WHERE e.status = 'active' AND s.status = 'active' AND e.next_at <= ? ORDER BY e.next_at LIMIT ?`).bind(t, max)
    .all<{ id: string; sequence_id: string; contact_id: string; step_index: number; last_send_id: string | null; email: string; cstatus: string }>();
  if (!due.length) return 0;
  const steps = new Map<string, Step[]>();
  let queued = 0;
  for (const e of due) {
    if (e.cstatus !== "subscribed") {
      await env.DB.prepare("UPDATE enrollments SET status = 'exited', exit_reason = ?, next_at = NULL, updated_at = ? WHERE id = ?").bind(e.cstatus, t, e.id).run();
      continue;
    }
    if (!steps.has(e.sequence_id)) {
      steps.set(e.sequence_id, (await env.DB.prepare("SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY position").bind(e.sequence_id).all<Step>()).results);
    }
    const list = steps.get(e.sequence_id)!;
    const step = list[e.step_index];
    if (!step) {
      await env.DB.prepare("UPDATE enrollments SET status = 'completed', next_at = NULL, updated_at = ? WHERE id = ? AND step_index = ?").bind(t, e.id, e.step_index).run();
      continue;
    }
    const prev = e.last_send_id
      ? await env.DB.prepare("SELECT opened_at, clicked_at FROM sends WHERE id = ?").bind(e.last_send_id).first<{ opened_at: number | null; clicked_at: number | null }>()
      : null;
    const send = e.step_index === 0 || passes(step.condition, prev);
    const next = list[e.step_index + 1];
    const sendId = send ? id("s_") : null;
    // Claim the step first so two overlapping runs can't send it twice.
    const claim = await env.DB.prepare(`UPDATE enrollments SET step_index = ?, status = ?, next_at = ?, last_send_id = COALESCE(?, last_send_id), updated_at = ?
      WHERE id = ? AND step_index = ? AND status = 'active'`)
      .bind(e.step_index + 1, next ? "active" : "completed", next ? t + next.delay_minutes * 60_000 : null, sendId, t, e.id, e.step_index).run();
    if (!claim.meta?.changes || !sendId) continue;
    await env.DB.prepare("INSERT INTO sends (id, kind, step_id, enrollment_id, contact_id, email, created_at) VALUES (?, 'sequence', ?, ?, ?, ?, ?)")
      .bind(sendId, step.id, e.id, e.contact_id, e.email, t).run();
    queued++;
  }
  return queued;
}

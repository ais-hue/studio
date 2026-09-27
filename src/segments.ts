import { Env, HttpError } from "./util";

/*
 * Smart lists: saved rules that pick contacts, evaluated live whenever they're used.
 * Rules compile to a parameterised SQL condition on contacts `c`. Every field and operator is whitelisted.
 */

export interface Rule { field: string; op: string; value?: unknown }
export interface Rules { match: "all" | "any"; rules: Rule[] }
export interface Field { key: string; label: string; type: string; options: string[] }

const DAY = 864e5;
const num = (v: unknown) => { const n = Number(v); if (!Number.isFinite(n)) throw new HttpError(400, "A rule needs a number."); return n; };
const days = (v: unknown) => Math.max(0, Math.min(3650, Math.round(num(v))));
const txt = (v: unknown) => String(v ?? "").slice(0, 200);
const keyOk = (k: string) => /^[a-z][a-z0-9_]{0,39}$/.test(k);

/** One rule → SQL. */
function compileRule(r: Rule, fields: Map<string, Field>, now: number): { sql: string; params: unknown[] } {
  const f = r.field, op = r.op, v = r.value;
  switch (f) {
    case "email":
      if (op === "contains") return { sql: "c.email LIKE ?", params: [`%${txt(v)}%`] };
      if (op === "ends_with") return { sql: "c.email LIKE ?", params: [`%${txt(v).trim().toLowerCase()}`] };
      if (op === "is") return { sql: "c.email = ?", params: [txt(v).toLowerCase()] };
      break;
    case "name":
      if (op === "is_set") return { sql: "c.name != ''", params: [] };
      if (op === "not_set") return { sql: "c.name = ''", params: [] };
      if (op === "contains") return { sql: "c.name LIKE ?", params: [`%${txt(v)}%`] };
      break;
    case "status":
      if (op === "is") return { sql: "c.status = ?", params: [txt(v)] };
      if (op === "is_not") return { sql: "c.status != ?", params: [txt(v)] };
      break;
    case "source":
      if (op === "contains") return { sql: "c.source LIKE ?", params: [`%${txt(v)}%`] };
      break;
    case "signed_up":
      if (op === "in_last_days") return { sql: "c.created_at >= ?", params: [now - days(v) * DAY] };
      if (op === "more_than_days") return { sql: "c.created_at < ?", params: [now - days(v) * DAY] };
      break;
    case "list":
      if (op === "in") return { sql: "EXISTS (SELECT 1 FROM list_members m WHERE m.contact_id = c.id AND m.list_id = ?)", params: [txt(v)] };
      if (op === "not_in") return { sql: "NOT EXISTS (SELECT 1 FROM list_members m WHERE m.contact_id = c.id AND m.list_id = ?)", params: [txt(v)] };
      break;
    case "form":
      if (op === "submitted") return { sql: "EXISTS (SELECT 1 FROM form_submissions fs WHERE fs.contact_id = c.id AND fs.form_id = ?)", params: [txt(v)] };
      if (op === "not_submitted") return { sql: "NOT EXISTS (SELECT 1 FROM form_submissions fs WHERE fs.contact_id = c.id AND fs.form_id = ?)", params: [txt(v)] };
      break;
    case "opened":
      if (op === "in_last_days") return { sql: "EXISTS (SELECT 1 FROM sends s WHERE s.contact_id = c.id AND s.opened_at >= ?)", params: [now - days(v) * DAY] };
      if (op === "not_in_last_days") return { sql: "NOT EXISTS (SELECT 1 FROM sends s WHERE s.contact_id = c.id AND s.opened_at >= ?)", params: [now - days(v) * DAY] };
      break;
    case "clicked":
      if (op === "campaign") return { sql: "EXISTS (SELECT 1 FROM sends s WHERE s.contact_id = c.id AND s.campaign_id = ? AND s.clicked_at IS NOT NULL)", params: [txt(v)] };
      if (op === "not_campaign") return { sql: "NOT EXISTS (SELECT 1 FROM sends s WHERE s.contact_id = c.id AND s.campaign_id = ? AND s.clicked_at IS NOT NULL)", params: [txt(v)] };
      if (op === "in_last_days") return { sql: "EXISTS (SELECT 1 FROM sends s WHERE s.contact_id = c.id AND s.clicked_at >= ?)", params: [now - days(v) * DAY] };
      break;
    case "came_from":
      if (op === "is") return { sql: "c.ref_link IN (SELECT code FROM links WHERE platform = ?)", params: [txt(v)] };
      if (op === "any") return { sql: "c.ref_link IS NOT NULL", params: [] };
      break;
    default: {
      if (!f.startsWith("field:")) break;
      const k = f.slice(6), fd = fields.get(k);
      if (!fd || !keyOk(k)) throw new HttpError(400, "One of the rules uses a field that no longer exists.");
      const path = `'$.${k}'`, val = `json_extract(c.props, ${path})`;
      if (op === "is_set") return { sql: `(${val} IS NOT NULL AND ${val} != '' AND ${val} != '[]')`, params: [] };
      if (op === "not_set") return { sql: `(${val} IS NULL OR ${val} = '' OR ${val} = '[]')`, params: [] };
      if (fd.type === "multiselect") {
        if (op === "has") return { sql: `EXISTS (SELECT 1 FROM json_each(c.props, ${path}) WHERE value = ?)`, params: [txt(v)] };
        if (op === "has_not") return { sql: `NOT EXISTS (SELECT 1 FROM json_each(c.props, ${path}) WHERE value = ?)`, params: [txt(v)] };
      } else if (fd.type === "checkbox") {
        if (op === "is_true") return { sql: `${val} = 1`, params: [] };
        if (op === "is_false") return { sql: `(${val} IS NULL OR ${val} = 0)`, params: [] };
      } else if (fd.type === "number") {
        if (op === "gt") return { sql: `CAST(${val} AS REAL) > ?`, params: [num(v)] };
        if (op === "lt") return { sql: `CAST(${val} AS REAL) < ?`, params: [num(v)] };
        if (op === "eq") return { sql: `CAST(${val} AS REAL) = ?`, params: [num(v)] };
      } else if (fd.type === "date") {
        if (op === "before") return { sql: `${val} < ?`, params: [txt(v)] };
        if (op === "after") return { sql: `${val} > ?`, params: [txt(v)] };
      } else {
        if (op === "is") return { sql: `lower(${val}) = lower(?)`, params: [txt(v)] };
        if (op === "is_not") return { sql: `(${val} IS NULL OR lower(${val}) != lower(?))`, params: [txt(v)] };
        if (op === "contains") return { sql: `${val} LIKE ?`, params: [`%${txt(v)}%`] };
      }
    }
  }
  throw new HttpError(400, `That rule doesn’t make sense (${f} ${op}).`);
}

export async function fieldMap(env: Env): Promise<Map<string, Field>> {
  const { results } = await env.DB.prepare("SELECT key, label, type, options FROM contact_fields").all<{ key: string; label: string; type: string; options: string }>();
  return new Map(results.map((r) => [r.key, { key: r.key, label: r.label, type: r.type, options: JSON.parse(r.options || "[]") }]));
}

export function cleanRules(input: any): Rules {
  const match = input?.match === "any" ? "any" : "all";
  const rules = (Array.isArray(input?.rules) ? input.rules : []).slice(0, 20)
    .map((r: any) => ({ field: String(r?.field || "").slice(0, 50), op: String(r?.op || "").slice(0, 30), value: r?.value === undefined ? undefined : String(r.value).slice(0, 200) }))
    .filter((r: Rule) => r.field && r.op);
  return { match, rules };
}

/** Rules → a WHERE fragment for contacts `c`. */
export async function compileRules(env: Env, rules: Rules): Promise<{ sql: string; params: unknown[] }> {
  if (!rules.rules.length) return { sql: "1 = 1", params: [] };
  const fields = await fieldMap(env), now = Date.now();
  const parts = rules.rules.map((r) => compileRule(r, fields, now));
  return { sql: "(" + parts.map((p) => "(" + p.sql + ")").join(rules.match === "any" ? " OR " : " AND ") + ")", params: parts.flatMap((p) => p.params) };
}

export async function segmentWhere(env: Env, segmentId: string): Promise<{ sql: string; params: unknown[] }> {
  const s = await env.DB.prepare("SELECT rules FROM segments WHERE id = ?").bind(segmentId).first<{ rules: string }>();
  if (!s) throw new HttpError(404, "That smart list doesn’t exist any more.");
  return compileRules(env, cleanRules(JSON.parse(s.rules || "{}")));
}

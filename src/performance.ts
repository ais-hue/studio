import { Env, getSettings, now } from "./util";
import { SocialPost, listProfiles, zernioKey } from "./social";
import { directMetrics } from "./direct/engine";

/*
 * Post performance. Every hour Studio asks Zernio (and each platform, for posts it sent itself) for the numbers on recent posts and keeps them on each post,
 * per platform. From those it works out which days and times do best for each brand.
 */

const ENGAGE = ["likes", "comments", "shares", "saves", "reposts", "retweets", "replies", "quotes", "reactions"];
const REACH = ["impressions", "reach", "views", "plays"];
const BLOCKS: Array<{ name: string; from: number; to: number; slot: string }> = [
  { name: "Early morning", from: 5, to: 9, slot: "07:30" },
  { name: "Morning", from: 9, to: 12, slot: "10:00" },
  { name: "Midday", from: 12, to: 15, slot: "13:00" },
  { name: "Afternoon", from: 15, to: 18, slot: "16:30" },
  { name: "Evening", from: 18, to: 22, slot: "19:30" },
  { name: "Late", from: 22, to: 29, slot: "22:30" },
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function numbers(o: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (!o || typeof o !== "object") return out;
  for (const [k, v] of Object.entries(o)) {
    const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
    if (Number.isFinite(n)) out[k.replace(/([A-Z])/g, "_$1").toLowerCase()] = n;
  }
  return out;
}
export const engagementOf = (m: Record<string, number>) => ENGAGE.reduce((a, k) => a + (m[k] || 0), 0);
export const reachOf = (m: Record<string, number>) => REACH.reduce((a, k) => Math.max(a, m[k] || 0), 0);

/** Pull fresh numbers for posts from the last 90 days: from Zernio, and from each platform for direct posts. */
export async function syncMetrics(env: Env): Promise<number> {
  const zernio = await syncZernioMetrics(env).catch((e) => { console.error("Zernio metrics:", e); return 0; });
  const direct = await directMetrics(env).catch((e) => { console.error("Direct metrics:", e); return 0; });
  return zernio + direct;
}

async function syncZernioMetrics(env: Env): Promise<number> {
  const t = now();
  const simulated = env.DEV_AUTH === "1" && !(await zernioKey(env));
  if (!simulated && !(await zernioKey(env))) return 0;
  const { results: mine } = await env.DB.prepare(`SELECT id, zernio_id, targets, published_at, metrics FROM social_posts
    WHERE zernio_id IS NOT NULL AND status IN ('published','partial') AND published_at > ?`).bind(t - 90 * 864e5).all<SocialPost & { metrics: string | null }>();
  if (!mine.length) return 0;
  const byZid = new Map(mine.map((p) => [p.zernio_id!, p]));
  const updates = new Map<string, Record<string, Record<string, number>>>();

  if (simulated) {
    for (const p of mine) {
      const seed = [...p.id].reduce((a, c) => a + c.charCodeAt(0), 0);
      const m: Record<string, Record<string, number>> = {};
      for (const tg of JSON.parse(p.targets || "[]")) {
        const s = (seed * (tg.platform.length + 3)) % 97;
        m[tg.platform] = { likes: 5 + s, comments: s % 9, shares: s % 5, impressions: 200 + s * 13 };
      }
      updates.set(p.id, m);
    }
  } else {
    const from = new Date(t - 90 * 864e5).toISOString().slice(0, 10), to = new Date(t + 864e5).toISOString().slice(0, 10);
    let profiles: Array<{ _id: string }> = [];
    try { profiles = await listProfiles(env); } catch { return 0; }
    const key = await zernioKey(env);
    for (const pr of profiles) {
      for (let page = 1; page <= 5; page++) {
        const res = await fetch(`https://zernio.com/api/v1/analytics?profileId=${encodeURIComponent(pr._id)}&fromDate=${from}&toDate=${to}&limit=100&page=${page}`,
          { headers: { authorization: `Bearer ${key}` } });
        if (!res.ok) { console.error("Analytics fetch failed", res.status, (await res.text()).slice(0, 200)); break; }
        const d: any = await res.json().catch(() => ({}));
        const posts: any[] = Array.isArray(d) ? d : d.posts || d.data || [];
        for (const x of posts) {
          const ids = [x.postId, x._id, x.id, x.latePostId, x.zernioPostId].filter(Boolean).map(String);
          const mineP = ids.map((i) => byZid.get(i)).find(Boolean);
          if (!mineP) continue;
          const m = updates.get(mineP.id) || {};
          const platforms: any[] = Array.isArray(x.platforms) && !x.analytics ? x.platforms : [x];
          for (const pl of platforms) {
            const nums = numbers(pl.analytics || pl.metrics || {});
            if (Object.keys(nums).length) m[String(pl.platform || x.platform)] = nums;
          }
          updates.set(mineP.id, m);
        }
        if (posts.length < 100 || !(d.hasMore || d.pagination?.hasMore || (d.pagination?.page < d.pagination?.pages))) break;
      }
    }
  }
  const st = env.DB.prepare("UPDATE social_posts SET metrics = ?, metrics_at = ? WHERE id = ?");
  const rows = [...updates].filter(([, m]) => Object.keys(m).length).map(([pid, m]) => st.bind(JSON.stringify(m), t, pid));
  for (let i = 0; i < rows.length; i += 50) await env.DB.batch(rows.slice(i, i + 50));
  return rows.length;
}

/** Totals, top posts and best times for a brand. */
export async function performance(env: Env, profileId: string, days = 90) {
  const tz = (await getSettings(env)).timezone;
  const since = now() - days * 864e5;
  const { results } = await env.DB.prepare(`SELECT id, content, media, published_at, metrics, metrics_at FROM social_posts
    WHERE profile_id = ? AND status IN ('published','partial') AND published_at > ? ORDER BY published_at DESC`).bind(profileId, since)
    .all<{ id: string; content: string; media: string; published_at: number; metrics: string | null; metrics_at: number | null }>();
  const withNums = results.filter((p) => p.metrics && p.metrics !== "{}");
  const totals: Record<string, { posts: number; engagement: number; reach: number; likes: number; comments: number; shares: number }> = {};
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", hour: "numeric", hourCycle: "h23" });
  const grid: Array<Array<{ posts: number; engagement: number }>> = DAYS.map(() => BLOCKS.map(() => ({ posts: 0, engagement: 0 })));
  const top: Array<{ id: string; title: string; engagement: number; reach: number; at: number; media: boolean }> = [];
  for (const p of withNums) {
    const m = JSON.parse(p.metrics!) as Record<string, Record<string, number>>;
    let e = 0, r = 0;
    for (const [pl, nums] of Object.entries(m)) {
      const t = (totals[pl] ||= { posts: 0, engagement: 0, reach: 0, likes: 0, comments: 0, shares: 0 });
      t.posts++; t.engagement += engagementOf(nums); t.reach += reachOf(nums);
      t.likes += nums.likes || 0; t.comments += nums.comments || 0; t.shares += (nums.shares || 0) + (nums.reposts || 0);
      e += engagementOf(nums); r += reachOf(nums);
    }
    top.push({ id: p.id, title: (p.content || "").split("\n")[0].slice(0, 120) || "Picture post", engagement: e, reach: r, at: p.published_at, media: p.media !== "[]" });
    const parts = Object.fromEntries(fmt.formatToParts(new Date(p.published_at)).map((x) => [x.type, x.value]));
    const day = DAYS.indexOf(String(parts.weekday)), hour = Number(parts.hour);
    const h = hour < 5 ? hour + 24 : hour;
    const b = BLOCKS.findIndex((x) => h >= x.from && h < x.to);
    if (day > -1 && b > -1) { grid[day][b].posts++; grid[day][b].engagement += e; }
  }
  top.sort((a, b) => b.engagement - a.engagement);
  let best: { day: number; block: number; avg: number } | null = null;
  const overall = withNums.length ? top.reduce((a, x) => a + x.engagement, 0) / withNums.length : 0;
  grid.forEach((row, d) => row.forEach((c, b) => {
    if (c.posts >= 2) { const avg = c.engagement / c.posts; if (!best || avg > best.avg) best = { day: d, block: b, avg }; }
  }));
  const b = best as { day: number; block: number; avg: number } | null;
  return {
    timezone: tz, days, posts: results.length, measured: withNums.length,
    updated: withNums.reduce((a, p) => Math.max(a, p.metrics_at || 0), 0) || null,
    totals, top: top.slice(0, 5),
    blocks: BLOCKS.map((x) => ({ name: x.name, slot: x.slot, from: x.from, to: x.to % 24 })),
    grid: grid.map((row) => row.map((c) => ({ posts: c.posts, avg: c.posts ? Math.round((c.engagement / c.posts) * 10) / 10 : 0 }))),
    best: b && withNums.length >= 5 && b.avg > overall
      ? { day: b.day, dayName: DAYS[b.day], block: BLOCKS[b.block].name, slot: BLOCKS[b.block].slot, lift: overall ? Math.round((b.avg / overall - 1) * 100) : 0 }
      : null,
    enough: withNums.length >= 5,
  };
}

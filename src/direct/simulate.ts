import { Env, id } from "../util";
import { App, Connected, Job, Permanent, Retry, StepResult } from "./types";

/*
 * A pretend platform for trying the engine locally (DEV_AUTH=1 only).
 * Save a platform's app with the app ID "simulate", or connect Bluesky with a handle ending ".simulate".
 * Captions containing #fail fail for good; #flaky fails once and then goes through.
 */

export const simulated = (env: Env, app: App | null) => env.DEV_AUTH === "1" && app?.client_id === "simulate";

export const PROVIDERS_SIM = {
  async exchange(platform: string, handle?: string): Promise<Connected> {
    const name = handle?.replace(/\.simulate$/, "") || `ciunas_${platform}`;
    return { token: "sim_" + id(), refresh_token: "simr_" + id(), expires_at: Date.now() + 86400_000, meta: { simulated: true, pds: "https://sim.invalid" },
      external_id: "sim_" + id(), username: name, display_name: "Ciúnas (simulated)", picture: "" };
  },
  async step(job: Job): Promise<StepResult> {
    if (/#fail\b/.test(job.text)) throw new Permanent(`Simulated ${job.account.platform} refused the post (#fail).`);
    if (/#flaky\b/.test(job.text) && !job.data.flaked) { job.data.flaked = true; throw new Retry("Simulated hiccup (#flaky).", 1000); }
    if (job.step === "start") {
      const video = job.media.some((m) => m.type === "video");
      return { step: "processing", data: { polls: 0, flaked: job.data.flaked }, wait: video ? 20_000 : 500 };
    }
    if (job.step === "processing") {
      const ext = "sim_" + id();
      return { done: true, external_id: ext, url: `https://example.com/${job.account.platform}/${ext}` };
    }
    throw new Permanent(`Unknown step ${job.step}.`);
  },
  metrics(ids: string[]): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    for (const x of ids) { const s = [...x].reduce((a, c) => a + c.charCodeAt(0), 0) % 97; out[x] = { likes: 3 + s, comments: s % 7, shares: s % 4, views: 150 + s * 11 }; }
    return out;
  },
};

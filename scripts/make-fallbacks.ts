/*
 * npm run make:fallbacks [-- --api http://localhost:4000]
 * Runs one demo against samples/taskly through the HTTP API only and saves docs/fallback/cached-plan.json
 * and docs/fallback/cached-demo.mp4.
 *
 * Assumed API shapes (E7 was not available when this was written, see NOTES/contract-issues.md):
 *   POST /api/jobs {source, instructions} -> JSON with the job id in `id` (or `jobId`, or `job.id`)
 *   GET  /api/jobs/:id/events -> Server-Sent Events, each `data:` line a JobEvent JSON; ends on type done or error
 *   GET  /api/jobs/:id        -> Job JSON (or {job: Job})
 *   GET  /api/jobs/:id/video  -> the video bytes
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JobEventSchema, JobSchema, PlanSchema, type Job, type JobEvent } from "@demoforge/shared";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "docs", "fallback");
const planPath = path.join(outDir, "cached-plan.json");
const videoPath = path.join(outDir, "cached-demo.mp4");
const INSTRUCTIONS =
  "Sign up with a demo email and password, then add a task called 'Record the demo video' on the dashboard.";
const TIMEOUT_MS = 15 * 60_000;

function apiBase(): string {
  const i = process.argv.indexOf("--api");
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (i >= 0 && !v) fail("--api needs a value, e.g. --api http://localhost:4000");
  return (v ?? "http://localhost:4000").replace(/\/+$/, "");
}

function fail(msg: string): never {
  console.error(`\n✘ ${msg}`);
  process.exit(1);
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(60_000) });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return fail(`Could not reach ${url} (${why}). Is the API running? Start it, or pass --api <url>.`);
  }
}

async function createJob(api: string): Promise<string> {
  const res = await request(`${api}/api/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: path.join(root, "samples", "taskly"), instructions: INSTRUCTIONS }),
  });
  const text = await res.text();
  if (!res.ok) fail(`POST /api/jobs returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  let body: { id?: unknown; jobId?: unknown; job?: { id?: unknown } };
  try {
    body = JSON.parse(text);
  } catch {
    return fail(`POST /api/jobs did not return JSON: ${text.slice(0, 300)}`);
  }
  const id = [body.id, body.jobId, body.job?.id].find((v): v is string => typeof v === "string" && v !== "");
  return id ?? fail(`POST /api/jobs reply has no job id: ${text.slice(0, 300)}`);
}

function show(e: JobEvent): void {
  const tag = e.stage ? `${e.type}:${e.stage}` : e.stepId !== undefined ? `${e.type}#${e.stepId}` : e.type;
  console.log(`  [${tag}] ${e.message ?? ""}`.trimEnd());
}

/** Follows the SSE stream until a done or error event. Returns true on done. */
async function followEvents(api: string, id: string): Promise<boolean> {
  const res = await request(`${api}/api/jobs/${id}/events`, {
    headers: { accept: "text/event-stream" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok || !res.body) return fail(`GET /api/jobs/${id}/events returned HTTP ${res.status}`);
  const decoder = new TextDecoder();
  let buf = "";
  const handle = (line: string): boolean | undefined => {
    if (!line.startsWith("data:")) return undefined;
    let json: unknown;
    try {
      json = JSON.parse(line.slice(5).trim());
    } catch {
      return undefined;
    }
    const ev = JobEventSchema.safeParse(json);
    if (!ev.success) return undefined;
    show(ev.data);
    if (ev.data.type === "done") return true;
    if (ev.data.type === "error") return false;
    return undefined;
  };
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const r = handle(line);
        if (r !== undefined) return r;
      }
    }
  } catch (e) {
    fail(`Event stream broke: ${e instanceof Error ? e.message : e}`);
  }
  // Stream ended without done/error: the job state decides.
  console.log("  (event stream closed, checking job state)");
  return (await getJob(api, id)).status === "done";
}

async function getJob(api: string, id: string): Promise<Job> {
  const res = await request(`${api}/api/jobs/${id}`);
  const text = await res.text();
  if (!res.ok) fail(`GET /api/jobs/${id} returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(`GET /api/jobs/${id} did not return JSON`);
  }
  const candidate = body && typeof body === "object" && "job" in body ? (body as { job: unknown }).job : body;
  const job = JobSchema.safeParse(candidate);
  if (!job.success) return fail(`GET /api/jobs/${id} is not a valid Job: ${job.error.issues[0]?.path.join(".")} ${job.error.issues[0]?.message}`);
  return job.data;
}

async function main(): Promise<void> {
  const api = apiBase();
  console.log(`Using API ${api}`);
  const id = await createJob(api);
  console.log(`Job ${id} created, following events...`);
  const ok = await followEvents(api, id);
  const job = await getJob(api, id);
  if (!ok || job.status !== "done") fail(`Job ${id} ended as "${job.status}"${job.error ? `: ${job.error}` : ""}. Fix that and run again.`);
  if (!job.plan) fail(`Job ${id} is done but has no plan.`);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(planPath, JSON.stringify(job.plan, null, 2) + "\n");

  const vres = await request(`${api}/api/jobs/${id}/video`, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!vres.ok) fail(`GET /api/jobs/${id}/video returned HTTP ${vres.status}`);
  writeFileSync(videoPath, Buffer.from(await vres.arrayBuffer()));

  // Verify both saved files.
  const plan = PlanSchema.safeParse(JSON.parse(readFileSync(planPath, "utf8")));
  if (!plan.success) fail(`cached-plan.json does not match PlanSchema: ${plan.error.issues[0]?.message}`);
  const size = statSync(videoPath).size;
  if (size === 0) fail("cached-demo.mp4 is empty.");
  const head = readFileSync(videoPath).subarray(4, 8).toString("latin1");
  if (head !== "ftyp") fail("cached-demo.mp4 is not an MP4 file (the recorder probably fell back to webm because ffmpeg is missing). Run npm run setup:check, fix ffmpeg, and run again.");

  console.log(`\n✔ ${path.relative(root, planPath)}: valid plan "${plan.data.title}" with ${plan.data.steps.length} steps`);
  console.log(`✔ ${path.relative(root, videoPath)}: ${(size / 1024 / 1024).toFixed(1)} MB`);
}

void main();

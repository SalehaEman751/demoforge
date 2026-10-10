import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFixture, PlanSchema, type Plan } from "@demoforge/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobEvents } from "./events.js";
import { loadCachedPlan, Pipeline } from "./pipeline.js";
import { createRegistry, type Registry } from "./registry.js";
import { buildServer } from "./server.js";
import { DEFAULT_CACHED_PLAN_FILE, CACHED_VIDEO_FILE, liveSetting, type FallbackSettings } from "./settings.js";
import { JobStore, type CreateJobRequest } from "./store.js";

let dir: string;
let store: JobStore;
let events: JobEvents;
let base: Registry;
let settings: FallbackSettings;
let video: string;

const fixturePlan = loadFixture("plan.json", PlanSchema);
const shortPlan: Plan = { title: "Cached", steps: [{ id: 1, action: "navigate", url: "/", caption: "Home" }] };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "df-fallback-"));
  store = new JobStore(join(dir, "jobs"));
  events = new JobEvents((id) => store.jobDir(id));
  base = await createRegistry({ useMocks: true });
  settings = {};
  video = join(dir, "cached-demo.mp4");
  writeFileSync(video, Buffer.from("0123456789"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Registry whose planner and repair must never be called, with spies on the rest. */
const spied = () => {
  const planDemo = vi.fn(base.planDemo);
  const repairStep = vi.fn(base.repairStep);
  const runPlan = vi.fn(base.runPlan);
  const launchProject = vi.fn(base.launchProject);
  return { registry: { ...base, planDemo, repairStep, runPlan, launchProject }, planDemo, runPlan, launchProject };
};
const pipelineWith = (registry: Registry) =>
  new Pipeline({ store, events, registry, settings: () => settings, cachedVideoFile: video, defaultCachedPlanFile: join(dir, "default-plan.json") });
const runJob = async (pipeline: Pipeline, extra: Partial<CreateJobRequest> = {}) => {
  const job = store.create({ source: "./samples/taskly", instructions: "sign up", ...extra });
  pipeline.enqueue(job.id);
  await pipeline.idle();
  return { job: store.get(job.id)!, history: events.history(job.id) };
};

describe("cached plan (E7-7)", () => {
  it("DEMOFORGE_CACHED_PLAN: plan comes from the file, model and repair are not called, the run is live", async () => {
    const file = join(dir, "plan.json");
    writeFileSync(file, JSON.stringify(shortPlan));
    settings = { cachedPlan: file };
    const s = spied();
    const { job, history } = await runJob(pipelineWith(s.registry));

    expect(job.status).toBe("done");
    expect(job.plan).toEqual(shortPlan);
    expect(s.planDemo).not.toHaveBeenCalled();
    expect(s.runPlan).toHaveBeenCalledTimes(1);
    expect(s.runPlan.mock.calls[0]![0]).toMatchObject({ plan: shortPlan, repair: undefined });
    expect(history).toContainEqual(expect.objectContaining({ type: "stage", stage: "planning", message: "Using cached plan" }));
    expect(history).toContainEqual(
      expect.objectContaining({ type: "log", message: expect.stringMatching(/cached plan .*not called/), data: { fallback: "cached-plan", file } }),
    );
  });

  it("request fallback: 'cached-plan' uses the default file when the env var is empty", async () => {
    writeFileSync(join(dir, "default-plan.json"), JSON.stringify(shortPlan));
    const s = spied();
    const { job } = await runJob(pipelineWith(s.registry), { fallback: "cached-plan" });
    expect(job.plan).toEqual(shortPlan);
    expect(s.planDemo).not.toHaveBeenCalled();
  });

  it("takes effect for the next job without restarting", async () => {
    const s = spied();
    const pipeline = pipelineWith(s.registry);
    await runJob(pipeline);
    expect(s.planDemo).toHaveBeenCalledTimes(1);

    const file = join(dir, "plan.json");
    writeFileSync(file, JSON.stringify(shortPlan));
    settings = { cachedPlan: file }; // switch flipped while the server keeps running
    const { job } = await runJob(pipeline);
    expect(s.planDemo).toHaveBeenCalledTimes(1);
    expect(job.plan).toEqual(shortPlan);

    settings = {};
    await runJob(pipeline);
    expect(s.planDemo).toHaveBeenCalledTimes(2);
  });

  it("accepts the runner's run-log.json ({ plan, results, repairs })", () => {
    const file = join(dir, "run-log.json");
    writeFileSync(file, JSON.stringify({ plan: fixturePlan, results: [], repairs: [] }));
    expect(loadCachedPlan(file)).toEqual(fixturePlan);
  });

  it("missing or invalid cached plan fails the job with a clear code", async () => {
    settings = { cachedPlan: join(dir, "nope.json") };
    const missing = await runJob(pipelineWith(spied().registry));
    expect(missing.job).toMatchObject({ status: "failed", error: expect.stringMatching(/cached plan file was not found/) });
    expect(missing.history.at(-1)).toMatchObject({ type: "error", stage: "planning", data: { code: "CACHED_PLAN_MISSING" } });

    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ title: "x", steps: [{ id: 2, action: "click", caption: "c" }] }));
    settings = { cachedPlan: bad };
    const invalid = await runJob(pipelineWith(spied().registry));
    expect(invalid.history.at(-1)).toMatchObject({ data: { code: "CACHED_PLAN_INVALID" } });

    writeFileSync(bad, "{ not json");
    const notJson = await runJob(pipelineWith(spied().registry));
    expect(notJson.history.at(-1)).toMatchObject({ data: { code: "CACHED_PLAN_INVALID" } });
  });

  it("the shipped docs/fallback/cached-plan.json is a valid plan", () => {
    expect(loadCachedPlan(DEFAULT_CACHED_PLAN_FILE).steps.length).toBeGreaterThan(0);
  });
});

describe("cached video (E7-7)", () => {
  it("skips launch, planning and the run, and serves the cached video with a log line", async () => {
    settings = { cachedPlan: join(dir, "ignored.json") }; // cached-video wins over the cached plan
    const s = spied();
    const { job, history } = await runJob(pipelineWith(s.registry), { fallback: "cached-video" });

    expect(job.status).toBe("done");
    expect(s.launchProject).not.toHaveBeenCalled();
    expect(s.planDemo).not.toHaveBeenCalled();
    expect(s.runPlan).not.toHaveBeenCalled();
    expect(job.run?.videoPath).toBe(video);
    expect(history.map((e) => e.type)).toEqual(["stage", "log", "done"]);
    expect(history[1]).toMatchObject({ message: expect.stringMatching(/cached video .*not launched or recorded/) });

    const app = await buildServer({ store, events, cachedVideoFile: video });
    const full = await app.inject({ method: "GET", url: `/api/jobs/${job.id}/video` });
    const part = await app.inject({ method: "GET", url: `/api/jobs/${job.id}/video`, headers: { range: "bytes=2-4" } });
    const log = await app.inject({ method: "GET", url: `/api/jobs/${job.id}/log` });
    await app.close();
    expect(full.statusCode).toBe(200);
    expect(full.body).toBe("0123456789");
    expect(part.statusCode).toBe(206);
    expect(part.body).toBe("234");
    expect(log.body).toMatch(/Fallback: serving the cached video/);
  });

  it("fails clearly when the cached video is missing", async () => {
    rmSync(video);
    const { job, history } = await runJob(pipelineWith(spied().registry), { fallback: "cached-video" });
    expect(job).toMatchObject({ status: "failed", error: expect.stringMatching(/cached demo video was not found/) });
    expect(history.at(-1)).toMatchObject({ data: { code: "CACHED_VIDEO_MISSING" } });
  });

  it("the shipped docs/fallback/cached-demo.mp4 exists", () => {
    expect(readFileSync(CACHED_VIDEO_FILE).length).toBeGreaterThan(1000);
  });
});

describe("POST /api/jobs fallback field", () => {
  it("accepts the two switches and rejects anything else", async () => {
    const app = await buildServer({ store });
    const post = (fallback: unknown) =>
      app.inject({ method: "POST", url: "/api/jobs", payload: { source: "a", instructions: "x", fallback } });
    expect((await post("cached-plan")).statusCode).toBe(201);
    expect((await post("cached-video")).statusCode).toBe(201);
    expect((await post("cached-everything")).statusCode).toBe(400);
    await app.close();
  });
});

describe("liveSetting", () => {
  it("re-reads .env on every call", () => {
    const env = join(dir, ".env");
    writeFileSync(env, "DEMOFORGE_TEST_LIVE=one\n");
    expect(liveSetting("DEMOFORGE_TEST_LIVE", env)).toBe("one");
    writeFileSync(env, "DEMOFORGE_TEST_LIVE=two\n");
    expect(liveSetting("DEMOFORGE_TEST_LIVE", env)).toBe("two");
    writeFileSync(env, "\n");
    expect(liveSetting("DEMOFORGE_TEST_LIVE", env)).toBeUndefined();
  });

  it("variables from the shell at startup still win over .env", () => {
    const env = join(dir, ".env");
    writeFileSync(env, "PATH=/from-dotenv\n");
    expect(liveSetting("PATH", env)).toBe(process.env.PATH);
  });
});

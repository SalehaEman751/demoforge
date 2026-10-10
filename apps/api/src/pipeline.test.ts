import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Job } from "@demoforge/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobEvents } from "./events.js";
import { Pipeline, resolveProjectSource } from "./pipeline.js";
import { createRegistry, type Registry } from "./registry.js";
import { JobStore } from "./store.js";

let dir: string;
let store: JobStore;
let events: JobEvents;
let base: Registry;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "df-pipe-"));
  store = new JobStore(dir);
  events = new JobEvents((id) => store.jobDir(id));
  base = await createRegistry({ useMocks: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const make = (overrides: Partial<Registry> = {}) =>
  new Pipeline({ store, events, registry: { ...base, ...overrides }, settings: () => ({}) });
const onDisk = (id: string): Job => JSON.parse(readFileSync(join(store.jobDir(id), "job.json"), "utf8"));
const req = { source: "./samples/taskly", instructions: "sign up" };

describe("Pipeline", () => {
  it("runs every stage in order and ends done with all results", async () => {
    const stop = vi.fn(async () => {});
    const runPlan: Registry["runPlan"] = async (args) => {
      args.onEvent?.({ type: "step", stepId: 1, message: "Open the app" });
      args.onEvent?.({ type: "done", message: "runner finished" }); // must not end the stream
      return base.runPlan(args);
    };
    const seen: Record<string, unknown> = {};
    const pipeline = make({
      launchProject: async (a) => ({ ...(await base.launchProject(a)), stop }),
      inspectProject: async (a) => ((seen.inspect = a), base.inspectProject(a)),
      runPlan: async (a) => ((seen.outDir = a.outDir), (seen.repair = a.repair), runPlan(a)),
    });
    const job = store.create({ ...req, allowAuthProbe: true });
    pipeline.enqueue(job.id);
    await pipeline.idle();

    const done = onDisk(job.id);
    expect(done.status).toBe("done");
    expect(done.info && done.brief && done.inventory && done.plan && done.run && done.metrics).toBeTruthy();
    expect(stop).toHaveBeenCalledTimes(1);
    expect((seen.inspect as { allowAuthProbe: boolean }).allowAuthProbe).toBe(true);
    expect(seen.outDir).toBe(join(store.jobDir(job.id), "out"));
    expect(seen.repair).toBe(base.repairStep);

    const evs = events.history(job.id);
    expect(evs.filter((e) => e.type === "stage").map((e) => e.stage)).toEqual([
      "launching",
      "inspecting",
      "planning",
      "running",
    ]);
    expect(evs.some((e) => e.type === "step" && e.stepId === 1)).toBe(true);
    expect(evs.filter((e) => e.type === "done")).toHaveLength(1);
    expect(evs.at(-1)?.type).toBe("done");
    expect(evs.some((e) => e.type === "log" && /runner finished/.test(e.message ?? ""))).toBe(true);
  });

  it("does not allow the auth probe unless the job opted in", async () => {
    let flag: boolean | undefined;
    const pipeline = make({ inspectProject: async (a) => ((flag = a.allowAuthProbe), base.inspectProject(a)) });
    pipeline.enqueue(store.create(req).id);
    await pipeline.idle();
    expect(flag).toBe(false);
  });

  it("passes launch options through to launchProject", async () => {
    let args: unknown;
    const pipeline = make({ launchProject: async (a) => ((args = a), base.launchProject(a)) });
    pipeline.enqueue(store.create({ ...req, startCommand: "npm run dev", port: 3100, subdir: "web" }).id);
    await pipeline.idle();
    expect(args).toMatchObject({ source: resolveProjectSource(req.source), startCommand: "npm run dev", port: 3100, subdir: "web" });
  });

  it("persists the job after every stage", async () => {
    const snapshots: Record<string, Job> = {};
    const job = store.create(req);
    const pipeline = make({
      inspectProject: async (a) => ((snapshots.inspect = onDisk(job.id)), base.inspectProject(a)),
      planDemo: async (a) => ((snapshots.plan = onDisk(job.id)), base.planDemo(a)),
      runPlan: async (a) => ((snapshots.run = onDisk(job.id)), base.runPlan(a)),
      computeMetrics: (a) => ((snapshots.metrics = onDisk(job.id)), base.computeMetrics(a)),
    });
    pipeline.enqueue(job.id);
    await pipeline.idle();
    expect(snapshots.inspect).toMatchObject({ status: "inspecting" });
    expect(snapshots.inspect?.info).toBeDefined();
    expect(snapshots.plan).toMatchObject({ status: "planning" });
    expect(snapshots.plan?.inventory).toBeDefined();
    expect(snapshots.run).toMatchObject({ status: "running" });
    expect(snapshots.run?.plan).toBeDefined();
    expect(snapshots.metrics?.run).toBeDefined();
  });

  it("passes start and end times to computeMetrics", async () => {
    let args: { startedAt: number; finishedAt: number } | undefined;
    const pipeline = make({ computeMetrics: (a) => ((args = a), base.computeMetrics(a)) });
    pipeline.enqueue(store.create(req).id);
    await pipeline.idle();
    expect(args!.startedAt).toBeGreaterThan(0);
    expect(args!.finishedAt).toBeGreaterThanOrEqual(args!.startedAt);
  });

  it("fails the job, emits error, and still stops the project when a stage throws", async () => {
    const stop = vi.fn(async () => {});
    const pipeline = make({
      launchProject: async (a) => ({ ...(await base.launchProject(a)), stop }),
      planDemo: async () => {
        throw new Error("model unreachable");
      },
    });
    const job = store.create(req);
    pipeline.enqueue(job.id);
    await pipeline.idle();
    const failed = onDisk(job.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("The demo plan could not be created. model unreachable");
    expect(failed.info).toBeDefined(); // earlier stages stay saved
    expect(failed.plan).toBeUndefined();
    expect(stop).toHaveBeenCalledTimes(1);
    const last = events.history(job.id).at(-1);
    expect(last).toMatchObject({
      type: "error",
      stage: "planning",
      message: failed.error,
      data: { code: "PLAN_FAILED", stage: "planning", detail: "model unreachable" },
    });
  });

  it("fails cleanly when launching fails (nothing to stop)", async () => {
    const pipeline = make({
      launchProject: async () => {
        throw new Error("port in use");
      },
    });
    const job = store.create(req);
    pipeline.enqueue(job.id);
    await pipeline.idle();
    expect(onDisk(job.id)).toMatchObject({ status: "failed", error: "The project could not be started. port in use" });
  });

  it("a failing stop() does not change the outcome", async () => {
    const pipeline = make({
      launchProject: async (a) => ({
        ...(await base.launchProject(a)),
        stop: async () => {
          throw new Error("kill failed");
        },
      }),
    });
    const job = store.create(req);
    pipeline.enqueue(job.id);
    await pipeline.idle();
    expect(onDisk(job.id).status).toBe("done");
  });

  it("runs one job at a time; later jobs stay queued", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const started: string[] = [];
    const pipeline = make({
      launchProject: async (a) => {
        const name = basename(a.source); // the pipeline resolves relative sources to absolute paths
        started.push(name);
        if (name === "first") await gate;
        return base.launchProject(a);
      },
    });
    const first = store.create({ ...req, source: "first" });
    const second = store.create({ ...req, source: "second" });
    pipeline.enqueue(first.id);
    pipeline.enqueue(second.id);
    await new Promise((r) => setTimeout(r, 20));
    expect(started).toEqual(["first"]);
    expect(store.get(first.id)?.status).toBe("launching");
    expect(store.get(second.id)?.status).toBe("queued");
    release();
    await pipeline.idle();
    expect(started).toEqual(["first", "second"]);
    expect(store.get(first.id)?.status).toBe("done");
    expect(store.get(second.id)?.status).toBe("done");
  });

  it("keeps going after a failed job", async () => {
    let n = 0;
    const pipeline = make({
      launchProject: async (a) => {
        if (n++ === 0) throw new Error("first broke");
        return base.launchProject(a);
      },
    });
    const a = store.create(req);
    const b = store.create(req);
    pipeline.enqueue(a.id);
    pipeline.enqueue(b.id);
    await pipeline.idle();
    expect(store.get(a.id)?.status).toBe("failed");
    expect(store.get(b.id)?.status).toBe("done");
  });
});

class LaunchError extends Error {
  override name = "LaunchError";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

describe("Pipeline failures (E7-5)", () => {
  it("maps a LaunchError code to a plain message and data.code", async () => {
    const pipeline = make({
      launchProject: async () => {
        throw new LaunchError("PORT_IN_USE", "EADDRINUSE 3000");
      },
    });
    const job = store.create(req);
    pipeline.enqueue(job.id);
    await pipeline.idle();
    const failed = onDisk(job.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/port is already used/);
    expect(events.history(job.id).at(-1)).toMatchObject({
      type: "error",
      stage: "launching",
      data: { code: "PORT_IN_USE", detail: "EADDRINUSE 3000" },
    });
  });

  it("maps an unreachable Ollama during planning to OLLAMA_DOWN", async () => {
    const pipeline = make({
      planDemo: async () => {
        throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
      },
    });
    const job = store.create(req);
    pipeline.enqueue(job.id);
    await pipeline.idle();
    expect(onDisk(job.id).error).toMatch(/ollama serve/);
    expect(events.history(job.id).at(-1)).toMatchObject({ data: { code: "OLLAMA_DOWN" } });
  });

  it("handles non-Error throws and keeps processing later jobs", async () => {
    let calls = 0;
    const pipeline = make({
      planDemo: async (a) => {
        if (calls++ === 0) throw undefined;
        return base.planDemo(a);
      },
    });
    const a = store.create(req);
    const b = store.create(req);
    pipeline.enqueue(a.id);
    pipeline.enqueue(b.id);
    await pipeline.idle();
    expect(onDisk(a.id).status).toBe("failed");
    expect(onDisk(b.id).status).toBe("done");
  });

  it("still emits the error event when saving the failed status throws", async () => {
    const pipeline = make({
      planDemo: async () => {
        throw new Error("boom");
      },
    });
    const job = store.create(req);
    const realUpdate = store.update.bind(store);
    vi.spyOn(store, "update").mockImplementation((id, patch) => {
      if (patch.status === "failed") throw new Error("disk full");
      return realUpdate(id, patch);
    });
    pipeline.enqueue(job.id);
    await pipeline.idle();
    expect(events.history(job.id).at(-1)).toMatchObject({ type: "error", data: { code: "PLAN_FAILED" } });
  });
});

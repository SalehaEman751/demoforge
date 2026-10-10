/**
 * End-to-end over HTTP with USE_MOCKS=1: real server, real pipeline, real event log,
 * every pipeline module resolved to its fixture mock through the registry (no browser, no model).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobSchema, type JobEvent } from "@demoforge/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { JobEvents } from "./events.js";
import { Pipeline } from "./pipeline.js";
import { createRegistry, type Registry } from "./registry.js";
import { buildServer } from "./server.js";
import { JobStore } from "./store.js";

let savedUseMocks: string | undefined;
beforeAll(() => {
  savedUseMocks = process.env.USE_MOCKS;
  process.env.USE_MOCKS = "1";
});
afterAll(() => {
  if (savedUseMocks === undefined) delete process.env.USE_MOCKS;
  else process.env.USE_MOCKS = savedUseMocks;
});

let dir: string;
let app: FastifyInstance | undefined;
let url: string;
let store: JobStore;
let events: JobEvents;
let pipeline: Pipeline;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "df-e2e-"));
});
afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/** Start the whole api on a free port. `patch` swaps single registry functions (to make a stage fail). */
async function start(patch: (r: Registry) => Partial<Registry> = () => ({})): Promise<Registry> {
  const base = await createRegistry(); // no useMocks option: must come from USE_MOCKS=1
  const registry = { ...base, ...patch(base) };
  store = new JobStore(join(dir, "jobs"));
  events = new JobEvents((id) => store.jobDir(id));
  pipeline = new Pipeline({ store, events, registry, settings: () => ({}) });
  app = await buildServer({ store, pipeline, events });
  url = await app.listen({ port: 0, host: "127.0.0.1" });
  return registry;
}

const createJob = async (): Promise<string> => {
  const res = await fetch(`${url}/api/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "./samples/taskly", instructions: "Sign up and add a task", allowAuthProbe: true }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
};

/** Read an SSE stream until the server closes it. */
const readEvents = async (id: string): Promise<JobEvent[]> => {
  const res = await fetch(`${url}/api/jobs/${id}/events`);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const body = await res.text();
  return body
    .split("\n\n")
    .map((f) => /^data: (.*)$/m.exec(f)?.[1])
    .filter((d): d is string => d !== undefined)
    .map((d) => JSON.parse(d) as JobEvent);
};

const getJob = async (id: string) => JobSchema.parse(await (await fetch(`${url}/api/jobs/${id}`)).json());

describe("api with USE_MOCKS=1", () => {
  it("uses only mocks", async () => {
    const registry = await start();
    expect(registry.status().map((s) => [s.name, s.source, s.reason])).toEqual([
      ["launchProject", "mock", "USE_MOCKS=1"],
      ["inspectProject", "mock", "USE_MOCKS=1"],
      ["planDemo", "mock", "USE_MOCKS=1"],
      ["runPlan", "mock", "USE_MOCKS=1"],
      ["repairStep", "mock", "USE_MOCKS=1"],
      ["computeMetrics", "mock", "USE_MOCKS=1"],
    ]);
  });

  it("a full job completes with every stage's output saved", async () => {
    await start();
    const id = await createJob();
    const live = await readEvents(id); // connected right away, follows to the end

    expect(live.map((e) => (e.type === "stage" ? `stage:${e.stage}` : e.type))).toEqual([
      "stage:launching",
      "stage:inspecting",
      "stage:planning",
      "stage:running",
      "done",
    ]);
    const job = await getJob(id);
    expect(job.status).toBe("done");
    expect(job.error).toBeUndefined();
    for (const key of ["info", "brief", "inventory", "plan", "run", "metrics"] as const) expect(job[key]).toBeDefined();
    expect(job.run!.results).toHaveLength(job.plan!.steps.length);
  });

  it("a late SSE client gets every earlier event, in order, and the stream closes", async () => {
    await start();
    const id = await createJob();
    const first = await readEvents(id);
    await pipeline.idle();
    expect((await getJob(id)).status).toBe("done");

    // Job is long finished: two late clients must each get the full history.
    const late1 = await readEvents(id);
    const late2 = await readEvents(id);
    expect(late1).toEqual(first);
    expect(late2).toEqual(first);
    expect(late1.at(-1)?.type).toBe("done");

    // A client that joins mid-job also gets the events it missed.
    const second = await createJob();
    const mid = await readEvents(second);
    expect(mid[0]).toMatchObject({ type: "stage", stage: "launching" });
    expect(mid.at(-1)?.type).toBe("done");
  });

  it("a failing stage still calls stop() and the job fails with a plain message", async () => {
    const terminalSentBeforeStop: boolean[] = [];
    const stop = vi.fn(async () => {
      // Record whether any client could already have seen the end of the job.
      terminalSentBeforeStop.push(store.list().some((j) => events.history(j.id).some((e) => e.type === "error")));
    });
    await start((base) => ({
      launchProject: async (args) => ({ ...(await base.launchProject(args)), stop }),
      planDemo: async () => {
        throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:11434"), { name: "OllamaError", code: "OLLAMA_DOWN" });
      },
    }));
    const id = await createJob();
    const evs = await readEvents(id);

    expect(stop).toHaveBeenCalledTimes(1);
    expect(terminalSentBeforeStop).toEqual([false]); // stop() ran before the error event went out
    expect(evs.map((e) => e.type)).toEqual(["stage", "stage", "stage", "error"]);
    expect(evs.at(-1)).toMatchObject({
      type: "error",
      stage: "planning",
      message: "The local AI model server is not running. Start it with: ollama serve",
      data: { code: "OLLAMA_DOWN", stage: "planning", message: "The local AI model server is not running. Start it with: ollama serve", hint: "Start it with: ollama serve" },
    });
    const job = await getJob(id);
    expect(job).toMatchObject({ status: "failed", error: "The local AI model server is not running. Start it with: ollama serve" });
    expect(job.plan).toBeUndefined();

    // The server is still up and runs the next job.
    const health = await fetch(`${url}/api/jobs`);
    expect(health.status).toBe(200);
  });

  it("stop() is called for a failure in every stage after launch", async () => {
    const boom = async () => {
      throw new Error("boom");
    };
    const cases: Array<[string, (b: Registry) => Partial<Registry>]> = [
      ["inspecting", () => ({ inspectProject: boom })],
      ["planning", () => ({ planDemo: boom })],
      ["running", () => ({ runPlan: boom })],
      [
        "metrics",
        () => ({
          computeMetrics: () => {
            throw new Error("boom");
          },
        }),
      ],
    ];
    for (const [stage, failing] of cases) {
      const stop = vi.fn(async () => {});
      await start((base) => ({
        ...failing(base),
        launchProject: async (args) => ({ ...(await base.launchProject(args)), stop }),
      }));
      const id = await createJob();
      const evs = await readEvents(id);
      expect(stop, `stop() after a ${stage} failure`).toHaveBeenCalledTimes(1);
      expect(evs.at(-1)).toMatchObject({ type: "error", stage });
      await app!.close();
      app = undefined;
    }
  });
});

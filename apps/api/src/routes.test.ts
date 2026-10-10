import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobEvent } from "@demoforge/shared";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobEvents } from "./events.js";
import { parseRange } from "./media.js";
import { buildServer } from "./server.js";
import { JobStore } from "./store.js";

let dir: string;
let store: JobStore;
let events: JobEvents;
let app: FastifyInstance;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "df-routes-"));
  store = new JobStore(dir);
  events = new JobEvents((id) => store.jobDir(id));
  app = await buildServer({
    store,
    events,
    heartbeatMs: 20,
    health: async () => ({ ok: false, items: [{ id: "ffmpeg", label: "ffmpeg", ok: false, detail: "x", fix: "y" }] }),
  });
});
afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const newJob = () => store.create({ source: "./samples/taskly", instructions: "sign up" });

/** Parse an SSE body into [id, event] pairs. */
const frames = (body: string): Array<[number, JobEvent]> =>
  body
    .split("\n\n")
    .filter((f) => f.includes("data: "))
    .map((f) => {
      const id = Number(/^id: (\d+)$/m.exec(f)?.[1]);
      const data = /^data: (.*)$/m.exec(f)?.[1] ?? "{}";
      return [id, JSON.parse(data) as JobEvent];
    });

describe("GET /api/jobs/:id/events", () => {
  it("a late client gets every earlier event, then the stream closes", async () => {
    const job = newJob();
    events.emit(job.id, { type: "stage", stage: "launching" });
    events.emit(job.id, { type: "step", stepId: 1, message: "Open home" });
    events.emit(job.id, { type: "done", message: "Demo ready" });
    store.update(job.id, { status: "done" });

    const res = await app.inject({ method: "GET", url: `/api/jobs/${job.id}/events`, headers: { origin: "http://localhost:3000" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(frames(res.body)).toEqual([
      [0, { type: "stage", stage: "launching" }],
      [1, { type: "step", stepId: 1, message: "Open home" }],
      [2, { type: "done", message: "Demo ready" }],
    ]);
  });

  it("resumes after Last-Event-ID", async () => {
    const job = newJob();
    events.emit(job.id, { type: "stage", stage: "launching" });
    events.emit(job.id, { type: "stage", stage: "planning" });
    events.emit(job.id, { type: "error", message: "nope" });
    const res = await app.inject({ method: "GET", url: `/api/jobs/${job.id}/events`, headers: { "last-event-id": "0" } });
    expect(frames(res.body).map(([id]) => id)).toEqual([1, 2]);
  });

  it("ends a finished job whose log has no terminal event (e.g. after a restart)", async () => {
    const job = newJob();
    events.emit(job.id, { type: "stage", stage: "launching" });
    store.update(job.id, { status: "failed", error: "Interrupted by server restart" });
    const res = await app.inject({ method: "GET", url: `/api/jobs/${job.id}/events` });
    expect(frames(res.body).at(-1)?.[1]).toMatchObject({ type: "error", message: "Interrupted by server restart" });
  });

  it("streams live events to clients that joined at different times", async () => {
    const job = newJob();
    const url = await app.listen({ port: 0, host: "127.0.0.1" });
    const read = async (): Promise<string> => {
      const res = await fetch(`${url}/api/jobs/${job.id}/events`);
      return res.text(); // resolves when the server ends the stream
    };

    events.emit(job.id, { type: "stage", stage: "launching" });
    const early = read();
    await new Promise((r) => setTimeout(r, 50)); // let it subscribe, and see a heartbeat
    events.emit(job.id, { type: "stage", stage: "planning" });
    const late = read();
    await new Promise((r) => setTimeout(r, 50));
    events.emit(job.id, { type: "done" });

    const expected = [
      { type: "stage", stage: "launching" },
      { type: "stage", stage: "planning" },
      { type: "done" },
    ];
    const [a, b] = await Promise.all([early, late]);
    expect(frames(a).map(([, e]) => e)).toEqual(expected);
    expect(frames(b).map(([, e]) => e)).toEqual(expected);
    expect(a).toContain(": ping");
  });

  it("404s for unknown jobs", async () => {
    const res = await app.inject({ method: "GET", url: "/api/jobs/job_00000000/events" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });
});

describe("GET /api/jobs/:id/video and /log", () => {
  const VIDEO = Buffer.from("0123456789abcdefghij"); // 20 bytes

  const withRun = () => {
    const job = newJob();
    const out = join(store.jobDir(job.id), "out");
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "demo.mp4"), VIDEO);
    writeFileSync(join(out, "run.log"), "step #1 ok Open home\n");
    store.update(job.id, {
      status: "done",
      run: { videoPath: join(out, "demo.mp4"), logPath: join(out, "run-log.json"), results: [], startedAt: 1, finishedAt: 2 },
    });
    return job.id;
  };
  const get = (url: string, range?: string, method: "GET" | "HEAD" = "GET") =>
    app.inject({ method, url, headers: range ? { range } : {} });

  it("sends the whole video with Accept-Ranges", async () => {
    const id = withRun();
    const res = await get(`/api/jobs/${id}/video`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("video/mp4");
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.rawPayload.equals(VIDEO)).toBe(true);
  });

  it("answers Range requests with 206 so the browser can seek", async () => {
    const id = withRun();
    const mid = await get(`/api/jobs/${id}/video`, "bytes=5-9");
    expect(mid.statusCode).toBe(206);
    expect(mid.headers["content-range"]).toBe("bytes 5-9/20");
    expect(mid.headers["content-length"]).toBe("5");
    expect(mid.body).toBe("56789");

    const open = await get(`/api/jobs/${id}/video`, "bytes=15-");
    expect(open.body).toBe("fghij");
    const suffix = await get(`/api/jobs/${id}/video`, "bytes=-3");
    expect(suffix.body).toBe("hij");
    const clamp = await get(`/api/jobs/${id}/video`, "bytes=18-999");
    expect(clamp.headers["content-range"]).toBe("bytes 18-19/20");
  });

  it("416 for a range past the end", async () => {
    const id = withRun();
    const res = await get(`/api/jobs/${id}/video`, "bytes=20-");
    expect(res.statusCode).toBe(416);
    expect(res.headers["content-range"]).toBe("bytes */20");
  });

  it("HEAD returns headers only", async () => {
    const id = withRun();
    const res = await get(`/api/jobs/${id}/video`, undefined, "HEAD");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-length"]).toBe("20");
    expect(res.body).toBe("");
  });

  it("serves the run log as text", async () => {
    const id = withRun();
    const res = await get(`/api/jobs/${id}/log`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toBe("step #1 ok Open home\n");
  });

  it("404 not_available before the job has a video or log", async () => {
    const job = newJob();
    for (const what of ["video", "log"]) {
      const res = await get(`/api/jobs/${job.id}/${what}`);
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatchObject({ code: "not_available", message: expect.stringMatching(/not ready/) });
    }
  });

  it("never serves files outside the job folder", async () => {
    const job = newJob();
    const outside = join(dir, "secret.mp4");
    writeFileSync(outside, "secret");
    store.update(job.id, {
      status: "done",
      run: { videoPath: outside, logPath: "../../x/run-log.json", results: [], startedAt: 1, finishedAt: 2 },
    });
    expect((await get(`/api/jobs/${job.id}/video`)).statusCode).toBe(404);
    expect((await get(`/api/jobs/${job.id}/log`)).statusCode).toBe(404);
  });
});

describe("parseRange", () => {
  it("parses single ranges and rejects bad ones", () => {
    expect(parseRange(undefined, 10)).toBeUndefined();
    expect(parseRange("bytes=0-0", 10)).toEqual({ start: 0, end: 0 });
    expect(parseRange("bytes=-20", 10)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=0-1,4-5", 10)).toBeUndefined(); // multi-range: send it all
    expect(parseRange("items=0-1", 10)).toBeUndefined();
    expect(parseRange("bytes=5-2", 10)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 10)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-", 0)).toBe("unsatisfiable");
  });
});

describe("GET /api/health", () => {
  it("always answers 200 with the report", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false, items: [{ id: "ffmpeg", fix: "y" }] });
  });

  it("reports mocks: true when the server runs with mocks", async () => {
    const plain = await app.inject({ method: "GET", url: "/api/health" });
    expect(plain.json().mocks).toBe(false);
    const mocked = await buildServer({ store, mocks: true, health: async () => ({ ok: true, items: [] }) });
    const res = await mocked.inject({ method: "GET", url: "/api/health" });
    await mocked.close();
    expect(res.json()).toEqual({ ok: true, items: [], mocks: true });
  });

  it("turns a throwing check into a red item instead of a 500", async () => {
    const broken = await buildServer({
      store,
      health: async () => {
        throw new Error("kaboom");
      },
    });
    const res = await broken.inject({ method: "GET", url: "/api/health" });
    await broken.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false, items: [{ ok: false, detail: "kaboom" }] });
  });
});

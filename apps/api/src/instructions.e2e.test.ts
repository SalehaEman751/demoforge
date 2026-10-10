/**
 * E11-4: instructions are optional guidance. Empty, missing or whitespace-only all work and are stored as "".
 * Real startup path (startServer), USE_MOCKS=1, real HTTP.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobSchema, type Plan } from "@demoforge/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { startServer, type Started } from "./app.js";

let dir: string;
let savedUseMocks: string | undefined;
let server: Started;

beforeAll(() => {
  savedUseMocks = process.env.USE_MOCKS;
  process.env.USE_MOCKS = "1";
});
afterAll(() => {
  if (savedUseMocks === undefined) delete process.env.USE_MOCKS;
  else process.env.USE_MOCKS = savedUseMocks;
});
afterEach(async () => {
  await server.app.close();
  rmSync(dir, { recursive: true, force: true });
});

async function start() {
  dir = mkdtempSync(join(tmpdir(), "df-instr-"));
  // No sample video here (the path does not exist and ffmpeg is pointed nowhere), this file tests requests only.
  server = await startServer({
    port: 0,
    host: "127.0.0.1",
    jobsDir: join(dir, "jobs"),
    sampleVideo: join(dir, "none.mp4"),
    ffmpegBin: "ffmpeg-not-used",
    log: () => {},
  });
  return server;
}

const post = (body: unknown) =>
  fetch(`${server.url}/api/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function created(body: unknown) {
  const res = await post(body);
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await server.pipeline.idle();
  return JobSchema.parse(await (await fetch(`${server.url}/api/jobs/${id}`)).json());
}

describe("optional instructions (E11-4)", () => {
  it('(a) instructions: "" returns 201 and the job completes', async () => {
    await start();
    const job = await created({ source: "samples/taskly", instructions: "" });
    expect(job).toMatchObject({ status: "done", instructions: "" });
    expect(job.plan).toBeDefined();
  });

  it('(b) no instructions field returns 201, completes, and is stored as ""', async () => {
    await start();
    const job = await created({ source: "samples/taskly" });
    expect(job).toMatchObject({ status: "done", instructions: "" });
    // Also "" in the saved request, so a restart reloads it the same way.
    expect(server.store.getRequest(job.id)?.instructions).toBe("");
  });

  it('(c) whitespace-only instructions returns 201 and is stored as ""', async () => {
    await start();
    const job = await created({ source: "samples/taskly", instructions: "  \n\t  " });
    expect(job.instructions).toBe("");
    expect(job.status).toBe("done");
  });

  it("(d) missing or blank source returns 400 { error: { code, message } }", async () => {
    await start();
    for (const body of [{ instructions: "x" }, {}, { source: "   " }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      const { error } = (await res.json()) as { error: { code: string; message: string } };
      expect(error.code).toBe("invalid_request");
      expect(error.message).toMatch(/source/);
    }
  });

  it("passes the empty string to planDemo unchanged (no default invented by the api)", async () => {
    await start();
    const seen: string[] = [];
    const original = server.registry.planDemo;
    const spy = vi.fn(async (args: Parameters<typeof original>[0]): Promise<Plan> => {
      seen.push(args.instructions);
      return original(args);
    });
    // The pipeline reads registry functions at call time, so swapping it here is seen by the next job.
    (server.registry as { planDemo: typeof original }).planDemo = spy;
    await created({ source: "samples/taskly" });
    await created({ source: "samples/taskly", instructions: " Show signup " });
    expect(seen).toEqual(["", "Show signup"]);
  });
});

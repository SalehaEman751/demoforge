import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import { JobStore } from "./store.js";

let dir: string;
let app: FastifyInstance;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "df-api-"));
  app = await buildServer({ store: new JobStore(dir) });
});
afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (payload: unknown) => app.inject({ method: "POST", url: "/api/jobs", payload: payload as object });

describe("jobs API", () => {
  it("POST creates a job (201 { id }) that GET can read back", async () => {
    const res = await post({ source: "./samples/taskly", instructions: "sign up", port: 3100 });
    expect(res.statusCode).toBe(201);
    const { id } = res.json();
    expect(id).toMatch(/^job_/);
    const got = await app.inject({ method: "GET", url: `/api/jobs/${id}` });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({ id, status: "queued", projectSource: "./samples/taskly" });
  });

  it("POST hands the new job id to the pipeline", async () => {
    const enqueued: string[] = [];
    const piped = await buildServer({ store: new JobStore(dir), pipeline: { enqueue: (id) => enqueued.push(id) } });
    const res = await piped.inject({ method: "POST", url: "/api/jobs", payload: { source: "a", instructions: "x" } });
    await piped.close();
    expect(enqueued).toEqual([res.json().id]);
  });

  it("GET /api/jobs lists newest first", async () => {
    const a = (await post({ source: "a", instructions: "x" })).json().id;
    const b = (await post({ source: "b", instructions: "x" })).json().id;
    const res = await app.inject({ method: "GET", url: "/api/jobs" });
    expect(res.json().map((j: { id: string }) => j.id)).toEqual([b, a]);
  });

  it("rejects invalid bodies with 400 { error: { code, message } }", async () => {
    // { source: "a" } is valid since E11-4 (instructions are optional).
    for (const bad of [{}, { instructions: "x" }, { source: "", instructions: "x" }, { source: "  " }, { source: "a", instructions: "x", port: 99999 }, { source: "a", instructions: 5 }]) {
      const res = await post(bad);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("invalid_request");
      expect(typeof res.json().error.message).toBe("string");
    }
  });

  it("rejects malformed JSON with a 400 in the error shape", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/jobs",
      headers: { "content-type": "application/json" },
      payload: "{oops",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });

  it("returns 404 in the error shape for unknown jobs and routes", async () => {
    const job = await app.inject({ method: "GET", url: "/api/jobs/job_00000000" });
    expect(job.statusCode).toBe(404);
    expect(job.json().error.code).toBe("not_found");
    const traversal = await app.inject({ method: "GET", url: "/api/jobs/..%2F..%2Fetc" });
    expect(traversal.statusCode).toBe(404);
    const route = await app.inject({ method: "GET", url: "/nope" });
    expect(route.statusCode).toBe(404);
    expect(route.json().error.code).toBe("not_found");
  });

  it("allows CORS from http://localhost:3000 only", async () => {
    const ok = await app.inject({ method: "GET", url: "/api/jobs", headers: { origin: "http://localhost:3000" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    const other = await app.inject({ method: "GET", url: "/api/jobs", headers: { origin: "http://evil.test" } });
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
    const pre = await app.inject({
      method: "OPTIONS",
      url: "/api/jobs",
      headers: { origin: "http://localhost:3000", "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
    });
    expect(pre.statusCode).toBe(204);
  });
});

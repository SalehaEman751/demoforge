import { JobSchema, loadFixture } from "@demoforge/shared";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { httpExecutor, runBatch } from "./client.js";

/** A fake DemoForge API on a random local port. `mode` per job id decides how it behaves. */
const fixtureJob = loadFixture("job.json", JobSchema);
let server: Server;
let api: string;
let created = 0;
const modes = new Map<string, string>();
const bodies: unknown[] = [];
const sequence = ["ok", "post500", "failed", "noevents", "ndjson", "hang"];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => resolve(s));
  });
}

beforeAll(async () => {
  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "";
    if (req.method === "POST" && url === "/api/jobs") {
      bodies.push(JSON.parse(await readBody(req)));
      const mode = sequence[created++ % sequence.length]!;
      if (mode === "post500") return void res.writeHead(500).end("kaboom");
      const id = `job_${created}`;
      modes.set(id, mode);
      return void res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ id }));
    }
    const m = /^\/api\/jobs\/([^/]+)(\/events)?$/.exec(url);
    const mode = m ? modes.get(m[1]!) : undefined;
    if (!m || !mode) return void res.writeHead(404).end();
    if (m[2]) {
      if (mode === "noevents") return void res.writeHead(404).end();
      if (mode === "hang") return void res.writeHead(200, { "content-type": "text/event-stream" }).write(": hi\n\n");
      res.writeHead(200, { "content-type": "text/event-stream" });
      const last = mode === "failed" ? { type: "error", message: "planner crashed" } : { type: "done" };
      const frame = mode === "ndjson" ? (e: object) => JSON.stringify(e) + "\n" : (e: object) => `event: x\ndata: ${JSON.stringify(e)}\n\n`;
      res.write(frame({ type: "stage", stage: "running" }));
      return void res.end(frame(last));
    }
    const job = mode === "hang" ? { ...fixtureJob, id: m[1], status: "running", run: undefined, metrics: undefined } : mode === "failed" ? { ...fixtureJob, id: m[1], status: "failed", error: "planner crashed", plan: undefined, run: undefined, metrics: undefined } : { ...fixtureJob, id: m[1] };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(job));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe("httpExecutor + runBatch against a fake API", () => {
  it("runs jobs one after another, survives every kind of failure, and reports each", async () => {
    const records = await runBatch({
      runs: 6,
      request: { source: "samples/taskly?variant=renamed", instructions: "Do it" },
      execute: httpExecutor({ api, timeoutMs: 1500, pollMs: 50 }),
    });

    expect(records.map((r) => [r.run, r.outcome])).toEqual([[1, "done"], [2, "error"], [3, "failed"], [4, "done"], [5, "done"], [6, "error"]]);
    expect(records[0]).toMatchObject({ jobId: "job_1", stepsNeedingRepair: 1 });
    expect(records[0]!.metrics?.stepsRepaired).toBe(1);
    expect(records[1]!.error).toMatch(/HTTP 500.*kaboom/);
    expect(records[2]!.error).toBe("planner crashed");
    expect(records[3]!.jobId).toBe("job_4"); // events endpoint 404: fell back to polling
    expect(records[4]!.outcome).toBe("done"); // newline-delimited JSON events
    expect(records[5]!.error).toMatch(/timed out/); // stream never ends, job never finishes
    expect(records.map((r) => r.errorCode)).toEqual([undefined, "http_error", "plan_failed", undefined, undefined, "timeout"]);
    expect(bodies[0]).toEqual({ source: "samples/taskly?variant=renamed", instructions: "Do it" });
  }, 20_000);

  it("reports an unreachable API as an error record instead of throwing", async () => {
    const [r] = await runBatch({ runs: 1, request: { source: "s", instructions: "i" }, execute: httpExecutor({ api: "http://127.0.0.1:1", timeoutMs: 1000 }) });
    expect(r).toMatchObject({ outcome: "error" });
    expect(r!.error).toMatch(/cannot reach the API/);
    expect(r!.errorCode).toBe("api_unreachable");
  });

  it("keeps going when the executor itself throws", async () => {
    let n = 0;
    const records = await runBatch({
      runs: 3, request: { source: "s", instructions: "i" },
      execute: async () => { if (++n === 2) throw new Error("bug"); return { outcome: "done" }; },
    });
    expect(records.map((r) => r.outcome)).toEqual(["done", "error", "done"]);
    expect(records[1]!.errorCode).toBe("eval_error");
  });
});

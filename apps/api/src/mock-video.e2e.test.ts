/**
 * Mock mode gives finished jobs a real, playable video (apps/api/.cache/demo.mp4 copied into the job).
 * Uses the real startup path (startServer) with USE_MOCKS=1 and real HTTP.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobSchema } from "@demoforge/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startServer, type Started } from "./app.js";
import { ensureSampleVideo } from "./sample-video.js";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const SKIP_NOTE = "SKIPPED: ffmpeg is not installed, so no sample video can be generated";
if (!hasFfmpeg) console.warn(`[mock-video.e2e] ${SKIP_NOTE}`);

let dir: string;
let sample: string;
let savedUseMocks: string | undefined;
let server: Started | undefined;

beforeAll(() => {
  savedUseMocks = process.env.USE_MOCKS;
  process.env.USE_MOCKS = "1";
  dir = mkdtempSync(join(tmpdir(), "df-mockvideo-"));
  sample = join(dir, "cache", "demo.mp4"); // stands in for apps/api/.cache/demo.mp4
});
afterAll(() => {
  if (savedUseMocks === undefined) delete process.env.USE_MOCKS;
  else process.env.USE_MOCKS = savedUseMocks;
  rmSync(dir, { recursive: true, force: true });
});
afterEach(async () => {
  await server?.app.close();
  server = undefined;
});

const quiet = () => {};
const start = (extra: Parameters<typeof startServer>[0] = {}) =>
  startServer({ port: 0, host: "127.0.0.1", jobsDir: mkdtempSync(join(dir, "jobs-")), sampleVideo: sample, log: quiet, ...extra });

/** Create a job and wait for it to finish. */
async function finishedJob(s: Started) {
  const res = await fetch(`${s.url}/api/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "samples/taskly", instructions: "Sign up" }),
  });
  expect(res.status).toBe(201);
  const { id } = (await res.json()) as { id: string };
  await s.pipeline.idle();
  return JobSchema.parse(await (await fetch(`${s.url}/api/jobs/${id}`)).json());
}

describe("mock sample video", () => {
  it.skipIf(!hasFfmpeg)(`GET /video serves a playable mp4 for a finished mock job${hasFfmpeg ? "" : ` (${SKIP_NOTE})`}`, async () => {
    server = await start();
    expect(statSync(sample).size).toBeGreaterThan(0); // generated at startup

    const job = await finishedJob(server);
    expect(job.status).toBe("done");
    expect(job.run!.videoPath).toBe(join(server.store.jobDir(job.id), "out", "demo.mp4"));
    expect(existsSync(job.run!.videoPath)).toBe(true);

    const res = await fetch(`${server.url}/api/jobs/${job.id}/video`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBeGreaterThan(0);
    expect(body.length).toBe(statSync(sample).size);
    expect(body.subarray(4, 8).toString("latin1")).toBe("ftyp"); // an MP4 file
  });

  it.skipIf(!hasFfmpeg)(`Range: bytes=0-99 returns 206 with the right Content-Range${hasFfmpeg ? "" : ` (${SKIP_NOTE})`}`, async () => {
    server = await start();
    const job = await finishedJob(server);
    const size = statSync(job.run!.videoPath).size;

    const res = await fetch(`${server.url}/api/jobs/${job.id}/video`, { headers: { range: "bytes=0-99" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 0-99/${size}`);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it("without ffmpeg the server still starts and the video stays 'not available'", async () => {
    const missing = join(dir, "never", "demo.mp4");
    const logs: string[] = [];
    server = await start({ sampleVideo: missing, ffmpegBin: "ffmpeg-does-not-exist", log: (m) => logs.push(m) });

    expect(logs.filter((l) => l.includes("WARNING"))).toHaveLength(1);
    expect(logs.find((l) => l.includes("WARNING"))).toMatch(/ffmpeg is not installed/);
    const job = await finishedJob(server);
    expect(job.status).toBe("done");
    const res = await fetch(`${server.url}/api/jobs/${job.id}/video`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_available");
  });

  it("does not regenerate an existing sample", async () => {
    if (!existsSync(sample)) return; // only meaningful once a sample exists
    const before = statSync(sample).mtimeMs;
    expect(await ensureSampleVideo({ file: sample, ffmpegBin: "ffmpeg-does-not-exist", log: quiet })).toBe(true);
    expect(statSync(sample).mtimeMs).toBe(before);
  });
});

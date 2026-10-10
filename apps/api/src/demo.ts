/**
 * npm run demo:api
 * Starts the API with USE_MOCKS=1 on a free port and a throwaway data folder, creates a job from
 * the fixtures, prints every event from the SSE stream, and exits 0 when the job is done (1 otherwise).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobEventSchema, JobSchema, loadFixture, type JobEvent } from "@demoforge/shared";
import { loadEnv, startServer } from "./app.js";

const TIMEOUT_MS = 60_000;

loadEnv();
process.env.USE_MOCKS = "1";
const dataDir = mkdtempSync(join(tmpdir(), "demoforge-api-demo-"));

const fixture = loadFixture("job.json", JobSchema);
const server = await startServer({ port: 0, jobsDir: dataDir, useMocks: true, log: (m) => console.log(m) });

async function finish(code: number, why: string): Promise<never> {
  console.log(why);
  await server.app.close().catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(code);
}

const timer = setTimeout(() => void finish(1, `[demo] timed out after ${TIMEOUT_MS / 1000}s`), TIMEOUT_MS);

try {
  const created = await fetch(`${server.url}/api/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: fixture.projectSource, instructions: fixture.instructions, allowAuthProbe: true }),
  });
  if (created.status !== 201) await finish(1, `[demo] POST /api/jobs returned ${created.status}: ${await created.text()}`);
  const { id } = (await created.json()) as { id: string };
  console.log(`[demo] created ${id}, following ${server.url}/api/jobs/${id}/events`);

  // Connecting after the job may already have started also shows the replay of earlier events.
  const res = await fetch(`${server.url}/api/jobs/${id}/events`);
  if (!res.ok || !res.body) await finish(1, `[demo] events stream returned ${res.status}`);

  let last: JobEvent | undefined;
  let buffer = "";
  const decoder = new TextDecoder();
  const reader = res.body!.getReader();
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    buffer += decoder.decode(r.value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!data) continue;
      last = JobEventSchema.parse(JSON.parse(data.slice(6)));
      console.log(`[event] ${JSON.stringify(last)}`);
    }
  }

  const job = JobSchema.parse(await (await fetch(`${server.url}/api/jobs/${id}`)).json());
  console.log(`[demo] job ${job.id} finished with status "${job.status}"`);
  if (job.metrics) console.log(`[demo] metrics ${JSON.stringify(job.metrics)}`);
  clearTimeout(timer);
  if (last?.type === "done" && job.status === "done") await finish(0, "[demo] OK");
  await finish(1, `[demo] job did not finish: ${job.error ?? last?.message ?? "stream ended early"}`);
} catch (e) {
  clearTimeout(timer);
  await finish(1, `[demo] failed: ${e instanceof Error ? e.message : String(e)}`);
}

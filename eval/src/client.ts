import { JobEventSchema, JobSchema, type Job } from "@demoforge/shared";
import { z } from "zod";
import type { ErrorCode, Execute, RunRecord } from "./types.js";

const Created = z
  .object({ id: z.string().optional(), jobId: z.string().optional() })
  .passthrough()
  .transform((v) => v.id ?? v.jobId)
  .pipe(z.string({ required_error: "no id in the POST /api/jobs response" }));

/** An eval-side problem with a code for the report. */
class ApiError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
  ) {
    super(message);
  }
}

/** Which stage a failed job stopped in, from the parts of the Job that exist. */
export function failedStage(job: Job): ErrorCode {
  if (!job.info) return "launch_failed";
  if (!job.brief || !job.inventory) return "inspect_failed";
  if (!job.plan) return "plan_failed";
  return "run_failed";
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const text = (e: unknown): string => {
  const code = (e as { cause?: { code?: string } }).cause?.code;
  return (e instanceof Error ? e.message : String(e)) + (code ? ` (${code})` : "");
};

export type ClientOptions = { api: string; timeoutMs: number; pollMs?: number };

/** Reads GET /api/jobs/:id/events until a `done` or `error` event. Accepts SSE (`data: {...}`) or one JSON event per line. */
async function followEvents(url: string, deadline: number): Promise<{ ended: "done" | "error" | "closed"; message?: string }> {
  const res = await fetch(url, { headers: { accept: "text/event-stream" }, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
  if (!res.ok || !res.body) throw new ApiError(`events endpoint answered HTTP ${res.status}`, "http_error");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return { ended: "closed" };
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || /^(:|event:|id:|retry:)/.test(line)) continue;
        let json: unknown;
        try {
          json = JSON.parse(line.replace(/^data:\s*/, ""));
        } catch {
          continue;
        }
        const event = JobEventSchema.safeParse(json);
        if (event.success && (event.data.type === "done" || event.data.type === "error")) {
          return { ended: event.data.type, message: event.data.message };
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function getJob(url: string, deadline: number): Promise<Job> {
  const res = await fetch(url, { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
  if (!res.ok) throw new ApiError(`GET ${new URL(url).pathname} answered HTTP ${res.status}`, "http_error");
  const parsed = JobSchema.safeParse(await res.json());
  if (!parsed.success) throw new ApiError(`job response does not match the Job contract: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`, "bad_response");
  return parsed.data;
}

const terminal = (j: Job): boolean => j.status === "done" || j.status === "failed";

/** The real executor: POST /api/jobs, follow the events, GET the job. Talks only to the HTTP API. */
export function httpExecutor({ api, timeoutMs, pollMs = 1000 }: ClientOptions): Execute {
  const base = api.replace(/\/+$/, "");
  return async ({ source, instructions }) => {
    const deadline = Date.now() + timeoutMs;
    let jobId: string | undefined;
    try {
      const post = await fetch(`${base}/api/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, instructions }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!post.ok) throw new ApiError(`POST /api/jobs answered HTTP ${post.status}: ${(await post.text()).slice(0, 200)}`, "http_error");
      const created = Created.safeParse(await post.json().catch(() => undefined));
      if (!created.success) throw new ApiError("no job id in the POST /api/jobs response", "bad_response");
      jobId = created.data;

      let eventMessage: string | undefined;
      try {
        eventMessage = (await followEvents(`${base}/api/jobs/${jobId}/events`, deadline)).message;
      } catch {
        /* no usable event stream (or it dropped): fall back to polling the job below */
      }

      let job = await getJob(`${base}/api/jobs/${jobId}`, deadline);
      while (!terminal(job)) {
        if (Date.now() >= deadline) throw new ApiError(`timed out after ${Math.round(timeoutMs / 1000)}s; job still "${job.status}"`, "timeout");
        await sleep(pollMs);
        job = await getJob(`${base}/api/jobs/${jobId}`, deadline);
      }

      const needing = job.run?.results.filter((r) => r.repairAttempts > 0).length;
      const base_ = { jobId, ...(job.metrics ? { metrics: job.metrics } : {}), ...(needing === undefined ? {} : { stepsNeedingRepair: needing }) };
      return job.status === "done"
        ? { outcome: "done", ...base_ }
        : { outcome: "failed", errorCode: failedStage(job), error: job.error ?? eventMessage ?? "job failed (no error given)", ...base_ };
    } catch (e) {
      const timedOut = e instanceof Error && e.name === "TimeoutError";
      const msg = timedOut ? `timed out after ${Math.round(timeoutMs / 1000)}s` : text(e);
      const code: ErrorCode = e instanceof ApiError ? e.code : timedOut ? "timeout" : /fetch failed/.test(msg) ? "api_unreachable" : "eval_error";
      const error = code === "api_unreachable" && jobId === undefined ? `cannot reach the API at ${base}: ${msg}` : msg;
      return { outcome: "error", errorCode: code, error, ...(jobId ? { jobId } : {}) };
    }
  };
}

/** Runs jobs one after another. One failure never stops the batch. */
export async function runBatch(args: {
  runs: number;
  request: { source: string; instructions: string };
  execute: Execute;
  onRecord?: (r: RunRecord) => void;
}): Promise<RunRecord[]> {
  const records: RunRecord[] = [];
  for (let run = 1; run <= args.runs; run++) {
    const t0 = Date.now();
    let partial: Awaited<ReturnType<Execute>>;
    try {
      partial = await args.execute(args.request, run);
    } catch (e) {
      partial = { outcome: "error", errorCode: "eval_error", error: text(e) };
    }
    const record: RunRecord = { run, ...partial, wallSec: Math.round((Date.now() - t0) / 100) / 10 };
    records.push(record);
    args.onRecord?.(record);
  }
  return records;
}

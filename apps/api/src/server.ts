import type { OutgoingHttpHeaders } from "node:http";
import { dirname, join, resolve } from "node:path";
import cors from "@fastify/cors";
import type { Job, JobEvent } from "@demoforge/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { ApiError, errorBody, notFound } from "./errors.js";
import { isTerminalEvent, type JobEvents } from "./events.js";
import { checkHealth, type HealthReport } from "./health.js";
import { fileSize, isInside, sendFile } from "./media.js";
import { CACHED_VIDEO_FILE } from "./settings.js";
import { CreateJobSchema, JOB_ID_PATTERN, JobStore } from "./store.js";

export const WEB_ORIGIN = "http://localhost:3000";

/**
 * Origins allowed to call the API: the local web UI, plus any listed in DEMOFORGE_WEB_ORIGINS
 * (comma-separated, e.g. a deployed frontend: "https://demoforge.vercel.app"). Read when the server is built,
 * so a value from the repo's .env (loaded at startup) is seen.
 */
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.DEMOFORGE_WEB_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return [...new Set([WEB_ORIGIN, ...extra])];
}

export type BuildServerOptions = {
  store?: JobStore;
  /** Receives each new job id; runs the pipeline. Omit to only record jobs. */
  pipeline?: { enqueue(id: string): void };
  /** Event log for GET /api/jobs/:id/events. Omit and the route answers 503. */
  events?: JobEvents;
  /** True when the pipeline uses mocks (USE_MOCKS=1); reported by GET /api/health. */
  mocks?: boolean;
  /** Override the health checks (tests). */
  health?: () => Promise<HealthReport>;
  /** Cached demo video for fallback: "cached-video" (tests override it). */
  cachedVideoFile?: string;
  /** Milliseconds between SSE keep-alive comments. */
  heartbeatMs?: number;
  logger?: boolean;
};

const isFinished = (job: Job): boolean => job.status === "done" || job.status === "failed";

/** The terminal event implied by a finished job, for jobs whose event log lacks one (e.g. after a restart). */
const terminalFor = (job: Job): JobEvent =>
  job.status === "done"
    ? { type: "done", message: "Demo ready" }
    : { type: "error", message: job.error ?? "The job failed.", data: { code: "JOB_FAILED" } };

const sseFrame = (id: number, event: JobEvent): string => `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`;

const describeZod = (err: ZodError): string =>
  err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");

export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const store = opts.store ?? new JobStore();
  const app = Fastify({ logger: opts.logger ?? false });

  await app.register(cors, {
    // An array makes the plugin check the request origin; a plain string is echoed to every origin.
    origin: allowedOrigins(),
    methods: ["GET", "HEAD", "POST", "OPTIONS"],
    exposedHeaders: ["Content-Range", "Accept-Ranges", "Content-Length"],
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send(errorBody("not_found", `Route ${req.method} ${req.url} not found`));
  });

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send(errorBody(error.code, error.message));
    }
    if (error instanceof ZodError) {
      return reply.code(400).send(errorBody("invalid_request", describeZod(error)));
    }
    const e = error as { statusCode?: number; message?: string };
    if (typeof e.statusCode === "number" && e.statusCode >= 400 && e.statusCode < 500) {
      // Fastify's own client errors (malformed JSON, unsupported media type, ...).
      return reply.code(e.statusCode).send(errorBody("bad_request", e.message ?? "Bad request"));
    }
    app.log.error(error);
    return reply.code(500).send(errorBody("internal_error", "Internal server error"));
  });

  app.post("/api/jobs", async (req, reply) => {
    const body = CreateJobSchema.parse(req.body);
    const job = store.create(body);
    opts.pipeline?.enqueue(job.id);
    return reply.code(201).send({ id: job.id });
  });

  app.get("/api/jobs", async () => store.list());

  const findJob = (id: string): Job => {
    const job = JOB_ID_PATTERN.test(id) ? store.get(id) : undefined;
    if (!job) throw notFound("Job", id);
    return job;
  };

  const cachedVideo = resolve(opts.cachedVideoFile ?? CACHED_VIDEO_FILE);
  /**
   * Absolute path of a job output, only if it lies inside the job's folder.
   * The one exception is the cached demo video used by fallback: "cached-video".
   */
  const jobFile = (job: Job, file: string | undefined, allowCached = false): string | undefined => {
    if (!file) return undefined;
    const dir = store.jobDir(job.id);
    if (allowCached && resolve(dir, file) === cachedVideo) return cachedVideo;
    return isInside(dir, file) ? resolve(dir, file) : undefined;
  };

  app.get<{ Params: { id: string } }>("/api/jobs/:id", async (req) => findJob(req.params.id));

  /**
   * Server-sent events. Every client first gets the full history (or everything after
   * Last-Event-ID), then live events; the stream closes after the done/error event.
   * Each frame is `id: <index>` + `data: <JobEvent JSON>`, so EventSource.onmessage sees all of them.
   */
  app.get<{ Params: { id: string } }>("/api/jobs/:id/events", (req, reply) => {
    const job = findJob(req.params.id);
    if (!opts.events) throw new ApiError(503, "unavailable", "Live events are not enabled on this server");
    const events = opts.events;
    const id = job.id;

    const lastHeader = Number(req.headers["last-event-id"]);
    let next = Number.isInteger(lastHeader) && lastHeader >= 0 ? lastHeader + 1 : 0;

    reply.hijack();
    const raw = reply.raw;
    const headers: OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(reply.getHeaders())) if (v !== undefined) headers[k] = v;
    raw.writeHead(200, {
      ...headers, // keeps the CORS headers added by the plugin
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    raw.write("retry: 3000\n\n");

    let closed = false;
    let unsubscribe = (): void => {};
    let heartbeat: NodeJS.Timeout | undefined;
    const close = (): void => {
      if (closed) return;
      closed = true;
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      raw.end();
    };
    const send = (event: JobEvent): void => {
      if (closed) return;
      raw.write(sseFrame(next++, event));
      if (isTerminalEvent(event)) close();
    };

    // history() and subscribe() run in the same tick, so no event can slip between them.
    const history = events.history(id);
    unsubscribe = events.subscribe(id, send);
    for (const e of history.slice(next)) send(e);
    if (closed) return;

    if (history.some(isTerminalEvent)) {
      close(); // finished, and the client already has the terminal event (Last-Event-ID)
      return;
    }
    const now = store.get(id);
    if (now && isFinished(now)) {
      send(terminalFor(now)); // finished without a terminal event in the log
      return;
    }
    heartbeat = setInterval(() => raw.write(": ping\n\n"), opts.heartbeatMs ?? 15_000);
    heartbeat.unref();
    raw.on("close", close);
  });

  /** The recorded video, with Range support so the browser can seek. */
  app.get<{ Params: { id: string } }>("/api/jobs/:id/video", async (req, reply) => {
    const job = findJob(req.params.id);
    const file = jobFile(job, job.run?.videoPath, true);
    const size = file ? fileSize(file) : undefined;
    if (!file || size === undefined) {
      throw new ApiError(404, "not_available", isFinished(job) ? "This job has no video" : "The video is not ready yet");
    }
    return sendFile(req, reply, file, size);
  });

  /** The runner's human-readable log (run.log, next to the run's logPath). */
  app.get<{ Params: { id: string } }>("/api/jobs/:id/log", async (req, reply) => {
    const job = findJob(req.params.id);
    const file = jobFile(job, job.run?.logPath && join(dirname(job.run.logPath), "run.log"));
    const size = file ? fileSize(file) : undefined;
    if (!file || size === undefined) {
      throw new ApiError(404, "not_available", isFinished(job) ? "This job has no run log" : "The run log is not ready yet");
    }
    return sendFile(req, reply, file, size);
  });

  /** Local setup checks. Always 200; each failed check is a red item with a fix command. */
  app.get("/api/health", async () => {
    const mocks = opts.mocks === true;
    try {
      return { ...(await (opts.health ?? checkHealth)()), mocks };
    } catch (e) {
      return { ok: false, mocks, items: [{ id: "health", label: "Health check", ok: false, detail: e instanceof Error ? e.message : String(e) }] };
    }
  });

  return app;
}

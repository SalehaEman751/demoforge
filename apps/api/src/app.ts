import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { JobEvents } from "./events.js";
import { Pipeline } from "./pipeline.js";
import { createRegistry, type Registry } from "./registry.js";
import { ensureSampleVideo, SAMPLE_VIDEO_FILE } from "./sample-video.js";
import { buildServer } from "./server.js";
import { JobStore } from "./store.js";

/** Load the repo-root .env; variables already set in the environment win. */
export function loadEnv(): void {
  const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
  if (existsSync(envFile) && typeof process.loadEnvFile === "function") process.loadEnvFile(envFile);
}

let guardsInstalled = false;
/**
 * Last line of defence so one bad job never takes the server down.
 * Pipeline errors are already caught per job; this covers stray callbacks and timers.
 */
export function installCrashGuards(log: (msg: string) => void = console.error): void {
  if (guardsInstalled) return;
  guardsInstalled = true;
  process.on("unhandledRejection", (reason) => {
    log(`[api] unhandled rejection (server keeps running): ${reason instanceof Error ? reason.stack : String(reason)}`);
  });
  process.on("uncaughtException", (err) => {
    log(`[api] uncaught exception (server keeps running): ${err.stack ?? err.message}`);
  });
}

export type StartOptions = {
  port?: number;
  host?: string;
  logger?: boolean;
  /** Data root override (else DEMOFORGE_DATA_DIR or apps/api/.data). */
  jobsDir?: string;
  useMocks?: boolean;
  log?: (msg: string) => void;
  /** Mock-mode sample clip (default apps/api/.cache/demo.mp4) and the ffmpeg used to make it. */
  sampleVideo?: string;
  ffmpegBin?: string;
};

export type Started = {
  app: FastifyInstance;
  url: string;
  store: JobStore;
  events: JobEvents;
  pipeline: Pipeline;
  registry: Registry;
};

/** Build the store, events, registry, pipeline and HTTP server, and start listening. */
export async function startServer(opts: StartOptions = {}): Promise<Started> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const useMocks = opts.useMocks ?? process.env.USE_MOCKS === "1";
  const registry = await createRegistry({ useMocks, log: (m) => log(`[registry] ${m}`) });

  // Mock jobs get a real, playable video. Failing to make it is a warning, never a startup error.
  const sampleVideo = opts.sampleVideo ?? SAMPLE_VIDEO_FILE;
  if (useMocks && (await ensureSampleVideo({ file: sampleVideo, ffmpegBin: opts.ffmpegBin, log }))) {
    log(`[api] mock sample video ready at ${sampleVideo}`);
  }

  const store = new JobStore(opts.jobsDir);
  const loaded = store.load((msg) => log(`[api] ${msg}`));
  const events = new JobEvents((id) => store.jobDir(id));
  const pipeline = new Pipeline({
    store,
    events,
    registry,
    log: (m) => log(`[pipeline] ${m}`),
    sampleVideoFile: useMocks ? sampleVideo : undefined,
  });

  const app = await buildServer({ store, pipeline, events, mocks: useMocks, logger: opts.logger ?? false });
  log(`[api] loaded ${loaded} job(s) from ${store.dir}`);

  const host = opts.host ?? "localhost";
  await app.listen({ port: opts.port ?? 4000, host });
  const addr = app.server.address();
  const port = addr && typeof addr === "object" ? addr.port : opts.port;
  return { app, url: `http://${host}:${port}`, store, events, pipeline, registry };
}

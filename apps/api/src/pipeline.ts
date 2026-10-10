import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PlanSchema, type JobEvent, type Plan, type RunResult } from "@demoforge/shared";
import type { JobEvents } from "./events.js";
import { describeFailure, FallbackError, type Failure, type FailureStage } from "./failure.js";
import { fileSize } from "./media.js";
import type { Registry } from "./registry.js";
import {
  CACHED_VIDEO_FILE,
  DEFAULT_CACHED_PLAN_FILE,
  readFallbackSettings,
  REPO_ROOT,
  type FallbackSettings,
} from "./settings.js";
import type { JobStore } from "./store.js";

export type PipelineDeps = {
  store: JobStore;
  events: JobEvents;
  registry: Registry;
  log?: (msg: string) => void;
  /** Read before every job, so changing DEMOFORGE_CACHED_PLAN needs no restart. */
  settings?: () => FallbackSettings;
  /**
   * Mock mode only: sample clip copied into each mock run's out/demo.mp4, so the job has a playable video.
   * Used when runPlan is the mock and the file exists; otherwise the run is saved as the mock returned it.
   */
  sampleVideoFile?: string;
  /** Overrides for tests. */
  cachedVideoFile?: string;
  defaultCachedPlanFile?: string;
};

/** Short path for messages: relative to the repo when inside it. */
const shown = (file: string): string => {
  const rel = relative(REPO_ROOT, file);
  return rel && !rel.startsWith("..") ? rel : file;
};

/** Load a saved plan. Accepts a Plan, or the runner's run-log.json ({ plan, ... }). */
export function loadCachedPlan(file: string): Plan {
  if (!existsSync(file)) throw new FallbackError("CACHED_PLAN_MISSING", `No file at ${file}`);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new FallbackError("CACHED_PLAN_INVALID", `${file} is not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const candidate = raw && typeof raw === "object" && "plan" in raw ? (raw as { plan: unknown }).plan : raw;
  const parsed = PlanSchema.safeParse(candidate);
  if (!parsed.success) {
    const why = parsed.error.issues.map((i) => `${i.path.join(".") || "plan"}: ${i.message}`).join("; ");
    throw new FallbackError("CACHED_PLAN_INVALID", `${file}: ${why}`);
  }
  return parsed.data;
}

/** Remote sources (https://, ssh://, git@host:..., ext::) go to the launcher untouched. */
const REMOTE_SOURCE = /^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|git@|[A-Za-z][A-Za-z0-9+.-]*::)/;
const API_SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Walks up from `from` to the first folder whose package.json has a "workspaces" key (the monorepo root). */
export function findRepoRoot(from: string = API_SRC_DIR): string | undefined {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>;
      if (pkg && typeof pkg === "object" && "workspaces" in pkg) return dir;
    } catch {
      // no package.json here, or not JSON: keep walking
    }
    if (dirname(dir) === dir) return undefined;
  }
}

/**
 * A relative local path is resolved before it reaches the launcher, which would otherwise resolve it against
 * the API's own working folder (apps/api). Tried in order: npm's INIT_CWD (where `npm run` was typed), if the
 * folder exists there; else the repo root. Absolute paths and git / https sources are returned unchanged.
 */
export function resolveProjectSource(source: string, opts: { initCwd?: string; repoRoot?: string } = {}): string {
  if (REMOTE_SOURCE.test(source) || isAbsolute(source)) return source;
  const initCwd = "initCwd" in opts ? opts.initCwd : process.env.INIT_CWD;
  if (initCwd) {
    const candidate = resolve(initCwd, source);
    if (existsSync(candidate)) return candidate;
  }
  return resolve(opts.repoRoot ?? findRepoRoot() ?? REPO_ROOT, source);
}

/**
 * A local source may carry a query for the app, e.g. "samples/taskly?variant=renamed" (Taskly's seeded failure).
 * Split on the first "?": the path goes to the launcher, the query to the first page the inspector and runner open.
 * Remote sources (git / https URLs) are never split: a "?" there belongs to the URL.
 */
export function splitSourceQuery(source: string): { path: string; query: string } {
  if (REMOTE_SOURCE.test(source)) return { path: source, query: "" };
  const at = source.indexOf("?");
  if (at < 0) return { path: source, query: "" };
  const query = source.slice(at + 1);
  return { path: source.slice(0, at), query: query ? `?${query}` : "" };
}

/** Adds `query` ("?a=b") to a relative or absolute URL, keeping any query and #hash it already has. */
export function withQuery(url: string, query: string): string {
  if (!query) return url;
  const hashAt = url.indexOf("#");
  const [head, hash] = hashAt < 0 ? [url, ""] : [url.slice(0, hashAt), url.slice(hashAt)];
  return `${head}${head.includes("?") ? "&" : "?"}${query.slice(1)}${hash}`;
}

/** The plan with `query` on its first navigate step (the first page the runner opens). Unchanged without one. */
export function planWithQuery(plan: Plan, query: string): Plan {
  const first = plan.steps.findIndex((s) => s.action === "navigate" && s.url);
  if (!query || first < 0) return plan;
  return { ...plan, steps: plan.steps.map((s, i) => (i === first ? { ...s, url: withQuery(s.url!, query) } : s)) };
}

type Stage = "launching" | "inspecting" | "planning" | "running";

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Runs jobs one at a time, in the order they were enqueued. */
export class Pipeline {
  private readonly queue: string[] = [];
  private running = false;
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly deps: PipelineDeps) {}

  /** Queue a job (already in the store with status "queued"). */
  enqueue(id: string): void {
    this.queue.push(id);
    void this.drain();
  }

  /** Resolves when nothing is running or waiting. */
  idle(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let id = this.queue.shift(); id !== undefined; id = this.queue.shift()) {
        try {
          await this.process(id);
        } catch (e) {
          this.deps.log?.(`job ${id}: unexpected pipeline error: ${errMessage(e)}`);
        }
      }
    } finally {
      this.running = false;
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) w();
    }
  }

  private stage(id: string, stage: Stage, message: string): void {
    this.deps.store.update(id, { status: stage });
    this.deps.events.emit(id, { type: "stage", stage, message });
  }

  private async process(id: string): Promise<void> {
    const { store, events, registry, log } = this.deps;
    const job = store.get(id);
    const request = store.getRequest(id);
    if (!job || !request) {
      log?.(`job ${id}: missing from store, skipping`);
      return;
    }

    const startedAt = Date.now();
    let stop: (() => Promise<void>) | undefined;
    let failure: Failure | undefined;
    let current: FailureStage = "launching";

    // Fallback switches are read per job, so they work without a restart.
    let cachedPlanFile: string | undefined;
    if (request.fallback !== "cached-video") {
      let settings: FallbackSettings = {};
      try {
        settings = (this.deps.settings ?? readFallbackSettings)();
      } catch (e) {
        log?.(`job ${id}: could not read fallback settings: ${errMessage(e)}`);
      }
      cachedPlanFile =
        settings.cachedPlan ??
        (request.fallback === "cached-plan" ? (this.deps.defaultCachedPlanFile ?? DEFAULT_CACHED_PLAN_FILE) : undefined);
    }

    // "samples/taskly?variant=renamed": launch the clean path, give the query to the first page opened.
    const { path: sourcePath, query } = splitSourceQuery(request.source);

    try {
      if (request.fallback === "cached-video") {
        current = "running";
        this.useCachedVideo(id, startedAt);
      } else {
        this.stage(id, "launching", "Launching project");
        const launched = await registry.launchProject({
          source: resolveProjectSource(sourcePath),
          startCommand: request.startCommand,
          port: request.port,
          subdir: request.subdir,
        });
        stop = launched.stop;
        const { info } = launched;
        store.update(id, { info });

        current = "inspecting";
        this.stage(id, "inspecting", "Inspecting project");
        if (query) {
          events.emit(id, {
            type: "log",
            stage: "launching",
            message: `Opening the app with ${query} on the first page (from the project source).`,
            data: { query },
          });
        }
        // The inspector gets the query on its base URL; the stored LaunchInfo stays clean.
        const { brief, inventory } = await registry.inspectProject({
          info: query ? { ...info, baseUrl: withQuery(new URL(info.baseUrl).href, query) } : info,
          allowAuthProbe: request.allowAuthProbe === true,
        });
        store.update(id, { brief, inventory });

        current = "planning";
        let plan: Plan;
        if (cachedPlanFile) {
          this.stage(id, "planning", "Using cached plan");
          plan = loadCachedPlan(cachedPlanFile);
          events.emit(id, {
            type: "log",
            stage: "planning",
            message: `Fallback: using the cached plan from ${shown(cachedPlanFile)}; the AI model was not called.`,
            data: { fallback: "cached-plan", file: cachedPlanFile },
          });
        } else {
          this.stage(id, "planning", "Planning demo");
          plan = await registry.planDemo({ brief, inventory, instructions: job.instructions });
        }
        plan = planWithQuery(plan, query);
        store.update(id, { plan });

        current = "running";
        this.stage(id, "running", "Recording demo");
        const outDir = join(store.jobDir(id), "out");
        mkdirSync(outDir, { recursive: true });
        const run = await registry.runPlan({
          baseUrl: info.baseUrl,
          plan,
          outDir,
          // Repair asks the model, so it is off when the plan is cached; except for a seeded-variant run
          // (source with a query), whose whole point is to show repair (stage 1 needs no model).
          repair: cachedPlanFile && !query ? undefined : registry.repairStep,
          onEvent: (e) => events.emit(id, this.forwardable(e)),
        });
        store.update(id, { run: this.withSampleVideo(id, run, outDir) });

        current = "metrics";
        const metrics = registry.computeMetrics({ run, startedAt, finishedAt: Date.now() });
        store.update(id, { metrics });
      }
    } catch (e) {
      failure = describeFailure(e, current);
      log?.(`job ${id}: ${failure.code} while ${current}: ${failure.detail}`);
    } finally {
      if (stop) {
        try {
          await stop();
        } catch (e) {
          log?.(`job ${id}: stop() failed: ${errMessage(e)}`);
        }
      }
    }

    // Terminal state is written last, so a done/error event always means the project has been stopped.
    // Each write is guarded on its own: a disk error must not swallow the terminal event.
    const guard = (what: string, fn: () => void): void => {
      try {
        fn();
      } catch (e) {
        log?.(`job ${id}: ${what} failed: ${errMessage(e)}`);
      }
    };
    if (failure === undefined) {
      guard("saving done status", () => store.update(id, { status: "done" }));
      guard("emitting done", () => events.emit(id, { type: "done", message: "Demo ready" }));
    } else {
      const f = failure;
      guard("saving failed status", () => store.update(id, { status: "failed", error: f.message }));
      guard("emitting error", () =>
        events.emit(id, {
          type: "error",
          stage: f.stage,
          message: f.message,
          data: { code: f.code, message: f.message, hint: f.hint, stage: f.stage, detail: f.detail },
        }),
      );
    }
  }

  /**
   * The mock runner returns a fixture videoPath that does not exist. In mock mode, give the job a real
   * clip instead: copy the sample into out/demo.mp4 and point run.videoPath at it (same RunResult shape).
   */
  private withSampleVideo(id: string, run: RunResult, outDir: string): RunResult {
    const sample = this.deps.sampleVideoFile;
    if (!sample) return run;
    const runner = this.deps.registry.status().find((s) => s.name === "runPlan");
    if (runner?.source !== "mock" || !fileSize(sample)) return run;
    const target = join(outDir, "demo.mp4");
    try {
      copyFileSync(sample, target);
      return { ...run, videoPath: target };
    } catch (e) {
      this.deps.log?.(`job ${id}: could not copy the sample video: ${errMessage(e)}`);
      return run;
    }
  }

  /** fallback: "cached-video". No launch, no model, no browser: the job's video is the cached demo. */
  private useCachedVideo(id: string, startedAt: number): void {
    const { store, events } = this.deps;
    const video = this.deps.cachedVideoFile ?? CACHED_VIDEO_FILE;
    this.stage(id, "running", "Using cached demo video");
    if (!fileSize(video)) throw new FallbackError("CACHED_VIDEO_MISSING", `No video at ${video}`);

    const line = `Fallback: serving the cached video ${shown(video)}; the project was not launched or recorded.`;
    const outDir = join(store.jobDir(id), "out");
    mkdirSync(outDir, { recursive: true });
    const logPath = join(outDir, "run-log.json");
    writeFileSync(join(outDir, "run.log"), `${new Date().toISOString()} ${line}\n`);
    writeFileSync(logPath, JSON.stringify({ fallback: "cached-video", videoPath: video }, null, 2) + "\n");
    events.emit(id, { type: "log", stage: "running", message: line, data: { fallback: "cached-video", file: video } });

    const run: RunResult = { videoPath: video, logPath, results: [], startedAt, finishedAt: Date.now() };
    store.update(id, { run });
  }

  /**
   * The runner may emit its own done/error events; only the pipeline decides when a job ends
   * (a terminal event closes the SSE stream), so those are downgraded to log events.
   */
  private forwardable(e: JobEvent): JobEvent {
    if (e.type === "done" || e.type === "error") {
      return { ...e, type: "log", message: e.message ? `runner ${e.type}: ${e.message}` : `runner ${e.type}` };
    }
    return e;
  }
}

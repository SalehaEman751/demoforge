import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JobSchema, type Job } from "@demoforge/shared";
import { z } from "zod";

/** Body accepted by POST /api/jobs. */
export const CreateJobSchema = z.object({
  source: z.string().trim().min(1, "source is required"),
  /** Optional guidance for the planner. Missing or whitespace-only is stored as "" (the planner decides what to do). */
  instructions: z.string().trim().default(""),
  startCommand: z.string().trim().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  subdir: z.string().trim().min(1).optional(),
  /** Trust checkbox: lets the inspector probe login/signup flows. The UI always sends true. */
  allowAuthProbe: z.boolean().optional(),
  /**
   * Demo-day safety net. "cached-plan": use the saved plan instead of calling the model (Playwright still runs).
   * "cached-video": skip everything and serve docs/fallback/cached-demo.mp4.
   */
  fallback: z.enum(["cached-plan", "cached-video"]).optional(),
});
/** Parsed request: instructions is always a string here ("" when absent). */
export type CreateJobRequest = z.infer<typeof CreateJobSchema>;

export const JOB_ID_PATTERN = /^job_[a-f0-9]{8}$/;

/** Default data root: apps/api/.data/jobs (override with DEMOFORGE_DATA_DIR). */
export const defaultJobsDir = (): string =>
  process.env.DEMOFORGE_DATA_DIR
    ? join(process.env.DEMOFORGE_DATA_DIR, "jobs")
    : fileURLToPath(new URL("../.data/jobs", import.meta.url));

const writeJsonAtomic = (file: string, value: unknown): void => {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
};

/**
 * In-memory job store backed by one folder per job: <dir>/<id>/job.json.
 * The Job type has no place for launch options, so they live in <dir>/<id>/request.json.
 */
export class JobStore {
  private readonly jobs = new Map<string, Job>();
  private readonly requests = new Map<string, CreateJobRequest>();

  constructor(readonly dir: string = defaultJobsDir()) {
    mkdirSync(dir, { recursive: true });
  }

  /** Folder holding everything for one job (job.json, video, logs). */
  jobDir(id: string): string {
    return join(this.dir, id);
  }

  /**
   * Load every job.json under the data dir. Unreadable or invalid files are skipped.
   * A job that was still in progress when the server stopped can never finish, so it is marked failed.
   * Returns the number of jobs loaded.
   */
  load(onWarn: (msg: string) => void = () => {}): number {
    const loaded: Job[] = [];
    for (const entry of readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !JOB_ID_PATTERN.test(entry.name)) continue;
      const file = join(this.jobDir(entry.name), "job.json");
      if (!existsSync(file)) continue;
      try {
        const job = JobSchema.parse(JSON.parse(readFileSync(file, "utf8")));
        if (job.id !== entry.name) throw new Error(`id ${job.id} does not match folder`);
        loaded.push(job);
      } catch (err) {
        onWarn(`skipping ${file}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      const reqFile = join(this.jobDir(entry.name), "request.json");
      if (existsSync(reqFile)) {
        try {
          this.requests.set(entry.name, CreateJobSchema.parse(JSON.parse(readFileSync(reqFile, "utf8"))));
        } catch (err) {
          onWarn(`ignoring ${reqFile}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    loaded.sort((a, b) => a.createdAt - b.createdAt);
    for (const job of loaded) {
      if (job.status !== "done" && job.status !== "failed") {
        job.status = "failed";
        job.error = "Interrupted by server restart";
        this.persist(job);
      }
      this.jobs.set(job.id, job);
    }
    return loaded.length;
  }

  create(request: CreateJobRequest): Job {
    let id: string;
    do {
      id = `job_${randomBytes(4).toString("hex")}`;
    } while (this.jobs.has(id));
    const job: Job = {
      id,
      status: "queued",
      projectSource: request.source,
      instructions: request.instructions,
      createdAt: Date.now(),
    };
    mkdirSync(this.jobDir(id), { recursive: true });
    writeJsonAtomic(join(this.jobDir(id), "request.json"), request);
    this.requests.set(id, request);
    this.jobs.set(id, job);
    this.persist(job);
    return structuredClone(job);
  }

  get(id: string): Job | undefined {
    const job = this.jobs.get(id);
    return job ? structuredClone(job) : undefined;
  }

  /** Launch options the job was created with (startCommand, port, subdir). */
  getRequest(id: string): CreateJobRequest | undefined {
    return this.requests.get(id);
  }

  /** Newest first. */
  list(): Job[] {
    // Reverse first so jobs created in the same millisecond keep newest-first order (sort is stable).
    return [...this.jobs.values()]
      .reverse()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((j) => structuredClone(j));
  }

  /** Merge a patch into a job, persist it, and return the updated copy. */
  update(id: string, patch: Partial<Omit<Job, "id" | "createdAt">>): Job {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`unknown job ${id}`);
    Object.assign(job, patch);
    this.persist(job);
    return structuredClone(job);
  }

  private persist(job: Job): void {
    mkdirSync(this.jobDir(job.id), { recursive: true });
    writeJsonAtomic(join(this.jobDir(job.id), "job.json"), job);
  }
}

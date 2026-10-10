import { z } from "zod";
import { JobSchema, type Job } from "./shared";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");

/** The API's error body `{ error: { code, message } }`, or a network failure (status 0). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type CreateJobInput = {
  source: string;
  instructions?: string;
  startCommand?: string;
  port?: number;
  subdir?: string;
  /** The UI always sends true (see NOTES/contract-issues.md, E7-2/E7-3). */
  allowAuthProbe?: boolean;
  fallback?: "cached-plan" | "cached-video";
};

const ErrorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const CreatedSchema = z.object({ id: z.string() });
const JobListSchema = z.array(JobSchema);

/** One setup check, as the UI shows it. */
export type HealthItem = { id: string; label: string; ok: boolean; detail?: string; fix?: string };
/** `mocks`: the API runs with USE_MOCKS=1, so red items do not stop a demo from running. */
export type Health = { ok: boolean; items: HealthItem[]; mocks: boolean };

/** What the API sends today (checked against apps/api/src/health.ts). */
const HealthReportSchema = z.object({
  ok: z.boolean(),
  mocks: z.boolean().optional(),
  items: z.array(
    z.object({ id: z.string(), label: z.string().optional(), ok: z.boolean(), detail: z.string().optional(), fix: z.string().optional() }),
  ),
});
/** The shape named in the ticket: { ollama, model, ffmpeg, playwright }, each { ok, fix? }. */
const HealthKeyedSchema = z.object({
  ollama: z.object({ ok: z.boolean(), fix: z.string().optional() }),
  model: z.object({ ok: z.boolean(), fix: z.string().optional() }),
  ffmpeg: z.object({ ok: z.boolean(), fix: z.string().optional() }),
  playwright: z.object({ ok: z.boolean(), fix: z.string().optional() }),
});

const parseHealth = (body: unknown): Health => {
  const report = HealthReportSchema.safeParse(body);
  if (report.success) {
    return {
      ok: report.data.ok,
      mocks: report.data.mocks === true,
      items: report.data.items.map((i) => ({ ...i, label: i.label ?? i.id })),
    };
  }
  const keyed = HealthKeyedSchema.parse(body);
  const items = (Object.keys(keyed) as (keyof typeof keyed)[]).map((id) => ({ id, label: id, ...keyed[id] }));
  return { ok: items.every((i) => i.ok), items, mocks: false };
};

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new ApiError(0, "network_error", `Cannot reach the DemoForge API at ${API_URL}. Is it running?`);
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const parsed = ErrorBodySchema.safeParse(body);
    throw parsed.success
      ? new ApiError(res.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiError(res.status, "http_error", `Request failed with HTTP ${res.status}`);
  }
  return body;
}

const checked = <S extends z.ZodTypeAny>(schema: S, body: unknown): z.output<S> => {
  const r = schema.safeParse(body);
  if (!r.success) throw new ApiError(502, "invalid_response", "The API sent a response in an unexpected shape.");
  return r.data;
};

export async function createJob(input: CreateJobInput): Promise<{ id: string }> {
  const body = await request("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allowAuthProbe: true, ...input }),
  });
  return checked(CreatedSchema, body);
}

export async function listJobs(): Promise<Job[]> {
  return checked(JobListSchema, await request("/api/jobs"));
}

export async function getJob(id: string): Promise<Job> {
  return checked(JobSchema, await request(`/api/jobs/${encodeURIComponent(id)}`));
}

export async function getHealth(): Promise<Health> {
  const body = await request("/api/health");
  try {
    return parseHealth(body);
  } catch {
    throw new ApiError(502, "invalid_response", "The API sent a response in an unexpected shape.");
  }
}

export const eventsUrl = (id: string): string => `${API_URL}/api/jobs/${encodeURIComponent(id)}/events`;
export const videoUrl = (id: string): string => `${API_URL}/api/jobs/${encodeURIComponent(id)}/video`;
export const logUrl = (id: string): string => `${API_URL}/api/jobs/${encodeURIComponent(id)}/log`;

export const isFinished = (job: Pick<Job, "status">): boolean => job.status === "done" || job.status === "failed";

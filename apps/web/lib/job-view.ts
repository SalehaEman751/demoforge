/**
 * Pure helpers that turn a Job plus its event list into what the job page shows.
 * Events are the live source; the Job (GET /api/jobs/:id) fills any gap, so a page
 * loaded after a reload, a restart or a lost stream still shows the right state.
 */
import type { Job, JobEvent, Plan } from "./shared";

export const STAGES = [
  { key: "launching", label: "Launch" },
  { key: "inspecting", label: "Inspect" },
  { key: "planning", label: "Plan" },
  { key: "running", label: "Run" },
  { key: "done", label: "Done" },
] as const;

export type StageState = "pending" | "active" | "done" | "failed";
export type StepStatus = "pending" | "running" | "ok" | "repaired" | "failed" | "skipped";

const STEP_STATUSES: readonly string[] = ["running", "ok", "repaired", "failed", "skipped"];

/** Index into STAGES for a stage name, or -1. The api's "metrics" stage counts as the Done step. */
const stageIndex = (stage: string | undefined): number => {
  switch (stage) {
    case "launching":
      return 0;
    case "inspecting":
      return 1;
    case "planning":
      return 2;
    case "running":
      return 3;
    case "metrics":
    case "done":
      return 4;
    default:
      return -1;
  }
};

export const isJobFinished = (job: Job | undefined, events: JobEvent[]): boolean =>
  job?.status === "done" ||
  job?.status === "failed" ||
  events.some((e) => e.type === "done" || e.type === "error");

/** One state per entry of STAGES. */
export function stageStates(job: Job | undefined, events: JobEvent[]): StageState[] {
  if (events.some((e) => e.type === "done") || job?.status === "done") return STAGES.map(() => "done");

  let reached = -1;
  for (const e of events) if (e.type === "stage") reached = Math.max(reached, stageIndex(e.stage));
  if (job && job.status !== "failed") reached = Math.max(reached, stageIndex(job.status));

  const errorEvent = events.find((e) => e.type === "error");
  if (errorEvent || job?.status === "failed") {
    const at = errorEvent ? stageIndex(errorEvent.stage) : -1;
    const failedAt = at >= 0 ? at : reached;
    return STAGES.map((_, i) => (i < failedAt ? "done" : i === failedAt ? "failed" : "pending"));
  }

  return STAGES.map((_, i) => (i < reached ? "done" : i === reached ? "active" : "pending"));
}

const statusOf = (data: unknown): StepStatus | undefined => {
  if (typeof data !== "object" || data === null) return undefined;
  const s = (data as { status?: unknown }).status;
  return typeof s === "string" && STEP_STATUSES.includes(s) ? (s as StepStatus) : undefined;
};

export type StepRow = { id: number; caption: string; status: StepStatus };

/** The plan's steps with their live status. Later events win; run results fill any gap. */
export function stepRows(plan: Plan | undefined, job: Job | undefined, events: JobEvent[]): StepRow[] {
  if (!plan) return [];
  const byId = new Map<number, StepStatus>();
  for (const e of events) {
    if (e.type !== "step" || e.stepId === undefined) continue;
    const s = statusOf(e.data);
    if (s) byId.set(e.stepId, s);
  }
  for (const r of job?.run?.results ?? []) if (!byId.has(r.stepId)) byId.set(r.stepId, r.status);

  const finished = isJobFinished(job, events);
  return plan.steps.map((step) => {
    let status = byId.get(step.id) ?? "pending";
    if (finished && status === "running") status = "failed"; // the run ended while this step was in flight
    return { id: step.id, caption: step.caption, status };
  });
}

export type LogLine = { kind: "stage" | "info" | "success" | "error"; text: string };

export function logLines(events: JobEvent[]): LogLine[] {
  return events.map((e): LogLine => {
    switch (e.type) {
      case "stage":
        return { kind: "stage", text: e.message ?? e.stage ?? "stage" };
      case "step": {
        const status = statusOf(e.data);
        const detail = (e.data as { error?: unknown } | undefined)?.error;
        const head = `Step ${e.stepId ?? "?"}${status ? ` ${status}` : ""}: ${e.message ?? ""}`.trim();
        return {
          kind: status === "failed" ? "error" : "info",
          text: typeof detail === "string" && detail ? `${head} (${detail})` : head,
        };
      }
      case "done":
        return { kind: "success", text: e.message ?? "Done" };
      case "error":
        return { kind: "error", text: e.message ?? "The job failed" };
      default:
        return { kind: "info", text: e.message ?? "" };
    }
  });
}

export type FailureInfo = { message: string; code: string };

/** Code the api uses when a finished job has no error event of its own (see apps/api/src/server.ts). */
export const FALLBACK_ERROR_CODE = "JOB_FAILED";

/**
 * What the error card shows for a failed job, or undefined when it did not fail.
 * `Job` has no field for the code, so it comes from the error event's `data.code`.
 */
export function failureInfo(job: Job | undefined, events: JobEvent[]): FailureInfo | undefined {
  if (job?.status === "done") return undefined;
  const event = events.find((e) => e.type === "error");
  if (job?.status !== "failed" && !event) return undefined;
  const raw = event?.data && typeof event.data === "object" ? (event.data as { code?: unknown }).code : undefined;
  return {
    message: job?.error || event?.message || "Something went wrong while making the demo.",
    code: typeof raw === "string" && raw ? raw : FALLBACK_ERROR_CODE,
  };
}

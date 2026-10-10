import type { Metrics } from "@demoforge/shared";

/**
 * Why a run did not complete.
 * Eval side: api_unreachable, http_error, bad_response, timeout, eval_error.
 * Job side (the API said the job failed; the stage is read from which parts of the Job exist):
 * launch_failed, inspect_failed, plan_failed, run_failed.
 */
export type ErrorCode =
  | "api_unreachable"
  | "http_error"
  | "bad_response"
  | "timeout"
  | "eval_error"
  | "launch_failed"
  | "inspect_failed"
  | "plan_failed"
  | "run_failed";

/** One batch entry. `done` = the job finished; `failed` = the API reported the job failed; `error` = the eval could not get an answer. */
export type RunRecord = {
  run: number;
  jobId?: string;
  outcome: "done" | "failed" | "error";
  error?: string;
  errorCode?: ErrorCode;
  /** Seconds the eval waited for this job, measured by the eval itself. */
  wallSec: number;
  /** From the API's job.metrics, when the job has them. */
  metrics?: Metrics;
  /** Steps that needed at least one repair attempt, counted from job.run.results. */
  stepsNeedingRepair?: number;
};

export type JobRequest = { source: string; instructions: string };

/** Runs one job and never throws: every problem comes back as outcome "error". */
export type Execute = (req: JobRequest, run: number) => Promise<Omit<RunRecord, "run" | "wallSec">>;

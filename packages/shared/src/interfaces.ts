import type {
  ElementInventory,
  JobEvent,
  LaunchInfo,
  Metrics,
  Plan,
  ProjectBrief,
  RunResult,
  Step,
} from "./schemas.js";

export type LaunchProjectFn = (args: {
  source: string;
  startCommand?: string;
  port?: number;
  subdir?: string;
}) => Promise<{ info: LaunchInfo; stop: () => Promise<void> }>;

export type InspectProjectFn = (args: {
  info: LaunchInfo;
  /** Opt-in (the UI's trust checkbox): sign up with demo values to inventory pages behind a login redirect. */
  allowAuthProbe?: boolean;
}) => Promise<{ brief: ProjectBrief; inventory: ElementInventory }>;

export type PlanDemoFn = (args: {
  brief: ProjectBrief;
  inventory: ElementInventory;
  instructions: string;
}) => Promise<Plan>;

export type ValidatePlanFn = (
  plan: Plan,
  inventory: ElementInventory,
  baseUrl: string,
) => { ok: boolean; errors: string[] };

/** Returns a corrected step, or null when no repair is possible. */
export type RepairStepFn = (args: {
  step: Step;
  error: string;
  inventory: ElementInventory;
  baseUrl: string;
}) => Promise<Step | null>;

export type RepairFn = RepairStepFn;

export type RunPlanFn = (args: {
  baseUrl: string;
  plan: Plan;
  outDir: string;
  repair?: RepairFn;
  onEvent?: (event: JobEvent) => void;
}) => Promise<RunResult>;

export type ComputeMetricsFn = (args: {
  run: RunResult;
  startedAt: number;
  finishedAt: number;
}) => Metrics;

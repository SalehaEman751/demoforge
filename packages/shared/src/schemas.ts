import { z } from "zod";

/* ---------- Plan ---------- */

export const StepSchema = z
  .object({
    id: z.number().int().positive(),
    action: z.enum(["navigate", "click", "fill", "wait", "assert_text", "scroll"]),
    url: z.string().optional(),
    target: z.object({ role: z.string(), name: z.string() }).optional(),
    value: z.string().optional(),
    text: z.string().optional(),
    ms: z.number().nonnegative().optional(),
    caption: z.string(),
  })
  .superRefine((step, ctx) => {
    const need = (field: "url" | "value" | "text" | "ms" | "target") => {
      if (step[field] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${step.action} requires ${field}`,
        });
      }
    };
    switch (step.action) {
      case "navigate":
        need("url");
        break;
      case "click":
        need("target");
        break;
      case "fill":
        need("target");
        need("value");
        break;
      case "assert_text":
        need("text");
        break;
      case "wait":
        need("ms");
        break;
      case "scroll":
        break;
    }
  });
export type Step = z.infer<typeof StepSchema>;

export const PlanSchema = z
  .object({
    title: z.string(),
    steps: z.array(StepSchema).min(1).max(25),
  })
  .superRefine((plan, ctx) => {
    plan.steps.forEach((step, i) => {
      if (step.id !== i + 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", i, "id"],
          message: `step ids must be 1..n in order; expected ${i + 1}, got ${step.id}`,
        });
      }
    });
  });
export type Plan = z.infer<typeof PlanSchema>;

/* ---------- Launch / inspect ---------- */

export const LaunchInfoSchema = z.object({
  baseUrl: z.string(),
  projectDir: z.string(),
  framework: z.enum(["next", "vite", "cra", "unknown"]),
  packageManager: z.enum(["npm", "yarn", "pnpm"]),
  startCommand: z.string(),
  port: z.number().int().positive(),
  envVarsRequired: z.array(z.string()),
});
export type LaunchInfo = z.infer<typeof LaunchInfoSchema>;

export const ProjectBriefSchema = z.object({
  name: z.string(),
  framework: z.string(),
  routes: z.array(z.string()),
  readmeSummary: z.string(),
  startCommand: z.string(),
  port: z.number().int().positive(),
});
export type ProjectBrief = z.infer<typeof ProjectBriefSchema>;

export const ElementInventorySchema = z.object({
  pages: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      redirectedTo: z.string().optional(),
      elements: z.array(
        z.object({
          role: z.string(),
          name: z.string(),
          placeholder: z.string().optional(),
        }),
      ),
    }),
  ),
});
export type ElementInventory = z.infer<typeof ElementInventorySchema>;

/* ---------- Run ---------- */

export const StepResultSchema = z.object({
  stepId: z.number().int().positive(),
  status: z.enum(["ok", "repaired", "failed", "skipped"]),
  error: z.string().optional(),
  durationMs: z.number().nonnegative(),
  repairAttempts: z.number().int().nonnegative(),
});
export type StepResult = z.infer<typeof StepResultSchema>;

export const RunResultSchema = z.object({
  videoPath: z.string(),
  logPath: z.string(),
  results: z.array(StepResultSchema),
  startedAt: z.number(),
  finishedAt: z.number(),
});
export type RunResult = z.infer<typeof RunResultSchema>;

export const MetricsSchema = z.object({
  timeToDemoSec: z.number().nonnegative(),
  manualBaselineSec: z.number().nonnegative(),
  stepsPlanned: z.number().int().nonnegative(),
  stepsOk: z.number().int().nonnegative(),
  stepsRepaired: z.number().int().nonnegative(),
  stepsFailed: z.number().int().nonnegative(),
  planSuccessRate: z.number().min(0).max(1),
  repairRecoveryRate: z.number().min(0).max(1),
});
export type Metrics = z.infer<typeof MetricsSchema>;

/* ---------- Jobs ---------- */

export const JobEventSchema = z.object({
  type: z.enum(["stage", "step", "log", "done", "error"]),
  stage: z.string().optional(),
  stepId: z.number().int().positive().optional(),
  message: z.string().optional(),
  data: z.unknown().optional(),
});
export type JobEvent = z.infer<typeof JobEventSchema>;

export const JobSchema = z.object({
  id: z.string(),
  status: z.enum([
    "queued",
    "launching",
    "inspecting",
    "planning",
    "running",
    "done",
    "failed",
  ]),
  projectSource: z.string(),
  instructions: z.string(),
  info: LaunchInfoSchema.optional(),
  brief: ProjectBriefSchema.optional(),
  inventory: ElementInventorySchema.optional(),
  plan: PlanSchema.optional(),
  run: RunResultSchema.optional(),
  metrics: MetricsSchema.optional(),
  error: z.string().optional(),
  createdAt: z.number(),
});
export type Job = z.infer<typeof JobSchema>;

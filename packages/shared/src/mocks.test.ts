import { describe, expect, it } from "vitest";
import {
  ElementInventorySchema,
  JobSchema,
  LaunchInfoSchema,
  MetricsSchema,
  PlanSchema,
  ProjectBriefSchema,
  RunResultSchema,
  StepSchema,
} from "./index.js";
// Relative imports on purpose: shared cannot depend on the packages that depend on it.
import { inspectProject } from "../../inspector/src/mock.js";
import { launchProject } from "../../launcher/src/mock.js";
import { computeMetrics } from "../../metrics/src/mock.js";
import { planDemo, validatePlan } from "../../planner/src/mock.js";
import { repairStep } from "../../repair/src/mock.js";
import { runPlan } from "../../runner/src/mock.js";
import { runJob } from "../../../apps/api/src/mock.js";

describe("mock outputs parse with their schemas", () => {
  it("launchProject", async () => {
    const { info, stop } = await launchProject({ source: "./samples/taskly" });
    expect(LaunchInfoSchema.safeParse(info).success).toBe(true);
    await expect(stop()).resolves.toBeUndefined();
  });

  it("inspectProject", async () => {
    const { info } = await launchProject({ source: "./samples/taskly" });
    const out = await inspectProject({ info });
    expect(ProjectBriefSchema.safeParse(out.brief).success).toBe(true);
    expect(ElementInventorySchema.safeParse(out.inventory).success).toBe(true);
  });

  it("planDemo and validatePlan", async () => {
    const { info } = await launchProject({ source: "./samples/taskly" });
    const { brief, inventory } = await inspectProject({ info });
    const plan = await planDemo({ brief, inventory, instructions: "sign up" });
    expect(PlanSchema.safeParse(plan).success).toBe(true);
    expect(validatePlan(plan, inventory, info.baseUrl)).toEqual({ ok: true, errors: [] });
  });

  it("repairStep returns a valid step, or null for an unknown id", async () => {
    const { info } = await launchProject({ source: "./samples/taskly" });
    const { brief, inventory } = await inspectProject({ info });
    const plan = await planDemo({ brief, inventory, instructions: "x" });
    const args = { error: "boom", inventory, baseUrl: info.baseUrl };
    const fixed = await repairStep({ ...args, step: plan.steps[3]! });
    expect(StepSchema.safeParse(fixed).success).toBe(true);
    expect(await repairStep({ ...args, step: { ...plan.steps[0]!, id: 99 } })).toBeNull();
  });

  it("runPlan and computeMetrics", async () => {
    const { info } = await launchProject({ source: "./samples/taskly" });
    const { brief, inventory } = await inspectProject({ info });
    const plan = await planDemo({ brief, inventory, instructions: "x" });
    const run = await runPlan({ baseUrl: info.baseUrl, plan, outDir: "out/x" });
    expect(RunResultSchema.safeParse(run).success).toBe(true);
    const metrics = computeMetrics({ run, startedAt: run.startedAt, finishedAt: run.finishedAt });
    expect(MetricsSchema.safeParse(metrics).success).toBe(true);
  });

  it("api runJob", async () => {
    const job = await runJob({ projectSource: "./samples/taskly", instructions: "x" });
    expect(JobSchema.safeParse(job).success).toBe(true);
  });
});

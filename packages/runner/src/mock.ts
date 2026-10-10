import { RunResultSchema, loadFixture, type RunPlanFn } from "@demoforge/shared";

export const runPlan: RunPlanFn = async () => loadFixture("run-result.json", RunResultSchema);

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PlanSchema, RunResultSchema, loadFixture } from "@demoforge/shared";

// If the mock (or anything it imports) ever pulls in Playwright, importing it fails the test.
vi.mock("playwright-core", () => {
  throw new Error("the runner mock must not load playwright-core");
});

describe("runner mock", () => {
  it("returns fixtures/run-result.json through the runPlan signature, without a browser", async () => {
    const { runPlan } = await import("./mock.js");
    const plan = loadFixture("plan.json", PlanSchema);
    const outDir = path.join(mkdtempSync(path.join(tmpdir(), "mock-")), "never-created");

    const run = await runPlan({ baseUrl: "http://localhost:3100", plan, outDir });

    expect(RunResultSchema.parse(run)).toEqual(loadFixture("run-result.json", RunResultSchema));
    expect(run.results).toHaveLength(plan.steps.length);
    expect(run.results.find((r) => r.stepId === 4)).toMatchObject({ status: "repaired", repairAttempts: 1 });
    expect(existsSync(outDir)).toBe(false); // nothing is recorded or written
  });

  it("is re-exported from the package index as runPlanMock", async () => {
    const { runPlanMock } = await import("./index.js");
    const { runPlan } = await import("./mock.js");
    expect(runPlanMock).toBe(runPlan);
  });
});

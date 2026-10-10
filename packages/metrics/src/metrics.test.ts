import { MetricsSchema, RunResultSchema, loadFixture, type RunResult, type StepResult } from "@demoforge/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MANUAL_BASELINE_SEC, computeMetrics, computeMetricsMock } from "./index.js";

const step = (stepId: number, status: StepResult["status"], repairAttempts = 0): StepResult => ({ stepId, status, durationMs: 1, repairAttempts });
const runOf = (results: StepResult[]): RunResult => ({ videoPath: "v", logPath: "l", results, startedAt: 0, finishedAt: 0 });
const compute = (results: StepResult[], startedAt = 0, finishedAt = 0) => computeMetrics({ run: runOf(results), startedAt, finishedAt });

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.DEMOFORGE_MANUAL_BASELINE_SEC;
  delete process.env.DEMOFORGE_MANUAL_BASELINE_SEC;
});
afterEach(() => {
  if (saved === undefined) delete process.env.DEMOFORGE_MANUAL_BASELINE_SEC;
  else process.env.DEMOFORGE_MANUAL_BASELINE_SEC = saved;
});

describe("computeMetrics", () => {
  it("computes from fixtures/run-result.json", () => {
    const run = loadFixture("run-result.json", RunResultSchema);
    const m = computeMetrics({ run, startedAt: run.startedAt, finishedAt: run.finishedAt });
    expect(MetricsSchema.parse(m)).toEqual({
      timeToDemoSec: 24, // 23.5 s rounds up
      manualBaselineSec: 9000,
      stepsPlanned: 8,
      stepsOk: 7,
      stepsRepaired: 1,
      stepsFailed: 0,
      planSuccessRate: 1,
      repairRecoveryRate: 1,
    });
  });

  it("handles a run with no steps without dividing by zero", () => {
    expect(compute([])).toMatchObject({ stepsPlanned: 0, stepsOk: 0, stepsRepaired: 0, stepsFailed: 0, planSuccessRate: 0, repairRecoveryRate: 1 });
  });

  it("all ok: full success, no repair needed so recovery is 1", () => {
    expect(compute([step(1, "ok"), step(2, "ok"), step(3, "ok")])).toMatchObject({ stepsPlanned: 3, stepsOk: 3, planSuccessRate: 1, repairRecoveryRate: 1 });
  });

  it("all failed: nothing succeeded; unrepaired failures give recovery 0", () => {
    expect(compute([step(1, "failed", 2), step(2, "failed", 2)])).toMatchObject({ stepsFailed: 2, planSuccessRate: 0, repairRecoveryRate: 0 });
  });

  it("all failed with no repair attempts: success 0, recovery 1 (no step needed repair)", () => {
    expect(compute([step(1, "failed"), step(2, "failed")])).toMatchObject({ planSuccessRate: 0, repairRecoveryRate: 1 });
  });

  it("mixed: skipped counts only in stepsPlanned", () => {
    const m = compute([step(1, "ok"), step(2, "repaired", 1), step(3, "failed", 2), step(4, "skipped"), step(5, "ok")]);
    expect(m).toMatchObject({ stepsPlanned: 5, stepsOk: 2, stepsRepaired: 1, stepsFailed: 1, planSuccessRate: 0.6, repairRecoveryRate: 0.5 });
  });

  it("rounds rates to 2 decimals", () => {
    expect(compute([step(1, "ok"), step(2, "ok"), step(3, "failed")]).planSuccessRate).toBe(0.67);
    expect(compute([step(1, "repaired", 1), step(2, "failed", 2), step(3, "failed", 1)]).repairRecoveryRate).toBe(0.33);
  });

  it("rounds time to whole seconds and never goes negative", () => {
    expect(compute([step(1, "ok")], 1000, 3400).timeToDemoSec).toBe(2);
    expect(compute([step(1, "ok")], 1000, 1499).timeToDemoSec).toBe(0);
    expect(compute([step(1, "ok")], 5000, 1000).timeToDemoSec).toBe(0);
    expect(compute([step(1, "ok")], Number.NaN, 1000).timeToDemoSec).toBe(0);
  });

  it("reads the manual baseline from DEMOFORGE_MANUAL_BASELINE_SEC, defaulting to 9000", () => {
    expect(DEFAULT_MANUAL_BASELINE_SEC).toBe(9000);
    expect(compute([]).manualBaselineSec).toBe(9000);
    process.env.DEMOFORGE_MANUAL_BASELINE_SEC = "1800";
    expect(compute([]).manualBaselineSec).toBe(1800);
    for (const bad of ["", "  ", "abc", "-5", "Infinity"]) {
      process.env.DEMOFORGE_MANUAL_BASELINE_SEC = bad;
      expect(compute([]).manualBaselineSec).toBe(9000);
    }
  });
});

describe("mock", () => {
  it("returns fixtures/metrics.json whatever it is given", () => {
    const expected = loadFixture("metrics.json", MetricsSchema);
    expect(computeMetricsMock({ run: runOf([]), startedAt: 0, finishedAt: 99_000 })).toEqual(expected);
  });
});

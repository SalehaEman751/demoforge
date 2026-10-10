import { JobSchema, loadFixture } from "@demoforge/shared";
import type { Execute } from "./types.js";

/** Every Nth dry run is a failed job, so the report's failure path is exercised too. */
export const DRY_FAIL_EVERY = 5;

/**
 * --dry: fake jobs built from fixtures/job.json. No network. Time to demo varies a little per run.
 * "natural" jobs need no repair (the fixture's one repaired step becomes ok); "renamed" jobs are the fixture as is.
 */
export function dryExecutor(variant: "natural" | "renamed"): Execute {
  return async (_req, run) => {
    const job = loadFixture("job.json", JobSchema);
    const jobId = `${job.id}_${variant}_${run}`;
    if (run % DRY_FAIL_EVERY === 0) {
      return { outcome: "failed", jobId, errorCode: "plan_failed", error: "dry run: simulated failure while planning" };
    }
    if (!job.metrics) return { outcome: "done", jobId };
    const time = job.metrics.timeToDemoSec + run;
    if (variant === "renamed") {
      const needing = job.run?.results.filter((r) => r.repairAttempts > 0).length;
      return { outcome: "done", jobId, metrics: { ...job.metrics, timeToDemoSec: time }, ...(needing === undefined ? {} : { stepsNeedingRepair: needing }) };
    }
    const m = job.metrics;
    return {
      outcome: "done",
      jobId,
      metrics: { ...m, timeToDemoSec: time, stepsOk: m.stepsOk + m.stepsRepaired, stepsRepaired: 0, repairRecoveryRate: 1 },
      stepsNeedingRepair: 0,
    };
  };
}

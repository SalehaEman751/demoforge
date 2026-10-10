import type { ComputeMetricsFn } from "@demoforge/shared";

/**
 * ASSUMPTION, not a measurement: a person needs 2.5 hours (9000 s) to build the same demo by hand.
 * Replace it with a measured value (set DEMOFORGE_MANUAL_BASELINE_SEC) before quoting the speed-up anywhere.
 */
export const DEFAULT_MANUAL_BASELINE_SEC = 9000;

/** The env value if it is a non-negative number, else the default. */
function manualBaselineSec(): number {
  const raw = process.env.DEMOFORGE_MANUAL_BASELINE_SEC;
  if (raw === undefined || raw.trim() === "") return DEFAULT_MANUAL_BASELINE_SEC;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MANUAL_BASELINE_SEC;
}

/** a / b rounded to 2 decimals and kept within 0..1; `whenEmpty` when b is 0. */
function rate(a: number, b: number, whenEmpty: number): number {
  if (!(b > 0)) return whenEmpty;
  return Math.min(1, Math.max(0, Math.round((a / b) * 100) / 100));
}

/**
 * Pure apart from reading the baseline env var.
 * - timeToDemoSec: (finishedAt - startedAt) / 1000, rounded; 0 if the interval is negative or not a number.
 * - skipped steps count only in stepsPlanned.
 * - planSuccessRate: (ok + repaired) / planned; 0 when there are no steps.
 * - repairRecoveryRate: repaired / steps that needed repair; 1 when none did.
 */
export const computeMetrics: ComputeMetricsFn = ({ run, startedAt, finishedAt }) => {
  const count = (status: string) => run.results.filter((r) => r.status === status).length;
  const stepsPlanned = run.results.length;
  const stepsOk = count("ok");
  const stepsRepaired = count("repaired");
  const stepsFailed = count("failed");
  const needed = run.results.filter((r) => r.repairAttempts > 0).length;
  const seconds = Math.round((finishedAt - startedAt) / 1000);

  return {
    timeToDemoSec: Number.isFinite(seconds) ? Math.max(0, seconds) : 0,
    manualBaselineSec: manualBaselineSec(),
    stepsPlanned,
    stepsOk,
    stepsRepaired,
    stepsFailed,
    planSuccessRate: rate(stepsOk + stepsRepaired, stepsPlanned, 0),
    repairRecoveryRate: rate(stepsRepaired, needed, 1),
  };
};

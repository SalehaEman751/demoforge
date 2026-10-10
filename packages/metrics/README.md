# @demoforge/metrics

`computeMetrics({ run, startedAt, finishedAt })` turns a `RunResult` into `Metrics`. Pure apart from reading one env var.

- `manualBaselineSec` comes from `DEMOFORGE_MANUAL_BASELINE_SEC` (default **9000**, 2.5 hours).
  **This is an assumption, not a measurement.** Time someone building the same demo by hand and set the real value before quoting the speed-up.
- `planSuccessRate` is 0 when there are no steps; `repairRecoveryRate` is 1 when no step needed repair.
- `src/mock.ts` returns `fixtures/metrics.json` (re-exported as `computeMetricsMock`).

Run: `npm run demo:metrics` (prints metrics computed from `fixtures/run-result.json`).

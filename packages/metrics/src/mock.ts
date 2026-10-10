import { MetricsSchema, loadFixture, type ComputeMetricsFn } from "@demoforge/shared";

/** Ignores its input and returns fixtures/metrics.json. */
export const computeMetrics: ComputeMetricsFn = () => loadFixture("metrics.json", MetricsSchema);

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import {
  ElementInventorySchema,
  JobSchema,
  LaunchInfoSchema,
  MetricsSchema,
  PlanSchema,
  ProjectBriefSchema,
  RunResultSchema,
} from "./index.js";

function load(name: string): unknown {
  const url = new URL(`../../../fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

const cases: [string, ZodTypeAny][] = [
  ["launch-info.json", LaunchInfoSchema],
  ["brief.json", ProjectBriefSchema],
  ["element-inventory.json", ElementInventorySchema],
  ["plan.json", PlanSchema],
  ["run-result.json", RunResultSchema],
  ["metrics.json", MetricsSchema],
  ["job.json", JobSchema],
];

describe("fixtures", () => {
  it.each(cases)("%s parses with its schema", (file, schema) => {
    const result = schema.safeParse(load(file));
    expect(result.success, result.success ? "" : result.error.message).toBe(true);
  });

  it("plan has the 8 expected actions in order", () => {
    const plan = PlanSchema.parse(load("plan.json"));
    expect(plan.steps.map((s) => s.action)).toEqual([
      "navigate", "fill", "fill", "click", "assert_text", "fill", "click", "assert_text",
    ]);
  });

  it("run result has all steps ok except one repaired", () => {
    const run = RunResultSchema.parse(load("run-result.json"));
    expect(run.results.filter((r) => r.status === "repaired")).toHaveLength(1);
    expect(run.results.filter((r) => r.status === "ok")).toHaveLength(7);
  });

  it("job.json embeds the same data as the individual fixtures", () => {
    const job = JobSchema.parse(load("job.json"));
    expect(job.info).toEqual(load("launch-info.json"));
    expect(job.brief).toEqual(load("brief.json"));
    expect(job.inventory).toEqual(load("element-inventory.json"));
    expect(job.plan).toEqual(load("plan.json"));
    expect(job.run).toEqual(load("run-result.json"));
    expect(job.metrics).toEqual(load("metrics.json"));
  });
});

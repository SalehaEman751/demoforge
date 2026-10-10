import { describe, expect, it } from "vitest";
import { PlanSchema, MetricsSchema, StepSchema } from "./index.js";

const step = { id: 1, action: "navigate", url: "/", caption: "Open home" } as const;

describe("schemas", () => {
  it("accepts a valid plan", () => {
    expect(PlanSchema.safeParse({ title: "t", steps: [step] }).success).toBe(true);
  });
  it("rejects empty and oversized plans", () => {
    expect(PlanSchema.safeParse({ title: "t", steps: [] }).success).toBe(false);
    const many = Array.from({ length: 26 }, (_, i) => ({ ...step, id: i + 1 }));
    expect(PlanSchema.safeParse({ title: "t", steps: many }).success).toBe(false);
  });
  it("rejects bad step ids and actions", () => {
    expect(StepSchema.safeParse({ ...step, id: 0 }).success).toBe(false);
    expect(StepSchema.safeParse({ ...step, action: "hover" }).success).toBe(false);
  });
  it("bounds rates to 0..1", () => {
    const m = {
      timeToDemoSec: 1, manualBaselineSec: 2, stepsPlanned: 1, stepsOk: 1,
      stepsRepaired: 0, stepsFailed: 0, planSuccessRate: 1, repairRecoveryRate: 0,
    };
    expect(MetricsSchema.safeParse(m).success).toBe(true);
    expect(MetricsSchema.safeParse({ ...m, planSuccessRate: 1.1 }).success).toBe(false);
  });
});

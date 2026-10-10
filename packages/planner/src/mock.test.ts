import { afterEach, describe, expect, it, vi } from "vitest";
import { ElementInventorySchema, PlanSchema, ProjectBriefSchema, loadFixture } from "@demoforge/shared";
import { MOCK_DELAY_MS, planDemo, validatePlan } from "./mock.js";
import { planDemoMock, validatePlanMock } from "./index.js";

const brief = loadFixture("brief.json", ProjectBriefSchema);
const inventory = loadFixture("element-inventory.json", ElementInventorySchema);

afterEach(() => vi.useRealTimers());

describe("planner mock", () => {
  it("returns fixtures/plan.json after exactly 1 second, without touching the network", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let done = false;
    const pending = planDemo({ brief, inventory, instructions: "anything" }).then((p) => ((done = true), p));

    expect(MOCK_DELAY_MS).toBe(1000);
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual(loadFixture("plan.json", PlanSchema));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("validatePlan mock accepts everything", () => {
    expect(validatePlan(loadFixture("plan.json", PlanSchema), inventory, "http://localhost:3100")).toEqual({ ok: true, errors: [] });
  });

  it("is re-exported from the package index as planDemoMock / validatePlanMock", () => {
    expect(planDemoMock).toBe(planDemo);
    expect(validatePlanMock).toBe(validatePlan);
  });
});

import { PlanSchema, loadFixture, type PlanDemoFn, type ValidatePlanFn } from "@demoforge/shared";

/** The mock pretends to think for a second, so the UI's "planning" stage is visible in a mock run. */
export const MOCK_DELAY_MS = 1000;

export const planDemo: PlanDemoFn = async () => {
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
  return loadFixture("plan.json", PlanSchema);
};

export const validatePlan: ValidatePlanFn = () => ({ ok: true, errors: [] });

import type { RepairStepFn } from "@demoforge/shared";

/**
 * Returns the input step with its target set to the first inventory element whose role matches the
 * step's target role. Null when the step has no target or no element has that role. Does not touch the counters.
 */
export const repairStep: RepairStepFn = async ({ step, inventory }) => {
  if (!step.target) return null;
  const role = step.target.role;
  for (const page of inventory.pages) {
    const el = page.elements.find((e) => e.role === role);
    if (el) return { ...step, target: { role: el.role, name: el.name } };
  }
  return null;
};

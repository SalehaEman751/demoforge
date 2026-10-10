import { StepSchema, type RepairStepFn } from "@demoforge/shared";
import { stage1Match } from "./stage1.js";
import { stage2Ask } from "./stage2.js";
import { countGaveUp, countStage1Fix, countStage2Fix } from "./stats.js";

/** Stage 1 (string matching), then stage 2 (local model), else null. Counts which one fixed the step. */
export const repairStep: RepairStepFn = async ({ step, error, inventory }) => {
  const fixed = (target: { role: string; name: string }) => {
    const parsed = StepSchema.safeParse({ ...step, target });
    return parsed.success ? parsed.data : null;
  };
  if (step.target) {
    const s1 = stage1Match(step.target, inventory);
    const r1 = s1 && fixed(s1);
    if (r1) {
      countStage1Fix();
      return r1;
    }
    const s2 = await stage2Ask({ step, error, inventory });
    const r2 = s2 && fixed(s2);
    if (r2) {
      countStage2Fix();
      return r2;
    }
  }
  countGaveUp();
  return null;
};

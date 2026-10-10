export type RepairStats = { stage1Fixes: number; stage2Fixes: number; gaveUp: number };

let stage1Fixes = 0;
let stage2Fixes = 0;
let gaveUp = 0;

export const countStage1Fix = (): void => void stage1Fixes++;
export const countStage2Fix = (): void => void stage2Fixes++;
export const countGaveUp = (): void => void gaveUp++;

/** A copy of the counters since the last reset. */
export function getRepairStats(): RepairStats {
  return { stage1Fixes, stage2Fixes, gaveUp };
}

export function resetRepairStats(): void {
  stage1Fixes = 0;
  stage2Fixes = 0;
  gaveUp = 0;
}

import type { Metrics } from "./shared";

/** "47 s", "4 min 12 s", "2 h 30 min". Rounds to whole seconds; drops a zero second part. */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (s < 3600) return s % 60 === 0 ? `${m} min` : `${m} min ${s % 60} s`;
  const h = Math.floor(s / 3600);
  const restMin = Math.floor((s % 3600) / 60);
  return restMin === 0 ? `${h} h` : `${h} h ${restMin} min`;
}

export const formatPercent = (rate: number): string => `${Math.round(Math.min(1, Math.max(0, rate)) * 100)}%`;

/** How many times faster than the manual baseline, or undefined when it is not meaningful. */
export function speedup(m: Pick<Metrics, "timeToDemoSec" | "manualBaselineSec">): number | undefined {
  if (!(m.timeToDemoSec > 0) || !(m.manualBaselineSec > 0)) return undefined;
  const x = m.manualBaselineSec / m.timeToDemoSec;
  return x >= 1.5 ? Math.round(x) : Math.round(x * 10) / 10;
}

/**
 * The manual baseline comes from DEMOFORGE_MANUAL_BASELINE_SEC, an estimate. Metrics carries no
 * flag saying it was measured (see NOTES/contract-issues.md), so it is always shown as assumed.
 */
export const BASELINE_IS_MEASURED = false;

export type RepairCard = { headline: string; detail: string };

/** Third card. No repaired and no failed steps means there was nothing to repair. */
export function repairCard(m: Pick<Metrics, "stepsRepaired" | "stepsFailed" | "repairRecoveryRate">): RepairCard {
  if (m.stepsRepaired === 0 && m.stepsFailed === 0) {
    return { headline: "No repairs needed", detail: "Every step worked on the first try" };
  }
  const attempted = m.stepsRepaired + m.stepsFailed;
  return {
    headline: formatPercent(m.repairRecoveryRate),
    detail: `${m.stepsRepaired} of ${attempted} problem ${attempted === 1 ? "step" : "steps"} fixed automatically`,
  };
}

export function successDetail(m: Pick<Metrics, "stepsPlanned" | "stepsOk" | "stepsRepaired">): string {
  const done = m.stepsOk + m.stepsRepaired;
  return `${done} of ${m.stepsPlanned} ${m.stepsPlanned === 1 ? "step" : "steps"} completed`;
}

/** File name for the download, keeping the recorded video's extension (mp4, or webm without ffmpeg). */
export function downloadName(jobId: string, videoPath: string | undefined): string {
  const ext = /\.(mp4|webm)$/i.exec(videoPath ?? "")?.[1]?.toLowerCase() ?? "mp4";
  return `demo-${jobId}.${ext}`;
}

import { describe, expect, it } from "vitest";
import { downloadName, formatDuration, formatPercent, repairCard, speedup, successDetail } from "./metrics-view";

describe("formatDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(47)).toBe("47 s");
    expect(formatDuration(94)).toBe("1 min 34 s");
    expect(formatDuration(120)).toBe("2 min");
    expect(formatDuration(1800)).toBe("30 min");
    expect(formatDuration(9000)).toBe("2 h 30 min");
    expect(formatDuration(7200)).toBe("2 h");
  });
});

describe("speedup", () => {
  it("divides baseline by time", () => {
    expect(speedup({ timeToDemoSec: 94, manualBaselineSec: 1800 })).toBe(19);
    expect(speedup({ timeToDemoSec: 100, manualBaselineSec: 120 })).toBe(1.2);
  });
  it("is undefined for zero values", () => {
    expect(speedup({ timeToDemoSec: 0, manualBaselineSec: 1800 })).toBe(undefined);
    expect(speedup({ timeToDemoSec: 10, manualBaselineSec: 0 })).toBe(undefined);
  });
});

describe("repairCard", () => {
  it("says no repairs needed when nothing was repaired or failed", () => {
    expect(repairCard({ stepsRepaired: 0, stepsFailed: 0, repairRecoveryRate: 0 }).headline).toBe("No repairs needed");
  });
  it("shows a percentage when a step was repaired", () => {
    const c = repairCard({ stepsRepaired: 1, stepsFailed: 1, repairRecoveryRate: 0.5 });
    expect(c.headline).toBe("50%");
    expect(c.detail).toBe("1 of 2 problem steps fixed automatically");
  });
  it("shows a percentage when a step failed without repair", () => {
    expect(repairCard({ stepsRepaired: 0, stepsFailed: 2, repairRecoveryRate: 0 }).headline).toBe("0%");
  });
});

describe("misc", () => {
  it("formats percent and success detail", () => {
    expect(formatPercent(0.875)).toBe("88%");
    expect(formatPercent(2)).toBe("100%");
    expect(successDetail({ stepsPlanned: 8, stepsOk: 7, stepsRepaired: 1 })).toBe("8 of 8 steps completed");
  });
  it("keeps the video extension", () => {
    expect(downloadName("job_1", "/x/demo.webm")).toBe("demo-job_1.webm");
    expect(downloadName("job_1", undefined)).toBe("demo-job_1.mp4");
  });
});

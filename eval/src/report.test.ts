import { describe, expect, it } from "vitest";
import { runBatch } from "./client.js";
import { dryExecutor } from "./dry.js";
import { ReportSchema, formatMarkdown, groupStats, headlineSentences, humanDuration, mergeBatch, type Batch } from "./report.js";
import type { RunRecord } from "./types.js";

const metrics = (o: Partial<NonNullable<RunRecord["metrics"]>> = {}) => ({
  timeToDemoSec: 20, manualBaselineSec: 9000, stepsPlanned: 8, stepsOk: 8, stepsRepaired: 0, stepsFailed: 0, planSuccessRate: 1, repairRecoveryRate: 1, ...o,
});
const done = (run: number, m = metrics(), needing = 0): RunRecord => ({ run, jobId: `j${run}`, outcome: "done", wallSec: 1, metrics: m, stepsNeedingRepair: needing });
const failed = (run: number, errorCode: RunRecord["errorCode"], error = "boom"): RunRecord => ({ run, outcome: "failed", errorCode, error, wallSec: 2 });
const batch = (variant: Batch["variant"]): Batch => ({ variant, source: "s", instructions: "i", api: "http://x", runsRequested: 10, generatedAt: "2026-01-01T00:00:00.000Z" });

const natural = [done(1, metrics({ timeToDemoSec: 180 })), done(2, metrics({ timeToDemoSec: 240 })), done(3, metrics({ timeToDemoSec: 210, planSuccessRate: 0.75, stepsOk: 6, stepsFailed: 2 })), failed(4, "plan_failed"), failed(5, "plan_failed"), { run: 6, outcome: "error", errorCode: "timeout", error: "t", wallSec: 9 } as RunRecord];
const renamed = [
  done(1, metrics({ stepsOk: 7, stepsRepaired: 1 }), 1),
  done(2, metrics({ stepsOk: 7, stepsRepaired: 1 }), 1),
  done(3, metrics({ stepsOk: 6, stepsRepaired: 1, stepsFailed: 1, planSuccessRate: 0.88, repairRecoveryRate: 0.5 }), 2),
  failed(4, "launch_failed"),
];
const full = () => {
  const a = mergeBatch(undefined, batch("natural"), natural, false);
  return mergeBatch(a.report, batch("renamed"), renamed, false).report;
};

describe("groupStats", () => {
  it("summarizes natural runs on their own", () => {
    const g = groupStats(full().runs, "natural");
    expect(g).toMatchObject({
      runs: 6, completed: 3, completionRate: 0.5, meanTimeToDemoSec: 210, medianTimeToDemoSec: 210,
      meanPlanSuccessRate: 0.92, meanRepairRecoveryRate: null, runsNeedingRepair: 0, stepsRepaired: 0,
      failuresByCode: { plan_failed: 2, timeout: 1 }, manualBaselineSec: 9000,
    });
  });
  it("summarizes seeded-failure runs on their own; recovery is the mean over runs that needed repair", () => {
    const g = groupStats(full().runs, "renamed");
    expect(g).toMatchObject({ runs: 4, completed: 3, completionRate: 0.75, runsNeedingRepair: 3, stepsRepaired: 3, stepsNeedingRepair: 4, meanRepairRecoveryRate: 0.83, failuresByCode: { launch_failed: 1 } });
  });
  it("copes with an empty group", () => {
    expect(groupStats([], "natural")).toMatchObject({ runs: 0, completionRate: null, medianTimeToDemoSec: null, meanPlanSuccessRate: null });
  });
});

describe("mergeBatch", () => {
  it("keeps the other variant and replaces the same one", () => {
    const first = full();
    const again = mergeBatch(first, batch("natural"), [done(1)], false);
    expect(again.report.runs.filter((r) => r.variant === "natural")).toHaveLength(1);
    expect(again.report.runs.filter((r) => r.variant === "renamed")).toHaveLength(4);
    expect(again.note).toBeUndefined();
  });
  it("produces a report that validates and records the error code per run", () => {
    const r = full();
    expect(ReportSchema.parse(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(r.runs.find((x) => x.variant === "natural" && x.run === 4)).toMatchObject({ status: "failed", errorCode: "plan_failed", timeToDemoSec: null, metrics: null });
    expect(r.runs.find((x) => x.variant === "natural" && x.run === 1)).toMatchObject({ status: "done", errorCode: null, timeToDemoSec: 180 });
  });
  it("never mixes dry and real batches, and replaces an invalid file", () => {
    const real = full();
    const m = mergeBatch(real, batch("natural"), [done(1)], true);
    expect(m.note).toMatch(/real results/);
    expect(m.report.runs).toHaveLength(1);
    expect(mergeBatch({ nope: 1 }, batch("natural"), [done(1)], false).note).toMatch(/not valid/);
  });
});

describe("markdown", () => {
  it("has separate tables for natural and renamed runs, then the headline block last", () => {
    const md = formatMarkdown(full());
    const nat = md.indexOf("## Natural runs");
    const ren = md.indexOf("## Seeded-failure runs (variant renamed)");
    const head = md.indexOf("## Headline numbers");
    expect(nat).toBeGreaterThan(-1);
    expect(ren).toBeGreaterThan(nat);
    expect(head).toBeGreaterThan(ren);
    expect(md.slice(nat, ren)).toContain("| Completion rate | 50% (3 of 6) |");
    expect(md.slice(nat, ren)).toContain("| plan_failed | 2 |");
    expect(md.slice(nat, ren)).not.toContain("launch_failed");
    expect(md.slice(ren, head)).toContain("| Completion rate | 75% (3 of 4) |");
    expect(md.slice(ren, head)).toContain("| launch_failed | 1 |");
    expect(md.slice(ren, head)).toContain("| Mean repair recovery rate | 83% (3 run(s) needed repair) |");
    expect(md.trimEnd().split("\n").slice(-3)).toHaveLength(3);
  });
  it("warns when the seeded failure never repaired anything", () => {
    const r = mergeBatch(undefined, batch("renamed"), [done(1), done(2)], false).report;
    expect(formatMarkdown(r)).toContain("WARNING: no step was repaired");
  });
});

describe("headline numbers", () => {
  it("writes three sentences from the right group", () => {
    expect(headlineSentences(full())).toEqual([
      "DemoForge completed 3 of 6 demos in a median of 3.5 minutes versus about 2.5 hours manually (an assumed baseline).",
      "With a renamed button (a seeded failure), DemoForge repaired 3 of 4 broken steps (75%) and completed 3 of 4 demos.",
      "Across 6 natural runs, 92% of planned steps succeeded on average, and 3 runs failed, most often with plan_failed.",
    ]);
  });
  it("says so instead of inventing numbers when a group is missing", () => {
    const only = mergeBatch(undefined, batch("natural"), [done(1), done(2)], false).report;
    const [s1, s2, s3] = headlineSentences(only);
    expect(s1).toMatch(/completed 2 of 2 demos/);
    expect(s2).toMatch(/No seeded-failure runs recorded yet/);
    expect(s3).toMatch(/no run failed/);
  });
  it("marks dry numbers as fake in every sentence", () => {
    const dry = mergeBatch(undefined, batch("natural"), [done(1)], true).report;
    expect(headlineSentences(dry).every((s) => s.startsWith("[DRY RUN, FAKE DATA] "))).toBe(true);
    expect(formatMarkdown(dry)).toContain("DRY RUN");
  });
  it("formats durations", () => {
    expect([24, 204, 9000, 1800].map(humanDuration)).toEqual(["24 seconds", "3.4 minutes", "2.5 hours", "30 minutes"]);
  });
});

describe("dry mode end to end", () => {
  it("fills both tables with no API, natural runs needing no repair and renamed runs repairing one step", async () => {
    const run = async (v: "natural" | "renamed") => runBatch({ runs: 10, request: { source: "s", instructions: "i" }, execute: dryExecutor(v) });
    const a = mergeBatch(undefined, batch("natural"), await run("natural"), true);
    const report = mergeBatch(a.report, batch("renamed"), await run("renamed"), true).report;
    expect(groupStats(report.runs, "natural")).toMatchObject({ completed: 8, stepsRepaired: 0, meanRepairRecoveryRate: null, failuresByCode: { plan_failed: 2 } });
    expect(groupStats(report.runs, "renamed")).toMatchObject({ completed: 8, stepsRepaired: 8, stepsNeedingRepair: 8, meanRepairRecoveryRate: 1 });
  });
});

import { describe, expect, it } from "vitest";
import { failureInfo, logLines, stageStates, stepRows } from "./job-view";
import type { Job, JobEvent, Plan } from "./shared";

const stage = (s: string): JobEvent => ({ type: "stage", stage: s, message: s });
const step = (stepId: number, status: string): JobEvent => ({ type: "step", stepId, message: `cap ${stepId}`, data: { status } });
const job = (over: Partial<Job>): Job => ({ id: "job_00000000", status: "queued", projectSource: "p", instructions: "", createdAt: 0, ...over });
const plan: Plan = {
  title: "t",
  steps: [
    { id: 1, action: "scroll", caption: "one" },
    { id: 2, action: "scroll", caption: "two" },
    { id: 3, action: "scroll", caption: "three" },
  ],
};

describe("stageStates", () => {
  it("is all pending for a queued job", () => {
    expect(stageStates(job({}), [])).toEqual(["pending", "pending", "pending", "pending", "pending"]);
  });
  it("marks earlier stages done and the current one active", () => {
    expect(stageStates(job({ status: "planning" }), [stage("launching"), stage("inspecting"), stage("planning")])).toEqual([
      "done", "done", "active", "pending", "pending",
    ]);
  });
  it("uses the job status when no events arrived (reload without events)", () => {
    expect(stageStates(job({ status: "running" }), [])).toEqual(["done", "done", "done", "active", "pending"]);
  });
  it("is all done after a done event or a done job", () => {
    expect(stageStates(job({ status: "done" }), [])).toEqual(["done", "done", "done", "done", "done"]);
    expect(stageStates(undefined, [{ type: "done" }])).toEqual(["done", "done", "done", "done", "done"]);
  });
  it("marks the failing stage from the error event", () => {
    const ev: JobEvent[] = [stage("launching"), stage("inspecting"), { type: "error", stage: "inspecting", message: "x" }];
    expect(stageStates(job({ status: "failed" }), ev)).toEqual(["done", "failed", "pending", "pending", "pending"]);
  });
  it("falls back to the last stage seen when the error has no stage", () => {
    expect(stageStates(job({ status: "failed" }), [stage("launching"), stage("inspecting"), stage("planning"), { type: "error" }])).toEqual([
      "done", "done", "failed", "pending", "pending",
    ]);
  });
});

describe("stepRows", () => {
  it("is empty without a plan", () => {
    expect(stepRows(undefined, undefined, [])).toEqual([]);
  });
  it("defaults to pending and lets later events win", () => {
    const rows = stepRows(plan, job({ status: "running" }), [step(1, "running"), step(1, "ok"), step(2, "running")]);
    expect(rows.map((r) => r.status)).toEqual(["ok", "running", "pending"]);
    expect(rows.map((r) => r.caption)).toEqual(["one", "two", "three"]);
  });
  it("fills gaps from run results", () => {
    const run = { videoPath: "v", logPath: "l", startedAt: 0, finishedAt: 1, results: [{ stepId: 3, status: "repaired" as const, durationMs: 1, repairAttempts: 1 }] };
    const rows = stepRows(plan, job({ status: "done", run }), [step(1, "ok"), step(2, "skipped")]);
    expect(rows.map((r) => r.status)).toEqual(["ok", "skipped", "repaired"]);
  });
  it("does not leave a spinner on a failed job", () => {
    const rows = stepRows(plan, job({ status: "failed" }), [step(1, "ok"), step(2, "running")]);
    expect(rows.map((r) => r.status)).toEqual(["ok", "failed", "pending"]);
  });
});

describe("logLines", () => {
  it("renders each event type", () => {
    const lines = logLines([
      stage("launching"),
      { type: "log", message: "hello" },
      { type: "step", stepId: 2, message: "Click", data: { status: "failed", error: "boom" } },
      { type: "error", message: "bad" },
    ]);
    expect(lines.map((l) => l.kind)).toEqual(["stage", "info", "error", "error"]);
    expect(lines[2]!.text).toBe("Step 2 failed: Click (boom)");
  });
});

describe("failureInfo", () => {
  const failed = job({ status: "failed", error: "The port is already used." });
  it("is undefined for a job that did not fail", () => {
    expect(failureInfo(job({ status: "running" }), [])).toBeUndefined();
    expect(failureInfo(job({ status: "done" }), [])).toBeUndefined();
    expect(failureInfo(undefined, [])).toBeUndefined();
  });
  it("uses the job's message and the error event's code", () => {
    const ev: JobEvent = { type: "error", message: "raw", data: { code: "PORT_IN_USE", stage: "launching" } };
    expect(failureInfo(failed, [ev])).toEqual({ message: "The port is already used.", code: "PORT_IN_USE" });
  });
  it("falls back to the event's message, and to JOB_FAILED when no code is known", () => {
    expect(failureInfo(job({ status: "failed" }), [{ type: "error", message: "boom" }])).toEqual({ message: "boom", code: "JOB_FAILED" });
    expect(failureInfo(failed, [])).toEqual({ message: "The port is already used.", code: "JOB_FAILED" });
    expect(failureInfo(failed, [{ type: "error", data: { code: 7 } }])?.code).toBe("JOB_FAILED");
  });
  it("shows the failure from an error event before the job has been refetched", () => {
    expect(failureInfo(job({ status: "running" }), [{ type: "error", message: "late", data: { code: "RUN_FAILED" } }])).toEqual({
      message: "late",
      code: "RUN_FAILED",
    });
  });
  it("always has some message", () => {
    expect(failureInfo(job({ status: "failed" }), [])?.message).toMatch(/something went wrong/i);
  });
});

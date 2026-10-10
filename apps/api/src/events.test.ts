import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobEvents, isTerminalEvent } from "./events.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "df-events-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const jobDir = (id: string) => join(dir, id);

describe("JobEvents", () => {
  it("replays history and streams live events to subscribers", () => {
    const ev = new JobEvents(jobDir);
    ev.emit("job_a", { type: "stage", stage: "launching" });
    const seen: string[] = [];
    const off = ev.subscribe("job_a", (e) => seen.push(e.type));
    ev.emit("job_a", { type: "log", message: "hi" });
    off();
    ev.emit("job_a", { type: "done" });
    expect(seen).toEqual(["log"]);
    expect(ev.history("job_a").map((e) => e.type)).toEqual(["stage", "log", "done"]);
  });

  it("keeps jobs separate and survives a restart", () => {
    const ev = new JobEvents(jobDir);
    ev.emit("job_a", { type: "stage", stage: "planning" });
    ev.emit("job_b", { type: "error", message: "x" });
    const again = new JobEvents(jobDir);
    expect(again.history("job_a")).toEqual([{ type: "stage", stage: "planning" }]);
    expect(again.history("job_b")).toHaveLength(1);
    expect(again.history("job_none")).toEqual([]);
  });

  it("a throwing subscriber does not break emit", () => {
    const ev = new JobEvents(jobDir);
    ev.subscribe("job_a", () => {
      throw new Error("bad client");
    });
    expect(() => ev.emit("job_a", { type: "log" })).not.toThrow();
  });

  it("knows terminal events", () => {
    expect(isTerminalEvent({ type: "done" })).toBe(true);
    expect(isTerminalEvent({ type: "error" })).toBe(true);
    expect(isTerminalEvent({ type: "step" })).toBe(false);
  });
});

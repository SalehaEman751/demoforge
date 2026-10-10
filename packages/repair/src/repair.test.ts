import { ElementInventorySchema, loadFixture, type Step } from "@demoforge/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRepairStats, repairStep, repairStepMock, resetRepairStats } from "./index.js";

const inventory = loadFixture("element-inventory.json", ElementInventorySchema);
const click = (role: string, name: string): Step => ({ id: 1, action: "click", target: { role, name }, caption: "c" });
const args = (step: Step) => ({ step, error: "timeout", inventory, baseUrl: "http://x" });

beforeEach(() => {
  resetRepairStats();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no ollama"); }));
});
afterEach(() => vi.unstubAllGlobals());

describe("mock", () => {
  it("sets the target to the first element with the matching role and keeps the rest", async () => {
    const step: Step = { id: 3, action: "click", target: { role: "button", name: "Nope" }, caption: "cap" };
    expect(await repairStepMock(args(step))).toEqual({ ...step, target: { role: "button", name: "Create account" } });
  });
  it("returns null with no matching role or no target", async () => {
    expect(await repairStepMock(args(click("slider", "x")))).toBeNull();
    expect(await repairStepMock(args({ id: 1, action: "navigate", url: "/", caption: "c" }))).toBeNull();
  });
});

describe("repairStep", () => {
  it("fixes typos, wrong roles and renames in stage 1", async () => {
    expect((await repairStep(args(click("button", "Creat account"))))?.target).toEqual({ role: "button", name: "Create account" });
    expect((await repairStep(args(click("button", "Sign up"))))?.target).toEqual({ role: "link", name: "Sign up" });
    expect((await repairStep(args(click("button", "Add item"))))?.target).toEqual({ role: "button", name: "Add task" });
    expect(getRepairStats()).toEqual({ stage1Fixes: 3, stage2Fixes: 0, gaveUp: 0 });
  });
  it("counts a give-up when nothing matches and stage 2 is down", async () => {
    expect(await repairStep(args(click("button", "Export CSV")))).toBeNull();
    expect(getRepairStats()).toEqual({ stage1Fixes: 0, stage2Fixes: 0, gaveUp: 1 });
  });
  it("uses stage 2 only for a real inventory element", async () => {
    const reply = (o: unknown) => vi.fn(async () => new Response(JSON.stringify({ message: { content: JSON.stringify(o) } })));
    vi.stubGlobal("fetch", reply({ role: "button", name: "Create account" }));
    expect((await repairStep(args(click("button", "Register"))))?.target?.name).toBe("Create account");
    vi.stubGlobal("fetch", reply({ role: "button", name: "Invented" }));
    expect(await repairStep(args(click("button", "Register")))).toBeNull();
    expect(getRepairStats()).toEqual({ stage1Fixes: 0, stage2Fixes: 1, gaveUp: 1 });
  });
  it("resets the counters", async () => {
    await repairStep(args(click("button", "Export CSV")));
    resetRepairStats();
    expect(getRepairStats()).toEqual({ stage1Fixes: 0, stage2Fixes: 0, gaveUp: 0 });
  });
});

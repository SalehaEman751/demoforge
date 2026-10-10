import { ElementInventorySchema, loadFixture, type ElementInventory } from "@demoforge/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { similarity, stage1Match } from "./stage1.js";

const fixture = loadFixture("element-inventory.json", ElementInventorySchema);
const inv = (...elements: { role: string; name: string }[]): ElementInventory => ({ pages: [{ url: "/", title: "t", elements }] });

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(async () => {
    throw new Error("stage 1 must not use the network");
  });
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("similarity", () => {
  it("is 1 for names equal after case, spacing and punctuation", () => {
    expect(similarity("Create  Account!", "create account")).toBe(1);
  });
  it("is 0 for empty or unrelated names", () => {
    expect(similarity("", "Email")).toBe(0);
    expect(similarity("zzz", "Email")).toBe(0);
  });
  it("scores a one-letter typo high and a shared word at 0.5", () => {
    expect(similarity("Emial", "Email")).toBeGreaterThanOrEqual(0.5);
    expect(similarity("Add item", "Add task")).toBe(0.5);
  });
});

describe("stage1Match", () => {
  it("fixes typos", () => {
    expect(stage1Match({ role: "textbox", name: "Emial" }, fixture)).toEqual({ role: "textbox", name: "Email" });
    expect(stage1Match({ role: "button", name: "Creat account" }, fixture)).toEqual({ role: "button", name: "Create account" });
  });
  it("fixes a wrong role when the name is the same", () => {
    expect(stage1Match({ role: "link", name: "Create account" }, fixture)).toEqual({ role: "button", name: "Create account" });
    expect(stage1Match({ role: "button", name: "Sign up" }, fixture)).toEqual({ role: "link", name: "Sign up" });
  });
  it("fixes a partial rename within the same role", () => {
    expect(stage1Match({ role: "button", name: "Add item" }, fixture)).toEqual({ role: "button", name: "Add task" });
    expect(stage1Match({ role: "textbox", name: "New item" }, fixture)).toEqual({ role: "textbox", name: "New task" });
  });
  it("returns null when the target already exists as written (not a naming problem)", () => {
    expect(stage1Match({ role: "button", name: "add TASK" }, fixture)).toBeNull();
  });
  it("returns null when nothing is close enough", () => {
    expect(stage1Match({ role: "button", name: "Export CSV" }, fixture)).toBeNull();
    expect(stage1Match({ role: "button", name: "Register" }, fixture)).toBeNull();
  });
  it("does not trust a weak match under a different role", () => {
    expect(stage1Match({ role: "link", name: "Add item" }, fixture)).toBeNull();
  });
  it("returns null when two same-role candidates tie", () => {
    expect(stage1Match({ role: "button", name: "Save" }, inv({ role: "button", name: "Save task" }, { role: "button", name: "Save note" }))).toBeNull();
  });
  it("prefers the same role over another role at equal score", () => {
    expect(stage1Match({ role: "button", name: "Send" }, inv({ role: "link", name: "Sent" }, { role: "button", name: "Sent" }))).toEqual({ role: "button", name: "Sent" });
  });
  it("never offers a heading for a click or fill target, but does for a heading target", () => {
    const i = inv({ role: "heading", name: "Create your account" });
    expect(stage1Match({ role: "button", name: "Create account" }, i)).toBeNull();
    expect(stage1Match({ role: "heading", name: "Create your acount" }, i)).toEqual({ role: "heading", name: "Create your account" });
  });
  it("treats the same element listed on several pages as one candidate", () => {
    const i: ElementInventory = {
      pages: [
        { url: "/a", title: "a", elements: [{ role: "link", name: "Pricing" }] },
        { url: "/b", title: "b", elements: [{ role: "link", name: "Pricing" }] },
      ],
    };
    expect(stage1Match({ role: "link", name: "Pricng" }, i)).toEqual({ role: "link", name: "Pricing" });
  });
  it("returns null for an empty inventory", () => {
    expect(stage1Match({ role: "button", name: "Go" }, { pages: [] })).toBeNull();
  });
});

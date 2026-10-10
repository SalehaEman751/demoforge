import { afterEach, describe, expect, it, vi } from "vitest";
import { ElementInventorySchema, PlanSchema, loadFixture, type ElementInventory, type Plan, type Step } from "@demoforge/shared";
import { validatePlan } from "./validate.js";

const BASE = "http://localhost:3100";
const inventory = loadFixture("element-inventory.json", ElementInventorySchema);
const goodPlan = loadFixture("plan.json", PlanSchema);

const nav = (id: number, url: string): Step => ({ id, action: "navigate", url, caption: `go ${url}` });
const click = (id: number, role: string, name: string): Step => ({ id, action: "click", target: { role, name }, caption: `click ${name}` });
const fill = (id: number, name: string, value = "x"): Step => ({ id, action: "fill", target: { role: "textbox", name }, value, caption: `fill ${name}` });
const plan = (...steps: Step[]): Plan => ({ title: "t", steps });

const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
afterEach(() => warn.mockClear());

describe("validatePlan: good plans", () => {
  it("accepts fixtures/plan.json against fixtures/element-inventory.json (a click may move to the dashboard)", () => {
    expect(validatePlan(goodPlan, inventory, BASE)).toEqual({ ok: true, errors: [] });
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts absolute urls on the base origin, query strings and trailing slashes", () => {
    const p = plan(nav(1, `${BASE}/signup/?ref=x`), fill(2, "Email"), click(3, "button", "Create account"));
    expect(validatePlan(p, inventory, BASE)).toEqual({ ok: true, errors: [] });
  });

  it("matches names case-insensitively and tolerates a small typo", () => {
    const p = plan(nav(1, "/signup"), fill(2, "EMAIL"), fill(3, "Pasword"), click(4, "button", "create  account"));
    expect(validatePlan(p, inventory, BASE).ok).toBe(true);
  });

  it("accepts a plan with no click/fill at all", () => {
    const p = plan(nav(1, "/"), { id: 2, action: "scroll", caption: "scroll" }, { id: 3, action: "wait", ms: 500, caption: "wait" }, { id: 4, action: "assert_text", text: "Taskly", caption: "see it" });
    expect(validatePlan(p, inventory, BASE).ok).toBe(true);
  });
});

describe("validatePlan: structure", () => {
  it("rejects an off-site url, however it is spelled", () => {
    for (const url of ["https://example.com/", "//example.com/x", "http://localhost:3100.evil.com/", "http://localhost:3101/", "javascript:alert(1)"]) {
      const res = validatePlan(plan(nav(1, url)), inventory, BASE);
      expect(res.ok, url).toBe(false);
      expect(res.errors[0], url).toMatch(/step 1: navigate url .* never another origin/);
    }
  });

  it("rejects ids that are not 1..n in order", () => {
    const p = { title: "t", steps: [nav(1, "/"), nav(3, "/signup")] };
    const res = validatePlan(p, inventory, BASE);
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/steps\.1\.id: step ids must be 1\.\.n in order; expected 2, got 3/);
  });

  it("rejects 30 steps (the limit is 25) and accepts exactly 25", () => {
    const many = (n: number) => plan(...Array.from({ length: n }, (_, i) => (i === 0 ? nav(1, "/") : ({ id: i + 1, action: "scroll", caption: "s" }) as Step)));
    const res = validatePlan(many(30), inventory, BASE);
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/steps: .*at most 25/);
    expect(validatePlan(many(25), inventory, BASE).ok).toBe(true);
  });

  it("rejects an action outside the allowlist, a missing field, garbage and an empty plan", () => {
    const hover = { title: "t", steps: [{ id: 1, action: "hover", caption: "c" }] };
    expect(validatePlan(hover, inventory, BASE).errors.join("\n")).toMatch(/steps\.0\.action/);
    const noValue = { title: "t", steps: [nav(1, "/signup"), { id: 2, action: "fill", target: { role: "textbox", name: "Email" }, caption: "c" }] };
    expect(validatePlan(noValue, inventory, BASE).errors).toContain("steps.1.value: fill requires value");
    const noText = { title: "t", steps: [nav(1, "/"), { id: 2, action: "assert_text", caption: "c" }] };
    expect(validatePlan(noText, inventory, BASE).errors).toContain("steps.1.text: assert_text requires text");
    expect(validatePlan(null, inventory, BASE).ok).toBe(false);
    expect(validatePlan({ title: "t", steps: [] }, inventory, BASE).ok).toBe(false);
  });

  it("rejects a first step that is not navigate", () => {
    const res = validatePlan(plan(click(1, "link", "Sign up")), inventory, BASE);
    expect(res.ok).toBe(false);
    expect(res.errors).toContain("step 1: the first step must be navigate, got click");
  });

  it("rejects an empty fill value and empty assert_text text", () => {
    const p = plan(nav(1, "/signup"), fill(2, "Email", "  "), { id: 3, action: "assert_text", text: "", caption: "c" });
    expect(validatePlan(p, inventory, BASE).errors).toEqual(["step 2: fill needs a non-empty value", "step 3: assert_text needs non-empty text"]);
  });

  it("rejects an invalid baseUrl without throwing", () => {
    expect(validatePlan(goodPlan, inventory, "not a url").ok).toBe(false);
  });
});

describe("validatePlan: targets against the inventory", () => {
  it("rejects an element that is not on the current page, and says what the page has", () => {
    const res = validatePlan(plan(nav(1, "/signup"), click(2, "button", "Delete everything")), inventory, BASE);
    expect(res.ok).toBe(false);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toMatch(/step 2: no button named "Delete everything" on \/signup \(it has: .*"Create account"/);
  });

  it("rejects an element that lives on another page when we navigated away from it", () => {
    const res = validatePlan(plan(nav(1, "/"), fill(2, "New task")), inventory, BASE);
    expect(res.errors[0]).toMatch(/step 2: no textbox named "New task" on \//);
  });

  it("rejects the right name with the wrong role", () => {
    const res = validatePlan(plan(nav(1, "/signup"), click(2, "link", "Create account")), inventory, BASE);
    expect(res.errors[0]).toMatch(/"Create account" is a button on \/signup, not a link/);
  });

  it("does not let a typo through when the names are really different", () => {
    expect(validatePlan(plan(nav(1, "/signup"), click(2, "button", "Sign in")), inventory, BASE).ok).toBe(false);
  });

  it("tracks the page through navigate steps", () => {
    const p = plan(nav(1, "/signup"), fill(2, "Email"), nav(3, "/dashboard"), fill(4, "New task"), nav(5, "/signup"), click(6, "button", "Add task"));
    const res = validatePlan(p, inventory, BASE);
    expect(res.errors).toEqual([expect.stringMatching(/step 6: no button named "Add task" on \/signup/)]);
  });

  it("after a click, accepts a target that exists on another page, but still rejects one that exists nowhere", () => {
    const ok = plan(nav(1, "/signup"), click(2, "button", "Create account"), fill(3, "New task"));
    expect(validatePlan(ok, inventory, BASE).ok).toBe(true);
    const bad = plan(nav(1, "/signup"), click(2, "button", "Create account"), fill(3, "Nickname"));
    expect(validatePlan(bad, inventory, BASE).ok).toBe(false);
  });

  it("warns, but does not fail, when the current page is not in the inventory", () => {
    const res = validatePlan(plan(nav(1, "/pricing"), click(2, "button", "Buy now")), inventory, BASE);
    expect(res).toEqual({ ok: true, errors: [] });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/step 2: current page \/pricing is not in the inventory/);
  });

  it("warns, but does not fail, when the current page redirects", () => {
    const redirected: ElementInventory = {
      pages: [{ url: "/dashboard", title: "Dashboard", redirectedTo: "/login", elements: [] }, ...inventory.pages],
    };
    const res = validatePlan(plan(nav(1, "/dashboard"), click(2, "button", "Whatever")), redirected, BASE);
    expect(res).toEqual({ ok: true, errors: [] });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/step 2: \/dashboard redirects to \/login/);
  });

  it("matches inventory pages given as absolute urls", () => {
    const absolute: ElementInventory = { pages: inventory.pages.map((p) => ({ ...p, url: BASE + p.url })) };
    expect(validatePlan(goodPlan, absolute, BASE).ok).toBe(true);
  });

  it("reports every problem, not just the first", () => {
    const p = plan(nav(1, "https://example.com/"), nav(2, "/signup"), click(3, "button", "Nope"), fill(4, "Nada"));
    expect(validatePlan(p, inventory, BASE).errors).toHaveLength(3);
  });
});

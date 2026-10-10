import { describe, expect, it } from "vitest";
import { PlanSchema, StepSchema } from "./index.js";

const target = { role: "button", name: "Go" };
const base = { id: 1, caption: "c" };

// [label, passing step, failing step, field named in the error]
const cases = [
  ["navigate needs url", { ...base, action: "navigate", url: "/" }, { ...base, action: "navigate" }, "url"],
  ["click needs target", { ...base, action: "click", target }, { ...base, action: "click" }, "target"],
  [
    "fill needs target",
    { ...base, action: "fill", target, value: "v" },
    { ...base, action: "fill", value: "v" },
    "target",
  ],
  [
    "fill needs value",
    { ...base, action: "fill", target, value: "v" },
    { ...base, action: "fill", target },
    "value",
  ],
  [
    "assert_text needs text",
    { ...base, action: "assert_text", text: "hi" },
    { ...base, action: "assert_text" },
    "text",
  ],
  ["wait needs ms", { ...base, action: "wait", ms: 0 }, { ...base, action: "wait" }, "ms"],
] as const;

describe("Step refinements", () => {
  it.each(cases)("%s", (_label, good, bad, field) => {
    expect(StepSchema.safeParse(good).success).toBe(true);
    const res = StepSchema.safeParse(bad);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues.map((i) => i.path[0])).toContain(field);
  });

  it("scroll needs nothing extra", () => {
    expect(StepSchema.safeParse({ ...base, action: "scroll" }).success).toBe(true);
  });
});

describe("Plan step ids", () => {
  const nav = (id: number) => ({ id, action: "navigate", url: "/", caption: "c" });
  const plan = (ids: number[]) => ({ title: "t", steps: ids.map(nav) });

  it("accepts 1..n in order", () => {
    expect(PlanSchema.safeParse(plan([1, 2, 3])).success).toBe(true);
  });
  it.each([[[2, 3]], [[1, 3]], [[2, 1]], [[1, 1]]])("rejects %j", (ids) => {
    expect(PlanSchema.safeParse(plan(ids)).success).toBe(false);
  });
});

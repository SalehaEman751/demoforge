import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElementInventorySchema, PlanSchema, ProjectBriefSchema, loadFixture } from "@demoforge/shared";

vi.mock("./ollama.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("./ollama.js")>()), chatJsonRaw: vi.fn() }));
import { chatJsonRaw } from "./ollama.js";
import { PlanError, planDemo } from "./plan-demo.js";

const brief = loadFixture("brief.json", ProjectBriefSchema);
const inventory = loadFixture("element-inventory.json", ElementInventorySchema);
const good = loadFixture("plan.json", PlanSchema);
const model = vi.mocked(chatJsonRaw);
const dir = mkdtempSync(join(tmpdir(), "cached-plan-"));
const file = (name: string, content: unknown): string => {
  const p = join(dir, name);
  writeFileSync(p, typeof content === "string" ? content : JSON.stringify(content));
  return p;
};
const run = () => planDemo({ brief, inventory, instructions: "anything" });

beforeEach(() => model.mockReset());
afterEach(() => delete process.env.DEMOFORGE_CACHED_PLAN);

describe("planDemo: cached-plan mode", () => {
  it("returns the file's plan without calling the model", async () => {
    process.env.DEMOFORGE_CACHED_PLAN = file("good.json", good);
    expect(await run()).toEqual(good);
    expect(model).not.toHaveBeenCalled();
  });

  it("ignores an empty or blank value and uses the model", async () => {
    process.env.DEMOFORGE_CACHED_PLAN = "  ";
    model.mockResolvedValueOnce({ raw: JSON.stringify(good), json: good });
    await run();
    expect(model).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a missing file", () => join(dir, "nope.json"), /could not read the file \(ENOENT\)/],
    ["a file that is not JSON", () => file("junk.json", "{not json"), /not valid JSON/],
    ["a plan that breaks the schema", () => file("schema.json", { title: "t", steps: [{ id: 1, action: "hover", caption: "c" }] }), /steps/],
    [
      "a plan that does not fit the inventory",
      () => file("fit.json", { ...good, steps: good.steps.map((s) => (s.id === 4 ? { ...s, target: { role: "button", name: "Sign in" } } : s)) }),
      /Sign in/,
    ],
  ])("throws PlanError for %s, never falling back to the model", async (_name, make, message) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.DEMOFORGE_CACHED_PLAN = make();
    const err = await run().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlanError);
    expect((err as PlanError).message).toMatch(message);
    expect(model).not.toHaveBeenCalled();
  });
});

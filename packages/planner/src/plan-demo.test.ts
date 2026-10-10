import { beforeEach, describe, expect, it, vi } from "vitest";
import { ElementInventorySchema, PlanSchema, ProjectBriefSchema, loadFixture } from "@demoforge/shared";

vi.mock("./ollama.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("./ollama.js")>()), chatJsonRaw: vi.fn() }));
import { OllamaError, chatJsonRaw } from "./ollama.js";
import { PlanError, planDemo, type PlanLogEntry } from "./plan-demo.js";
import { PLAN_JSON_SCHEMA } from "./plan-schema.js";
import { SYSTEM_PROMPT } from "./prompt.js";

const brief = loadFixture("brief.json", ProjectBriefSchema);
const inventory = loadFixture("element-inventory.json", ElementInventorySchema);
const good = loadFixture("plan.json", PlanSchema);
const instructions = "Show a new user signing up and adding their first task.";

/** A reply as the model would send it. */
const reply = (value: unknown) => {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    json = undefined;
  }
  return { raw, json };
};
const badSchema = { title: "t", steps: [{ id: 1, action: "hover", caption: "c" }] };
const badElement = { ...good, steps: good.steps.map((s) => (s.id === 4 ? { ...s, target: { role: "button", name: "Sign in" } } : s)) };

const model = vi.mocked(chatJsonRaw);
const script = (...replies: ReturnType<typeof reply>[]) => replies.forEach((r) => model.mockResolvedValueOnce(r));
const run = (onLog?: (e: PlanLogEntry) => void) => planDemo({ brief, inventory, instructions, onLog });

beforeEach(() => {
  model.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("planDemo: happy path", () => {
  it("makes one call with the prompt and the Plan JSON schema, and returns the plan", async () => {
    script(reply(good));
    const plan = await run();
    expect(plan).toEqual(good);
    expect(model).toHaveBeenCalledTimes(1);
    const [messages, schema] = model.mock.calls[0]!;
    expect(schema).toBe(PLAN_JSON_SCHEMA);
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(messages[0]!.content).toBe(SYSTEM_PROMPT);
    expect(messages[1]!.content).toContain("/signup | textbox | Email");
    expect(messages[1]!.content).toContain(`Instructions: ${instructions}`);
  });

  it("hands the raw prompt and response to onLog", async () => {
    script(reply(good));
    const entries: PlanLogEntry[] = [];
    await run((e) => entries.push(e));
    expect(entries).toEqual([{ stage: "plan", prompt: model.mock.calls[0]![0], response: JSON.stringify(good), problems: [] }]);
  });
});

describe("planDemo: schema failure -> one retry", () => {
  it("retries with the error appended after the bad reply, then succeeds", async () => {
    script(reply(badSchema), reply(good));
    const entries: PlanLogEntry[] = [];
    expect(await run((e) => entries.push(e))).toEqual(good);
    expect(model).toHaveBeenCalledTimes(2);
    const retry = model.mock.calls[1]![0];
    expect(retry.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(retry[2]!.content).toBe(JSON.stringify(badSchema)); // the model sees what it said
    expect(retry[3]!.content).toMatch(/not a valid plan[\s\S]*steps\.0\.action/);
    expect(entries.map((e) => e.stage)).toEqual(["plan", "retry"]);
    expect(entries[0]!.problems.join()).toMatch(/steps\.0\.action/);
    expect(entries[1]!.problems).toEqual([]);
  });

  it("treats a reply that is not JSON as a schema failure", async () => {
    script(reply("Sure! Here is the plan"), reply(good));
    expect(await run()).toEqual(good);
    expect(model.mock.calls[1]![0].at(-1)!.content).toContain("the reply was not valid JSON");
  });

  it("throws PlanError after a second schema failure, without a third call", async () => {
    script(reply(badSchema), reply({ title: "t", steps: [] }));
    const err = await run().catch((e) => e);
    expect(err).toBeInstanceOf(PlanError);
    expect((err as PlanError).code).toBe("PLAN_INVALID");
    expect(err.message).toMatch(/did not return a valid plan, even after a retry/);
    expect(err.problems.length).toBeGreaterThan(0);
    expect(err.log.map((e: PlanLogEntry) => e.stage)).toEqual(["plan", "retry"]);
    expect(model).toHaveBeenCalledTimes(2);
  });
});

describe("planDemo: validatePlan failure -> one re-plan", () => {
  it("lists the problems in the re-plan call and returns the fixed plan", async () => {
    script(reply(badElement), reply(good));
    const entries: PlanLogEntry[] = [];
    expect(await run((e) => entries.push(e))).toEqual(good);
    expect(model).toHaveBeenCalledTimes(2);
    const replan = model.mock.calls[1]![0];
    expect(replan.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(replan[2]!.content).toBe(JSON.stringify(badElement));
    expect(replan[3]!.content).toMatch(/does not fit the app[\s\S]*step 4: no button named "Sign in" on \/signup/);
    expect(entries.map((e) => e.stage)).toEqual(["plan", "replan"]);
    expect(entries[0]!.problems[0]).toMatch(/step 4: no button named "Sign in"/);
  });

  it("throws PlanError when the re-plan is still wrong, without a third call", async () => {
    script(reply(badElement), reply(badElement));
    const err = await run().catch((e) => e);
    expect(err).toBeInstanceOf(PlanError);
    expect(err.message).toMatch(/does not fit the app, even after a second try: step 4: no button named "Sign in"/);
    expect(err.problems).toHaveLength(1);
    expect(model).toHaveBeenCalledTimes(2);
  });

  it("throws PlanError when the re-plan is not even a valid plan", async () => {
    script(reply(badElement), reply(badSchema));
    const err = await run().catch((e) => e);
    expect(err).toBeInstanceOf(PlanError);
    expect(err.log).toHaveLength(2);
  });

  it("allows a schema retry followed by a re-plan: 3 calls at most", async () => {
    script(reply(badSchema), reply(badElement), reply(good));
    expect(await run()).toEqual(good);
    expect(model).toHaveBeenCalledTimes(3);
  });

  it("stops at 3 calls even when every one of them is wrong", async () => {
    script(reply(badSchema), reply(badElement), reply(badElement));
    await expect(run()).rejects.toBeInstanceOf(PlanError);
    expect(model).toHaveBeenCalledTimes(3);
  });

  it("does not re-plan for a warning (a redirected page is only warned about)", async () => {
    const redirected = { pages: [{ url: "/dashboard", title: "D", redirectedTo: "/login", elements: [] }, ...inventory.pages] };
    const plan = { title: "t", steps: [{ id: 1, action: "navigate", url: "/dashboard", caption: "Open it" }, { id: 2, action: "click", target: { role: "button", name: "Anything" }, caption: "Click" }] };
    script(reply(plan));
    expect(await planDemo({ brief, inventory: redirected, instructions })).toEqual(plan);
    expect(model).toHaveBeenCalledTimes(1);
  });
});

describe("planDemo: server problems", () => {
  it("lets an OllamaError through untouched (it is not a planning failure)", async () => {
    const down = new OllamaError("Ollama is not running: run ollama serve");
    model.mockRejectedValueOnce(down);
    await expect(run()).rejects.toBe(down);
  });
});

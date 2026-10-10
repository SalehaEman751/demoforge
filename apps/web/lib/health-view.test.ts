import { describe, expect, it } from "vitest";
import type { Health } from "./api";
import { fixCommands, problems, warningCopy } from "./health-view";

describe("problems", () => {
  const health: Health = {
    ok: false,
    mocks: false,
    items: [
      { id: "ollama", label: "Ollama running", ok: true },
      { id: "ffmpeg", label: "ffmpeg installed", ok: false, fix: "brew install ffmpeg" },
      { id: "chromium", label: "Chromium", ok: false },
    ],
  };
  it("lists only the red items, in order", () => {
    expect(problems(health).map((i) => i.id)).toEqual(["ffmpeg", "chromium"]);
  });
  it("is empty when everything is green or nothing is known yet", () => {
    expect(problems({ ok: true, mocks: false, items: [{ id: "a", label: "a", ok: true }] })).toEqual([]);
    expect(problems(undefined)).toEqual([]);
  });
});

describe("fixCommands", () => {
  it("returns a single command as is", () => {
    expect(fixCommands("npx playwright install chromium")).toEqual(["npx playwright install chromium"]);
  });
  it("splits the API's 'a, then b' form into separate commands", () => {
    expect(fixCommands("ollama serve, then ollama pull qwen2.5:7b-instruct")).toEqual(["ollama serve", "ollama pull qwen2.5:7b-instruct"]);
  });
  it("returns nothing for a missing or blank fix", () => {
    expect(fixCommands(undefined)).toEqual([]);
    expect(fixCommands("  ")).toEqual([]);
  });
});

describe("warningCopy", () => {
  it("warns that a real demo will likely fail", () => {
    const c = warningCopy(2, false);
    expect(c.heading).toBe("2 things need fixing before demos will work");
    expect(c.body).toMatch(/still submit/);
    expect(c.form).toMatch(/may fail/);
  });

  it("is calmer in mock mode, since the demo still runs", () => {
    const c = warningCopy(1, true);
    expect(c.heading).toBe("One thing needs fixing before a real run");
    expect(c.body).toMatch(/USE_MOCKS=1/);
    expect(c.form).toMatch(/will still run/);
  });
});

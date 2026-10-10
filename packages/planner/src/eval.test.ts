import { describe, expect, it } from "vitest";
import { PlanSchema, loadFixture } from "@demoforge/shared";
import { VARIANTS, formatResultLine, formatSummary, runEval } from "./eval.js";

const plan = loadFixture("plan.json", PlanSchema);

describe("VARIANTS", () => {
  it("are 6 distinct instructions including a vague one and a very specific one", () => {
    expect(VARIANTS).toHaveLength(6);
    expect(new Set(VARIANTS.map((v) => v.instructions)).size).toBe(6);
    const vague = VARIANTS.find((v) => v.name === "vague")!;
    const specific = VARIANTS.find((v) => v.name === "very specific")!;
    expect(vague.instructions.length).toBeLessThan(40);
    expect(specific.instructions.length).toBeGreaterThan(250);
  });
});

describe("runEval + summary", () => {
  /** Fake clock: each fake plan call "takes" the given time. */
  const setup = (outcomes: Array<{ ms: number; fail?: string; calls?: number }>) => {
    let t = 0;
    let i = 0;
    return runEval(
      VARIANTS,
      async (_instructions, onLog) => {
        const o = outcomes[i++]!;
        for (let c = 0; c < (o.calls ?? 1); c++) onLog({ stage: "plan", prompt: [], response: "", problems: [] });
        t += o.ms;
        if (o.fail) throw new Error(o.fail);
        return plan;
      },
      { now: () => t },
    );
  };

  it("counts valid plans, averages latency over all runs and lists failures with their reason", async () => {
    const results = await setup([{ ms: 10_000 }, { ms: 20_000, calls: 2 }, { ms: 30_000, fail: "step 4: no button named \"Sign in\"", calls: 3 }, { ms: 10_000 }, { ms: 5_000 }, { ms: 5_000, fail: "Ollama is not running: run ollama serve" }]);
    expect(results.map((r) => [r.ok, r.ms, r.calls])).toEqual([[true, 10_000, 1], [true, 20_000, 2], [false, 30_000, 3], [true, 10_000, 1], [true, 5_000, 1], [false, 5_000, 1]]);

    const summary = formatSummary(results);
    expect(summary).toContain("Valid-plan rate: 4/6 (67%)");
    expect(summary).toContain("Average latency: 13.3s per plan (all runs)");
    expect(summary).toContain('- very specific ("Open the sign-up page');
    expect(summary).toContain('step 4: no button named "Sign in"');
    expect(summary).toContain("- two tasks");
    expect(summary).toContain("Ollama is not running");
  });

  it("says 'Failures: none' when every plan is valid", async () => {
    const results = await setup(VARIANTS.map(() => ({ ms: 2_000 })));
    expect(formatSummary(results)).toBe("Valid-plan rate: 6/6 (100%)\nAverage latency: 2.0s per plan (all runs)\nFailures: none");
  });

  it("keeps going after a failure, runs the variants in order, and reports each result as it finishes", async () => {
    const seen: string[] = [];
    const asked: string[] = [];
    await runEval(
      VARIANTS,
      async (instructions) => {
        asked.push(instructions);
        if (asked.length === 1) throw new Error("boom");
        return plan;
      },
      { onResult: (r) => seen.push(`${r.name}:${r.ok}`) },
    );
    expect(asked).toEqual(VARIANTS.map((v) => v.instructions));
    expect(seen[0]).toBe("vague:false");
    expect(seen).toHaveLength(6);
  });

  it("turns a non-Error rejection into a readable failure", async () => {
    const [r] = await runEval([VARIANTS[0]!], async () => Promise.reject("plain string"));
    expect(r).toMatchObject({ ok: false, error: "plain string" });
  });

  it("formats one line per variant", async () => {
    const results = await setup([{ ms: 12_340 }, { ms: 31_000, fail: "x", calls: 3 }, ...VARIANTS.slice(2).map(() => ({ ms: 1_000 }))]);
    const [ok, bad] = results;
    expect(formatResultLine(ok!)).toBe("ok     12.3s  1 call   vague");
    expect(formatResultLine(bad!)).toBe("FAIL   31.0s  3 calls  default flow");
  });
});

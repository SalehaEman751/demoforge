import type { Plan } from "@demoforge/shared";
import type { PlanLogEntry } from "./plan-demo.js";

export type Variant = { name: string; instructions: string };

/** Six ways a person might ask: one vague, one very specific, and four in between. */
export const VARIANTS: Variant[] = [
  { name: "vague", instructions: "Show me what this app does." },
  { name: "default flow", instructions: "Show a new user signing up and adding their first task." },
  {
    name: "very specific",
    instructions:
      "Open the sign-up page, type demo@example.com as the email and demo1234 as the password, click Create account, " +
      "then on the dashboard type the task 'Record the demo video' into the new task box, click Add task, " +
      "and finish by confirming that 'Record the demo video' appears in the task list. Keep it to 9 steps or fewer.",
  },
  { name: "sign-up only", instructions: "Only show how a visitor creates an account." },
  { name: "landing tour", instructions: "Give a quick tour of the home page and its main call to action." },
  { name: "two tasks", instructions: "After signing up, add two different tasks and show both in the list." },
];

export type EvalResult = { name: string; instructions: string; ok: boolean; ms: number; calls: number; error?: string };

type PlanFn = (instructions: string, onLog: (entry: PlanLogEntry) => void) => Promise<Plan>;

/** Runs the variants one after another (one local model: parallel runs would distort the latency). */
export async function runEval(
  variants: Variant[],
  plan: PlanFn,
  opts: { now?: () => number; onResult?: (result: EvalResult) => void } = {},
): Promise<EvalResult[]> {
  const now = opts.now ?? (() => performance.now());
  const results: EvalResult[] = [];
  for (const v of variants) {
    let calls = 0;
    const t0 = now();
    let result: EvalResult;
    try {
      await plan(v.instructions, () => calls++);
      result = { ...v, ok: true, ms: now() - t0, calls };
    } catch (e) {
      result = { ...v, ok: false, ms: now() - t0, calls, error: e instanceof Error ? e.message : String(e) };
    }
    results.push(result);
    opts.onResult?.(result);
  }
  return results;
}

const secs = (ms: number): string => (ms / 1000).toFixed(1) + "s";

export function formatResultLine(r: EvalResult): string {
  const calls = `${r.calls} call${r.calls === 1 ? "" : "s"}`;
  return `${r.ok ? "ok  " : "FAIL"}  ${secs(r.ms).padStart(6)}  ${calls.padEnd(7)}  ${r.name}`;
}

/** Valid-plan rate (planDemo returned a plan that passed the schema and validatePlan), latency, failures. */
export function formatSummary(results: EvalResult[]): string {
  const valid = results.filter((r) => r.ok).length;
  const avg = results.length ? results.reduce((sum, r) => sum + r.ms, 0) / results.length : 0;
  const failures = results.filter((r) => !r.ok);
  return [
    `Valid-plan rate: ${valid}/${results.length} (${results.length ? Math.round((valid / results.length) * 100) : 0}%)`,
    `Average latency: ${secs(avg)} per plan (all runs)`,
    failures.length ? "Failures:" : "Failures: none",
    ...failures.map((r) => `- ${r.name} ("${r.instructions}"): ${r.error}`),
  ].join("\n");
}

import { readFileSync } from "node:fs";
import { PlanSchema, type Plan, type PlanDemoFn } from "@demoforge/shared";
import { chatJsonRaw, type ChatMessage, type PlannerErrorCode } from "./ollama.js";
import { PLAN_JSON_SCHEMA } from "./plan-schema.js";
import { buildMessages, replanMessage, schemaRetryMessage } from "./prompt.js";
import { validatePlan } from "./validate.js";

/** One model call: the exact prompt sent, the exact reply, and what was wrong with it (empty when fine). */
export type PlanLogEntry = {
  stage: "plan" | "retry" | "replan";
  prompt: ChatMessage[];
  response: string;
  problems: string[];
};

/** The model could not produce a usable plan. Server/network problems are an OllamaError instead. */
export class PlanError extends Error {
  override name = "PlanError";
  constructor(
    message: string,
    readonly problems: string[],
    readonly log: PlanLogEntry[],
    /** Always PLAN_INVALID today (the plan or the cached plan file is not usable). */
    readonly code: PlannerErrorCode = "PLAN_INVALID",
  ) {
    super(message);
  }
}

type Verdict = { kind: "ok"; plan: Plan } | { kind: "schema" | "semantic"; problems: string[] };

function judge(json: unknown, args: Parameters<PlanDemoFn>[0], baseUrl: string): Verdict {
  if (json === undefined) return { kind: "schema", problems: ["the reply was not valid JSON"] };
  const parsed = PlanSchema.safeParse(json);
  if (!parsed.success) {
    return { kind: "schema", problems: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "plan"}: ${i.message}`) };
  }
  const checked = validatePlan(parsed.data, args.inventory, baseUrl);
  return checked.ok ? { kind: "ok", plan: parsed.data } : { kind: "semantic", problems: checked.errors };
}

/** Cached-plan mode: DEMOFORGE_CACHED_PLAN=<path to a plan JSON>. Read on every call so tests and the CLI can change it. */
function cachedPlan(args: Parameters<PlanDemoFn>[0], baseUrl: string): Plan | undefined {
  const path = process.env.DEMOFORGE_CACHED_PLAN?.trim();
  if (!path) return undefined;
  const fail = (problem: string): never => {
    throw new PlanError(`Cached plan ${path} cannot be used: ${problem}. Fix the file or unset DEMOFORGE_CACHED_PLAN to plan with the model.`, [problem], [], "PLAN_INVALID");
  };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    return fail(`could not read the file (${(e as NodeJS.ErrnoException).code ?? "unknown error"})`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail("the file is not valid JSON");
  }
  const verdict = judge(json, args, baseUrl);
  return verdict.kind === "ok" ? verdict.plan : fail(verdict.problems.join("; "));
}

/**
 * Plans a demo with the local model. At most 3 model calls:
 * 1. the plan; if it fails the Plan schema, 2. one retry with the error appended;
 * then validatePlan; if that finds problems, 3. one re-plan listing them. Anything still wrong throws PlanError.
 * `onLog` gets every prompt/response pair as it happens (PlanError.log has them all too).
 * If DEMOFORGE_CACHED_PLAN is set, that file is read, validated against the inventory and returned instead, with no model call;
 * a bad file throws PlanError (it never silently falls back to the model).
 */
export async function planDemo(args: Parameters<PlanDemoFn>[0] & { onLog?: (entry: PlanLogEntry) => void }): Promise<Plan> {
  // The contract gives planDemo no baseUrl; the brief has the port. Plans should use relative urls anyway.
  const baseUrl = `http://localhost:${args.brief.port}`;
  const cached = cachedPlan(args, baseUrl);
  if (cached) return cached;
  const base = buildMessages(args);
  const log: PlanLogEntry[] = [];

  const ask = async (stage: PlanLogEntry["stage"], prompt: ChatMessage[]): Promise<{ raw: string; verdict: Verdict }> => {
    const { raw, json } = await chatJsonRaw(prompt, PLAN_JSON_SCHEMA);
    const verdict = judge(json, args, baseUrl);
    const entry: PlanLogEntry = { stage, prompt, response: raw, problems: verdict.kind === "ok" ? [] : verdict.problems };
    log.push(entry);
    args.onLog?.(entry);
    return { raw, verdict };
  };
  const followUp = (raw: string, message: string): ChatMessage[] => [...base, { role: "assistant", content: raw }, { role: "user", content: message }];

  let { raw, verdict } = await ask("plan", base);
  if (verdict.kind === "schema") ({ raw, verdict } = await ask("retry", followUp(raw, schemaRetryMessage(verdict.problems))));
  if (verdict.kind === "semantic") ({ verdict } = await ask("replan", followUp(raw, replanMessage(verdict.problems))));
  if (verdict.kind !== "ok") {
    const head = verdict.kind === "schema" ? "The model did not return a valid plan, even after a retry" : "The model's plan does not fit the app, even after a second try";
    throw new PlanError(`${head}: ${verdict.problems.join("; ")}`, verdict.problems, log, "PLAN_INVALID");
  }
  return verdict.plan;
}

import { readFileSync } from "node:fs";
import path from "node:path";
import { PlanSchema, loadFixture, type Plan } from "@demoforge/shared";
import { runPlan } from "./index.js";

/**
 * npm run demo:runner -- <baseUrl> [planPath]
 *
 * Runs the real runner (launches Chromium) against a live site, records out/demo.mp4 (or demo.webm
 * when ffmpeg is missing) and prints the RunResult as JSON on stdout. Progress goes to stderr, so
 * `... > result.json` stays clean. Defaults: plan = fixtures/plan.json, outDir = ./out.
 *
 * Relative paths are resolved from the directory you ran `npm run` in (npm sets INIT_CWD), so the
 * output lands in <repo>/out when run from the repo root.
 */
const USAGE = "usage: npm run demo:runner -- <baseUrl> [planPath]";

function fail(message: string): never {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

const [baseUrl, planPath, ...extra] = process.argv.slice(2);
if (!baseUrl || extra.length > 0) fail(baseUrl ? "too many arguments" : "missing <baseUrl>");
try {
  new URL(baseUrl);
} catch {
  fail(`not a valid url: ${baseUrl}`);
}

const cwd = process.env.INIT_CWD ?? process.cwd();
let plan: Plan;
try {
  plan = planPath
    ? PlanSchema.parse(JSON.parse(readFileSync(path.resolve(cwd, planPath), "utf8")))
    : loadFixture("plan.json", PlanSchema);
} catch (e) {
  fail(`cannot load plan${planPath ? ` ${planPath}` : ""}: ${e instanceof Error ? e.message : String(e)}`);
}

const outDir = path.resolve(cwd, "out");
const run = await runPlan({
  baseUrl,
  plan,
  outDir,
  onEvent: (e) => {
    const status = (e.data as { status?: string } | undefined)?.status;
    if (e.type === "step" && status && status !== "running") {
      console.error(`step #${e.stepId} ${status}: ${e.message ?? ""}`);
    } else if (e.type === "log") {
      console.error(`log: ${e.message ?? ""}`);
    }
  },
});

console.log(JSON.stringify(run, null, 2));
if (run.results.some((r) => r.status === "failed")) process.exitCode = 1;

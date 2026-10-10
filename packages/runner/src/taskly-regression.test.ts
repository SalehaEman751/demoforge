import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlanSchema, loadFixture, type Plan, type RepairFn } from "@demoforge/shared";
import { runPlan } from "./runner.js";

/**
 * End-to-end regression: the real runner (real chromium) against the real samples/taskly app.
 *   Case A: fixtures/plan.json on the normal app: every step ok.
 *   Case B: the same plan on the `?variant=renamed` app ("Add task" is now "Add item") with a fake
 *           repair function: exactly one step is repaired and the demo still finishes.
 * Taskly is started with `npm run dev` on port 3100, or reused when something already serves it there.
 */

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TASKLY_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../samples/taskly");
const TIMEOUT_MS = 120_000;
const SERVER_READY_MS = 100_000; // first `next dev` start plus compiling the pages
const hasFfprobe = spawnSync("ffprobe", ["-version"]).status === 0;

/** Launching headless chromium is the only reliable "is the browser installed" check. */
async function browserProblem(): Promise<string | null> {
  try {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return null;
  } catch (e) {
    return (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "unknown error";
  }
}
const problem = await browserProblem();
if (problem) {
  console.warn(
    `[taskly-regression] SKIPPED: the Playwright chromium browser is not installed or cannot start (${problem}). ` +
      "Install it with: npx playwright-core install chromium",
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function portInUse(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port: PORT, host: "127.0.0.1" });
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });
}

async function returns200(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(10_000) })).status === 200;
  } catch {
    return false;
  }
}

/** Kill npm and everything it started (npm -> sh -> next). The server runs in its own process group. */
const isWin = process.platform === "win32";

async function killTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (isWin) {
    // No process groups on Windows: taskkill /T ends npm, cmd and next together.
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  const exited = new Promise<void>((r) => child.once("exit", () => r()));
  const signal = (s: NodeJS.Signals) => {
    try {
      process.kill(-child.pid!, s);
    } catch {
      /* already gone */
    }
  };
  signal("SIGTERM");
  await Promise.race([exited, sleep(5_000)]);
  signal("SIGKILL");
}

describe.skipIf(problem !== null)("runner on Taskly (real chromium, real dev server)", () => {
  let server: ChildProcess | undefined;
  const saved = { headless: process.env.DEMOFORGE_HEADLESS, slowmo: process.env.DEMOFORGE_SLOWMO };

  beforeAll(async () => {
    process.env.DEMOFORGE_HEADLESS = "1";
    process.env.DEMOFORGE_SLOWMO = "0";

    if (await portInUse()) {
      // Reuse whatever is serving port 3100, but only if it really answers.
      if (!(await returns200(BASE_URL + "/"))) {
        throw new Error(`Port ${PORT} is in use but ${BASE_URL}/ does not return HTTP 200. Stop that process and retry.`);
      }
    } else {
      const output: string[] = [];
      let exitCode: number | null = null;
      // shell: npm is npm.cmd on Windows, which spawn cannot start without one (spawn npm ENOENT).
      const child = spawn("npm run dev", {
        cwd: TASKLY_DIR,
        shell: true,
        detached: !isWin, // own process group on macOS/Linux, so the whole tree can be killed
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      });
      server = child;
      const keep = (b: Buffer) => void output.push(b.toString());
      child.stdout?.on("data", keep);
      child.stderr?.on("data", keep);
      child.once("exit", (code) => (exitCode = code ?? -1));

      const deadline = Date.now() + SERVER_READY_MS;
      while (!(await returns200(BASE_URL + "/"))) {
        if (exitCode !== null) throw new Error(`npm run dev exited with code ${exitCode}:\n${output.join("").slice(-1500)}`);
        if (Date.now() > deadline) throw new Error(`Taskly did not return HTTP 200 within ${SERVER_READY_MS / 1000}s:\n${output.join("").slice(-1500)}`);
        await sleep(500);
      }
    }

    // `next dev` compiles each route on its first request; do that now so no step waits for a compile.
    for (const p of ["/", "/signup", "/dashboard"]) await returns200(BASE_URL + p);
  }, TIMEOUT_MS);

  afterAll(async () => {
    try {
      if (server) await killTree(server);
    } finally {
      for (const [key, value] of [["DEMOFORGE_HEADLESS", saved.headless], ["DEMOFORGE_SLOWMO", saved.slowmo]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }, 30_000);

  const plan = loadFixture("plan.json", PlanSchema);
  const outDir = () => mkdtempSync(path.join(tmpdir(), "taskly-regression-"));

  /** The video exists, is not empty, and (when ffprobe is installed) holds a decodable 1280x720 video stream. */
  function expectPlayableVideo(videoPath: string): void {
    expect(videoPath).toMatch(/demo\.(mp4|webm)$/);
    expect(statSync(videoPath).size).toBeGreaterThan(0);
    if (!hasFfprobe) return;
    const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", videoPath], { encoding: "utf8" });
    expect(probe.status, probe.stderr).toBe(0);
    expect((JSON.parse(probe.stdout) as { streams: { width: number; height: number }[] }).streams[0]).toMatchObject({ width: 1280, height: 720 });
    const decode = spawnSync("ffmpeg", ["-v", "error", "-i", videoPath, "-frames:v", "1", "-f", "null", "-"], { encoding: "utf8" });
    expect(decode.status, decode.stderr).toBe(0);
  }

  it("Case A: fixtures/plan.json runs with every step ok and records a video", async () => {
    const dir = outDir();
    const run = await runPlan({ baseUrl: BASE_URL, plan, outDir: dir });

    expect(run.results.map((r) => r.status)).toEqual(Array(plan.steps.length).fill("ok"));
    expect(run.results.every((r) => r.repairAttempts === 0)).toBe(true);
    expectPlayableVideo(run.videoPath);
    expect(existsSync(run.logPath)).toBe(true);
  }, TIMEOUT_MS);

  it("Case B: with ?variant=renamed, one step is repaired ('Add task' -> 'Add item') and the demo finishes", async () => {
    // The sample remembers ?variant=renamed for the tab session, so entering through it once is enough.
    const variantPlan: Plan = {
      ...plan,
      steps: plan.steps.map((s) => (s.id === 1 ? { ...s, url: "/signup?variant=renamed" } : s)),
    };

    const calls: Parameters<RepairFn>[0][] = [];
    const repair: RepairFn = async (args) => {
      calls.push(args);
      const target = args.step.target;
      return target?.name === "Add task" ? { ...args.step, target: { ...target, name: "Add item" } } : null;
    };

    const dir = outDir();
    const run = await runPlan({ baseUrl: BASE_URL, plan: variantPlan, outDir: dir, repair });

    const addStep = plan.steps.find((s) => s.target?.name === "Add task")!;
    expect(run.results.map((r) => r.status)).toEqual(plan.steps.map((s) => (s.id === addStep.id ? "repaired" : "ok")));
    expect(run.results.filter((r) => r.status === "repaired")).toHaveLength(1);
    expect(run.results.find((r) => r.stepId === addStep.id)).toMatchObject({ repairAttempts: 1 });
    expect(run.results.filter((r) => r.stepId !== addStep.id).every((r) => r.repairAttempts === 0)).toBe(true);

    // The repair function was asked exactly once, about the right step, and saw the renamed button.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.step.id).toBe(addStep.id);
    expect(calls[0]!.step.target).toEqual({ role: "button", name: "Add task" });
    expect(JSON.stringify(calls[0]!.inventory)).toContain("Add item");

    expect(JSON.parse(readFileSync(run.logPath, "utf8")).repairs).toEqual([
      { stepId: addStep.id, attempt: 1, step: { ...addStep, target: { role: "button", name: "Add item" } } },
    ]);
    expectPlayableVideo(run.videoPath);
  }, TIMEOUT_MS);
});

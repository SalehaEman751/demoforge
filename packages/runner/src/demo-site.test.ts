import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PlanSchema, loadFixture, type Plan, type RepairFn, type Step } from "@demoforge/shared";
import { runPlan } from "./runner.js";

/**
 * A tiny stand-in for samples/taskly, served from inside the test so no external site or dev server
 * is needed: /signup has a sign-up form, /dashboard has a task list. It uses the same labels as
 * Taskly, so fixtures/plan.json runs on it unchanged.
 */
const SIGNUP = `<!doctype html><html><head><title>Sign up</title></head><body>
<h1>Create your account</h1>
<form id="signup" novalidate>
  <label for="email">Email</label><input id="email" type="email">
  <label for="password">Password</label><input id="password" type="password">
  <button type="submit">Create account</button>
</form>
<script>
document.getElementById('signup').addEventListener('submit', function (e) {
  e.preventDefault();
  location.href = '/dashboard';
});
</script></body></html>`;

const DASHBOARD = `<!doctype html><html><head><title>Dashboard</title></head><body>
<h1>Welcome</h1>
<h2>Your tasks</h2>
<form id="add" novalidate>
  <label for="task">New task</label><input id="task" type="text">
  <button type="submit">Add task</button>
</form>
<ul id="list"></ul>
<script>
document.getElementById('add').addEventListener('submit', function (e) {
  e.preventDefault();
  var input = document.getElementById('task');
  if (!input.value) return;
  var li = document.createElement('li');
  li.textContent = input.value;
  document.getElementById('list').appendChild(li);
  input.value = '';
});
</script></body></html>`;

describe("runPlan on the local test site (real chromium)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.DEMOFORGE_HEADLESS = "1";
    process.env.DEMOFORGE_SLOWMO = "0";
    server = createServer((req, res) => {
      const pages: Record<string, string> = { "/signup": SIGNUP, "/dashboard": DASHBOARD };
      const body = pages[req.url?.split("?")[0] ?? ""];
      res.statusCode = body ? 200 : 404;
      res.setHeader("content-type", "text/html").end(body ?? "not found");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => void server.close());

  const outDir = () => mkdtempSync(path.join(tmpdir(), "demo-site-"));
  const fixturePlan = loadFixture("plan.json", PlanSchema);

  it("runs fixtures/plan.json end to end and records a video", async () => {
    const dir = outDir();
    const run = await runPlan({ baseUrl, plan: fixturePlan, outDir: dir });

    expect(run.results.map((r) => r.status)).toEqual(Array(fixturePlan.steps.length).fill("ok"));
    expect(run.videoPath).toMatch(/demo\.(mp4|webm)$/);
    expect(statSync(run.videoPath).size).toBeGreaterThan(0);
    expect(existsSync(run.logPath)).toBe(true);
  }, 60_000);

  it("brings a deliberately wrong step back as 'repaired' via the fake repair function", async () => {
    // Step 4 clicks a "Sign up" button; the page only has "Create account".
    const wrongPlan: Plan = {
      ...fixturePlan,
      steps: fixturePlan.steps.map((s) => (s.id === 4 ? { ...s, target: { role: "button", name: "Sign up" } } : s)),
    };
    const fixed: Step = { ...wrongPlan.steps[3]!, target: { role: "button", name: "Create account" } };

    const calls: Array<{ step: Step; error: string; inventory: unknown; baseUrl: string }> = [];
    const repair: RepairFn = async (args) => {
      calls.push(args);
      return fixed;
    };
    const step4: string[] = [];

    const dir = outDir();
    const run = await runPlan({
      baseUrl,
      plan: wrongPlan,
      outDir: dir,
      repair,
      onEvent: (e) => {
        if (e.type === "step" && e.stepId === 4) step4.push((e.data as { status: string }).status);
      },
    });

    // Only step 4 needed help, and the rest of the demo still ran.
    expect(run.results.map((r) => r.status)).toEqual(["ok", "ok", "ok", "repaired", "ok", "ok", "ok", "ok"]);
    expect(run.results[3]).toMatchObject({ stepId: 4, repairAttempts: 1 });
    expect(run.results[3]!.error).toBeUndefined();
    expect(step4).toEqual(["running", "repaired"]);

    // The repair function saw the failing step, the error, and what is really on the page.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.step.target).toEqual({ role: "button", name: "Sign up" });
    expect(calls[0]!.error).toMatch(/Sign up|Timeout/);
    expect(calls[0]!.baseUrl).toBe(baseUrl);
    expect(JSON.stringify(calls[0]!.inventory)).toContain("Create account");

    // The repaired step is saved in the log, and the video exists.
    expect(JSON.parse(readFileSync(run.logPath, "utf8")).repairs).toEqual([{ stepId: 4, attempt: 1, step: fixed }]);
    expect(statSync(run.videoPath).size).toBeGreaterThan(0);
  }, 60_000);
});

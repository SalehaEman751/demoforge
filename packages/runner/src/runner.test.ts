import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ElementInventorySchema, type Plan } from "@demoforge/shared";
import { resolveUrl } from "./actions.js";
import { convertToMp4 } from "./recording.js";
import { runPlan } from "./runner.js";

/** `JobEvent.data` is `unknown` in the contract; step events carry `{ status, error? }`. */
const statusOf = (e: { data?: unknown }): string | undefined => (e.data as { status?: string } | undefined)?.status;

const hasFfmpeg = ["ffmpeg", "ffprobe"].every((b) => spawnSync(b, ["-version"]).status === 0);

function probe(file: string, entries: string): Record<string, string> {
  const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", entries, "-of", "default=nw=1", file], { encoding: "utf8" });
  // ffprobe ends lines with \r\n on Windows, so split on either and trim each value.
  return Object.fromEntries(out.trim().split(/\r?\n/).map((l) => l.split("=").map((v) => v.trim()) as [string, string]));
}

const PAGE = `<!doctype html><html><body>
<h1>Test page</h1>
<label for="n">Name</label><input id="n" type="text">
<label for="p">Secret</label><input id="p" type="password">
<button onclick="document.getElementById('out').textContent='Hello '+document.getElementById('n').value">Greet</button>
<p id="out"></p><div style="height:3000px"></div></body></html>`;

describe("resolveUrl", () => {
  it("resolves relative urls against the base", () => {
    expect(resolveUrl("/signup", "http://localhost:3100")).toBe("http://localhost:3100/signup");
    expect(resolveUrl("http://localhost:3100/x", "http://localhost:3100")).toBe("http://localhost:3100/x");
  });
  it("refuses other origins", () => {
    expect(() => resolveUrl("https://evil.example/", "http://localhost:3100")).toThrow(/Refusing/);
    expect(() => resolveUrl("http://localhost:3101/", "http://localhost:3100")).toThrow(/Refusing/);
  });
});

describe("runPlan (real chromium, local page)", () => {
  let server: Server;
  let baseUrl: string;
  beforeAll(async () => {
    process.env.DEMOFORGE_HEADLESS = "1";
    process.env.DEMOFORGE_SLOWMO = "0";
    server = createServer((_, res) => res.setHeader("content-type", "text/html").end(PAGE));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => void server.close());

  const outDir = () => mkdtempSync(path.join(tmpdir(), "runner-"));

  it("runs every action and records a video and log", async () => {
    const plan: Plan = {
      title: "all actions",
      steps: [
        { id: 1, action: "navigate", url: "/", caption: "open" },
        { id: 2, action: "fill", target: { role: "textbox", name: "Name" }, value: "Ada", caption: "name" },
        { id: 3, action: "fill", target: { role: "textbox", name: "Secret" }, value: "pw", caption: "password falls back to label" },
        { id: 4, action: "click", target: { role: "button", name: "Greet" }, caption: "greet" },
        { id: 5, action: "assert_text", text: "Hello Ada", caption: "assert" },
        { id: 6, action: "scroll", caption: "scroll" },
        { id: 7, action: "wait", ms: 99999, caption: "wait is capped" },
      ],
    };
    const dir = outDir();
    const events: string[] = [];
    const run = await runPlan({ baseUrl, plan, outDir: dir, onEvent: (e) => events.push(e.type) });
    expect(run.results.map((r) => r.status)).toEqual(Array(7).fill("ok"));
    expect(run.results[6]!.durationMs).toBeLessThan(7000); // 5s cap + 600ms pause
    // Without ffmpeg on PATH the runner keeps the webm (see "keeps the webm ... when ffmpeg is missing").
    expect(run.videoPath).toBe(path.join(dir, hasFfmpeg ? "demo.mp4" : "demo.webm"));
    expect(statSync(run.videoPath).size).toBeGreaterThan(0);
    expect(run.logPath).toBe(path.join(dir, "run-log.json"));
    expect(readFileSync(path.join(dir, "run.log"), "utf8")).toContain("step #7 ok");
    expect(events).toContain("done");
    expect(run.finishedAt).toBeGreaterThanOrEqual(run.startedAt);
    const log = JSON.parse(readFileSync(run.logPath, "utf8"));
    expect(log.plan).toEqual(plan);
    expect(log.results).toEqual(run.results);
  }, 60_000);

  it.skipIf(!hasFfmpeg)("writes a 1280x720 yuv420p h264 mp4 with the moov atom up front", async () => {
    const plan: Plan = { title: "mp4", steps: [{ id: 1, action: "navigate", url: "/", caption: "open" }] };
    const run = await runPlan({ baseUrl, plan, outDir: outDir() });
    expect(run.videoPath.endsWith("demo.mp4")).toBe(true);
    expect(probe(run.videoPath, "stream=codec_name,pix_fmt,width,height")).toEqual({
      codec_name: "h264",
      pix_fmt: "yuv420p",
      width: "1280",
      height: "720",
    });
    const head = readFileSync(run.videoPath).subarray(0, 64 * 1024).toString("latin1");
    expect(head.indexOf("moov")).toBeGreaterThan(-1);
    expect(head.indexOf("moov")).toBeLessThan(head.includes("mdat") ? head.indexOf("mdat") : Infinity);
  }, 60_000);

  it("keeps the webm and still writes the logs when ffmpeg is missing", async () => {
    const plan: Plan = { title: "no ffmpeg", steps: [{ id: 1, action: "navigate", url: "/", caption: "open" }] };
    const dir = outDir();
    const events: string[] = [];
    const savedPath = process.env.PATH;
    process.env.PATH = path.join(dir, "empty-bin");
    let run;
    try {
      run = await runPlan({ baseUrl, plan, outDir: dir, onEvent: (e) => events.push(e.message ?? "") });
    } finally {
      process.env.PATH = savedPath;
    }
    expect(run.videoPath).toBe(path.join(dir, "demo.webm"));
    expect(statSync(run.videoPath).size).toBeGreaterThan(0);
    expect(existsSync(path.join(dir, "demo.mp4"))).toBe(false);
    expect(events.some((m) => m.includes("ffmpeg not found"))).toBe(true);
    expect(JSON.parse(readFileSync(run.logPath, "utf8")).results).toHaveLength(1);
  }, 60_000);

  it("still flushes the video when the run throws unexpectedly", async () => {
    const plan: Plan = {
      title: "throws",
      steps: [
        { id: 1, action: "navigate", url: "/", caption: "open" },
        { id: 2, action: "scroll", caption: "boom" },
      ],
    };
    const dir = outDir();
    const onEvent = (e: { message?: string; data?: unknown }) => {
      if (statusOf(e) === "running" && e.message === "boom") throw new Error("listener exploded");
    };
    await expect(runPlan({ baseUrl, plan, outDir: dir, onEvent })).rejects.toThrow("listener exploded");
    const webms = readdirSync(dir).filter((f) => f.endsWith(".webm"));
    expect(webms).toHaveLength(1);
    expect(statSync(path.join(dir, webms[0]!)).size).toBeGreaterThan(0);
  }, 60_000);

  it("fails a missing target and carries on with the next step", async () => {
    const plan: Plan = {
      title: "missing",
      steps: [
        { id: 1, action: "navigate", url: "/", caption: "open" },
        { id: 2, action: "click", target: { role: "button", name: "Add item" }, caption: "gone" },
        { id: 3, action: "scroll", caption: "still runs" },
      ],
    };
    const run = await runPlan({ baseUrl, plan, outDir: outDir() });
    expect(run.results.map((r) => r.status)).toEqual(["ok", "failed", "ok"]);
    expect(run.results[1]!.error).toBeTruthy();
    expect(run.results[1]!.repairAttempts).toBe(0);
    expect(run.results[1]!.durationMs).toBeLessThan(10_000);
    // A failed step must not lose the recording or the log.
    expect(statSync(run.videoPath).size).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(run.logPath, "utf8")).results.map((r: { status: string }) => r.status)).toEqual(["ok", "failed", "ok"]);
  }, 60_000);

  it("stops and skips the rest when a navigate step fails", async () => {
    const plan: Plan = {
      title: "nav fails",
      steps: [
        { id: 1, action: "navigate", url: "/", caption: "open" },
        { id: 2, action: "navigate", url: "https://example.com/", caption: "off-site" },
        { id: 3, action: "scroll", caption: "never runs" },
        { id: 4, action: "scroll", caption: "never runs either" },
      ],
    };
    const events: Array<{ stepId?: number; status?: string }> = [];
    const run = await runPlan({ baseUrl, plan, outDir: outDir(), onEvent: (e) => e.type === "step" && events.push({ stepId: e.stepId, status: statusOf(e) as string }) });
    expect(run.results.map((r) => r.status)).toEqual(["ok", "failed", "skipped", "skipped"]);
    expect(events.filter((e) => e.stepId === 3)).toEqual([{ stepId: 3, status: "skipped" }]); // no "running" for skipped steps
  }, 60_000);

  it("refuses to navigate to another origin", async () => {
    const plan: Plan = {
      title: "origin",
      steps: [{ id: 1, action: "navigate", url: "https://example.com/", caption: "off-site" }],
    };
    const run = await runPlan({ baseUrl, plan, outDir: outDir() });
    expect(run.results[0]!.status).toBe("failed");
    expect(run.results[0]!.error).toMatch(/Refusing/);
  }, 60_000);
});

describe("step events and repair hook (real chromium, local page)", () => {
  type Step = Plan["steps"][number];
  let server: Server;
  let baseUrl: string;
  beforeAll(async () => {
    process.env.DEMOFORGE_HEADLESS = "1";
    process.env.DEMOFORGE_SLOWMO = "0";
    server = createServer((_, res) => res.setHeader("content-type", "text/html").end(PAGE));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => void server.close());

  const outDir = () => mkdtempSync(path.join(tmpdir(), "repair-"));
  const open: Step = { id: 1, action: "navigate", url: "/", caption: "open" };
  const badClick: Step = { id: 2, action: "click", target: { role: "button", name: "Add item" }, caption: "click the wrong thing" };
  const greet: Step = { ...badClick, target: { role: "button", name: "Greet" } } as Step;
  const scroll: Step = { id: 3, action: "scroll", caption: "scroll" };

  it("emits running then the final status for every step, with the caption as message", async () => {
    const plan: Plan = { title: "events", steps: [open, { id: 2, action: "click", target: { role: "button", name: "Greet" }, caption: "greet" }] };
    const seen: Array<[number | undefined, string | undefined, string | undefined]> = [];
    await runPlan({ baseUrl, plan, outDir: outDir(), onEvent: (e) => e.type === "step" && seen.push([e.stepId, e.message, statusOf(e) as string]) });
    expect(seen).toEqual([
      [1, "open", "running"],
      [1, "open", "ok"],
      [2, "greet", "running"],
      [2, "greet", "ok"],
    ]);
  }, 60_000);

  it("repairs a failed step from a live inventory and reports 'repaired'", async () => {
    const calls: Array<{ step: Step; error: string; baseUrl: string; inventory: any }> = [];
    const repair = async (ctx: any) => (calls.push(ctx), greet);
    const finals: Array<string | undefined> = [];
    const run = await runPlan({
      baseUrl,
      plan: { title: "repair", steps: [open, badClick, { id: 3, action: "assert_text", text: "Hello", caption: "assert" }] },
      outDir: outDir(),
      repair,
      onEvent: (e) => e.type === "step" && e.stepId === 2 && finals.push(statusOf(e) as string),
    });
    expect(run.results.map((r) => [r.status, r.repairAttempts])).toEqual([["ok", 0], ["repaired", 1], ["ok", 0]]);
    expect(run.results[1]!.error).toBeUndefined();
    expect(finals).toEqual(["running", "repaired"]);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.step).toEqual(badClick);
    expect(calls[0]!.baseUrl).toBe(baseUrl);
    expect(calls[0]!.error).toMatch(/Add item|Timeout/);
    const inv = ElementInventorySchema.parse(calls[0]!.inventory); // the shared contract shape, no cast needed
    expect(inv.pages).toHaveLength(1);
    expect(inv.pages[0]!.url).toBe(baseUrl + "/");
    expect(inv.pages[0]!.elements).toEqual(
      expect.arrayContaining([
        { role: "heading", name: "Test page" },
        { role: "textbox", name: "Name" },
        { role: "textbox", name: "Secret" }, // password input: no ARIA role, reported as textbox (label is the handle)
        { role: "button", name: "Greet" },
      ]),
    );
    expect(JSON.stringify(inv)).not.toContain("pw"); // input values are never read
    expect(JSON.parse(readFileSync(run.logPath, "utf8")).repairs).toEqual([{ stepId: 2, attempt: 1, step: greet }]);
  }, 60_000);

  it("gives up after 2 repair attempts, marks the step failed, and still runs the next step", async () => {
    let calls = 0;
    const repair = async () => (calls++, { ...badClick, caption: `try ${calls}` } as Step);
    const run = await runPlan({ baseUrl, plan: { title: "cap", steps: [open, badClick, scroll] }, outDir: outDir(), repair });
    expect(calls).toBe(2);
    expect(run.results.map((r) => [r.status, r.repairAttempts])).toEqual([["ok", 0], ["failed", 2], ["ok", 0]]);
    expect(run.results[1]!.error).toBeTruthy();
  }, 60_000);

  it("passes the previous repair to the next attempt and can succeed on the second", async () => {
    const seen: Step[] = [];
    const repair = async ({ step }: { step: Step }) => (seen.push(step), seen.length === 1 ? ({ ...badClick, caption: "still wrong" } as Step) : greet);
    const run = await runPlan({ baseUrl, plan: { title: "second", steps: [open, badClick] }, outDir: outDir(), repair });
    expect(seen.map((s) => s.caption)).toEqual([badClick.caption, "still wrong"]);
    expect(run.results[1]).toMatchObject({ status: "repaired", repairAttempts: 2 });
  }, 60_000);

  it("a repair that returns nothing, returns junk or throws leaves the step failed without crashing the run", async () => {
    for (const repair of [async () => null, async () => ({ nonsense: true }) as unknown as Step, async () => { throw new Error("llm down"); }]) {
      const events: string[] = [];
      const run = await runPlan({ baseUrl, plan: { title: "none", steps: [open, badClick, scroll] }, outDir: outDir(), repair, onEvent: (e) => events.push(e.message ?? "") });
      expect(run.results.map((r) => r.status)).toEqual(["ok", "failed", "ok"]);
      expect(run.results[1]!.repairAttempts).toBe(1); // no retry loop on a dead hook
      expect(events.some((m) => /repair (returned|hook failed)/.test(m))).toBe(true);
    }
  }, 120_000);

  it("a navigate step that cannot be repaired stops the run and skips the rest", async () => {
    const badNav: Step = { id: 1, action: "navigate", url: "https://example.com/", caption: "off-site" };
    let calls = 0;
    const repair = async () => (calls++, badNav);
    const run = await runPlan({ baseUrl, plan: { title: "nav", steps: [badNav, { ...scroll, id: 2 } as Step, scroll] }, outDir: outDir(), repair });
    expect(calls).toBe(2);
    expect(run.results.map((r) => r.status)).toEqual(["failed", "skipped", "skipped"]);
    expect(run.results[0]!.error).toMatch(/Refusing/);
  }, 60_000);

  it("without a repair hook a failure is just 'failed' with 0 attempts", async () => {
    const run = await runPlan({ baseUrl, plan: { title: "no hook", steps: [open, badClick] }, outDir: outDir() });
    expect(run.results[1]).toMatchObject({ status: "failed", repairAttempts: 0 });
  }, 60_000);
});

describe("off-site navigation guard (A4, real chromium, local page)", () => {
  let app: Server;
  let other: Server;
  let baseUrl: string;
  let otherHits = 0;
  beforeAll(async () => {
    process.env.DEMOFORGE_HEADLESS = "1";
    process.env.DEMOFORGE_SLOWMO = "0";
    other = createServer((_, res) => {
      otherHits++;
      res.setHeader("content-type", "text/html").end("<h1>Another website</h1>");
    });
    await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
    const otherUrl = `http://localhost:${(other.address() as AddressInfo).port}`; // other host and port: another origin
    app = createServer((req, res) => {
      if (req.url === "/out") return void res.writeHead(302, { location: `${otherUrl}/landing` }).end();
      res.setHeader("content-type", "text/html").end(`<!doctype html><html><body>
<h1>App home</h1>
<a href="${otherUrl}/landing">Partner site</a>
<a href="/out">Leave via redirect</a>
<label for="n">Name</label><input id="n" type="text">
<button onclick="document.getElementById('out').textContent='Hello '+document.getElementById('n').value">Greet</button>
<p id="out"></p></body></html>`);
    });
    await new Promise<void>((r) => app.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    app.close();
    other.close();
  });

  const steps = (leave: string): Plan => ({
    title: "leave the app",
    steps: [
      { id: 1, action: "navigate", url: "/", caption: "open" },
      { id: 2, action: "click", target: { role: "link", name: leave }, caption: "leave" },
      { id: 3, action: "assert_text", text: "App home", caption: "still on the app" },
      { id: 4, action: "fill", target: { role: "textbox", name: "Name" }, value: "Ada", caption: "name" },
      { id: 5, action: "click", target: { role: "button", name: "Greet" }, caption: "greet" },
      { id: 6, action: "assert_text", text: "Hello Ada", caption: "greeted" },
    ],
  });

  it("a click on an off-site link fails with 'blocked off-site navigation to <host>', stays on the app, and the run goes on", async () => {
    otherHits = 0;
    const repairCalls: number[] = [];
    const dir = mkdtempSync(path.join(tmpdir(), "runner-offsite-"));
    const run = await runPlan({
      baseUrl,
      plan: steps("Partner site"),
      outDir: dir,
      repair: async ({ step }) => (repairCalls.push(step.id), step),
    });
    const host = `localhost:${(other.address() as AddressInfo).port}`;
    expect(run.results[1]).toMatchObject({ stepId: 2, status: "failed", error: `blocked off-site navigation to ${host}`, repairAttempts: 0 });
    expect(run.results.map((r) => r.status)).toEqual(["ok", "failed", "ok", "ok", "ok", "ok"]); // step 3 proves the page stayed
    expect(repairCalls).toEqual([]); // not a broken target: repair is not asked
    expect(otherHits).toBe(0); // the other site never saw a request
  }, 60_000);

  it("a same-origin link that redirects off-site is caught too, and the page comes back to the app", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "runner-offsite-"));
    otherHits = 0;
    const run = await runPlan({ baseUrl, plan: steps("Leave via redirect"), outDir: dir });
    // Known limit: Chromium follows a redirect without asking the route, so the other site gets this one GET;
    // the runner then sees the page off the app, fails the step and goes back.
    expect(otherHits).toBe(1);
    expect(run.results[1]).toMatchObject({ stepId: 2, status: "failed" });
    expect(run.results[1]!.error).toMatch(/^blocked off-site navigation to localhost:\d+$/);
    expect(run.results.slice(2).map((r) => r.status)).toEqual(["ok", "ok", "ok", "ok"]);
  }, 60_000);
});

describe("convertToMp4", () => {
  const tmp = () => mkdtempSync(path.join(tmpdir(), "convert-"));

  it("reports a missing ffmpeg without throwing", async () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "in.webm"), "not empty");
    const res = await convertToMp4(path.join(dir, "in.webm"), path.join(dir, "out.mp4"), "ffmpeg-does-not-exist");
    expect(res).toEqual({ ok: false, reason: "ffmpeg not found" });
    expect(existsSync(path.join(dir, "out.mp4"))).toBe(false);
  });

  it.skipIf(!hasFfmpeg)("fails cleanly on a corrupt input and leaves no partial mp4", async () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "in.webm"), "this is not a video");
    const res = await convertToMp4(path.join(dir, "in.webm"), path.join(dir, "out.mp4"));
    expect(res.ok).toBe(false);
    expect(existsSync(path.join(dir, "out.mp4"))).toBe(false);
  });

  it("fails when there is no recording", async () => {
    const dir = tmp();
    const res = await convertToMp4(path.join(dir, "missing.webm"), path.join(dir, "out.mp4"));
    expect(res.ok).toBe(false);
  });

  it.skipIf(!hasFfmpeg)("holds the final frame for 1.5s", async () => {
    const dir = tmp();
    const src = path.join(dir, "in.webm");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=25:duration=2", "-c:v", "libvpx", "-b:v", "1M", src]);
    const res = await convertToMp4(src, path.join(dir, "out.mp4"));
    expect(res.ok).toBe(true);
    const duration = Number(probe(path.join(dir, "out.mp4"), "format=duration").duration);
    expect(duration).toBeGreaterThan(3.4);
    expect(duration).toBeLessThan(3.7);
  });
});

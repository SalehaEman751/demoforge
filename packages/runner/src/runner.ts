import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page, Video } from "playwright-core";
import {
  PlanSchema,
  StepSchema,
  type JobEvent,
  type Plan,
  type RunPlanFn,
  type RunResult,
  type StepResult,
} from "@demoforge/shared";
import { STEP_TIMEOUT_MS, performStep } from "./actions.js";
import { buildInventory, toElementInventory } from "./inventory.js";
import { installOverlay, setCaption } from "./overlay.js";
import { convertToMp4 } from "./recording.js";

const VIEWPORT = { width: 1280, height: 720 };
const DEFAULT_SLOWMO_MS = 450;
const PAUSE_AFTER_STEP_MS = 600;
const NETWORK_IDLE_MS = 2000;
const MAX_REPAIR_ATTEMPTS = 2;

type Step = Plan["steps"][number];

function slowMo(): number {
  const n = Number(process.env.DEMOFORGE_SLOWMO);
  return process.env.DEMOFORGE_SLOWMO && Number.isFinite(n) && n >= 0 ? n : DEFAULT_SLOWMO_MS;
}

/** The step error for a click (or redirect) that tried to leave the app. Repair is not tried for it. */
export const OFFSITE_PREFIX = "blocked off-site navigation to";

/** First line of the error, plus the "waiting for <locator>" line Playwright logs (useful to repair). */
function message(e: unknown): string {
  const plain = (e instanceof Error ? e.message : String(e)).replace(/\u001b\[[0-9;]*m/g, "");
  const lines = plain.split("\n").map((l) => l.trim());
  const waiting = lines.find((l) => l.startsWith("- waiting for"));
  return [lines[0] ?? "", waiting ? waiting.replace(/^- /, "") : ""].filter(Boolean).join(" ");
}

export const runPlan: RunPlanFn = async ({ baseUrl, plan: rawPlan, outDir, onEvent, repair }) => {
  const plan = PlanSchema.parse(rawPlan);
  const appOrigin = new URL(baseUrl).origin; // throws on an invalid base url

  await mkdir(outDir, { recursive: true });
  const webmPath = path.join(outDir, "demo.webm");
  const mp4Path = path.join(outDir, "demo.mp4");
  const logPath = path.join(outDir, "run-log.json"); // plan + step results
  const eventLogPath = path.join(outDir, "run.log"); // human-readable event trail
  const lines: string[] = [];
  const emit = (event: JobEvent): void => {
    const status = (event as { data?: { status?: string } }).data?.status;
    lines.push(`${new Date().toISOString()} ${event.type}${event.stepId ? ` #${event.stepId}` : ""}${status ? ` ${status}` : ""} ${event.message ?? ""}`.trim());
    onEvent?.(event);
  };

  const startedAt = Date.now();
  const results: StepResult[] = [];
  const repairs: { stepId: number; attempt: number; step: Step }[] = []; // persisted in run-log.json
  // Loaded on first use so importing the package (index.ts, the mock) never requires Playwright.
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({
    headless: process.env.DEMOFORGE_HEADLESS === "1",
    slowMo: slowMo(),
  });
  try {
    let context: BrowserContext | undefined;
    let video: Video | null = null;
    try {
      context = await browser.newContext({
        viewport: VIEWPORT,
        recordVideo: { dir: outDir, size: VIEWPORT },
      });
      context.setDefaultTimeout(STEP_TIMEOUT_MS);
      context.setDefaultNavigationTimeout(STEP_TIMEOUT_MS);
      // Never leave the app: a top-level document navigation to another origin (a click on an off-site link, a form
      // posting elsewhere, a popup) is aborted and recorded; the step then fails. Only cross-origin http(s) requests
      // are routed at all; their subresources (CDN scripts, fonts, images) continue. data:/blob: are never routed.
      const offsite: string[] = [];
      await context.route(
        (url) => /^https?:$/.test(url.protocol) && url.origin !== appOrigin,
        (route) => {
          const req = route.request();
          let topLevel = false;
          try {
            topLevel = req.isNavigationRequest() && req.frame().parentFrame() === null;
          } catch {
            // service-worker requests have no frame: not a page navigation
          }
          if (!topLevel) return route.continue();
          offsite.push(new URL(req.url()).host);
          return route.abort("blockedbyclient");
        },
      );
      await installOverlay(context); // before the first page, so every document gets it
      const page = await context.newPage();
      video = page.video();

      const onApp = (url: string): boolean => {
        try {
          return new URL(url).origin === appOrigin;
        } catch {
          return false;
        }
      };
      /** After a blocked navigation: make sure the recording shows the app again (error page or slipped redirect). */
      const backToApp = async (page: Page, lastOnApp: string | null): Promise<void> => {
        if (onApp(page.url())) return;
        await page.goBack({ timeout: STEP_TIMEOUT_MS }).catch(() => null);
        if (!onApp(page.url()) && lastOnApp) await page.goto(lastOnApp, { timeout: STEP_TIMEOUT_MS }).catch(() => {});
      };

      /** Runs one step; returns null on success, else the (short) error message. */
      const attempt = async (page: Page, s: Step): Promise<string | null> => {
        await setCaption(page, s.caption);
        offsite.length = 0;
        const lastOnApp = onApp(page.url()) ? page.url() : null;
        let error: string | null = null;
        try {
          await performStep(page, s, baseUrl);
          await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_MS }).catch(() => {});
          await page.waitForTimeout(PAUSE_AFTER_STEP_MS);
        } catch (e) {
          error = message(e);
        }
        // Safety net: a same-origin URL that redirected off-site is followed by Chromium without asking the route.
        const here = page.url();
        if (offsite.length === 0 && /^https?:/.test(here) && !onApp(here)) offsite.push(new URL(here).host);
        if (offsite.length > 0) {
          await backToApp(page, lastOnApp);
          return `${OFFSITE_PREFIX} ${offsite[0]}`;
        }
        return error;
      };

      let stopped = false; // set when a navigate step fails: nothing after it can work
      for (const step of plan.steps) {
        if (stopped) {
          results.push({ stepId: step.id, status: "skipped", durationMs: 0, repairAttempts: 0 });
          emit({ type: "step", stepId: step.id, message: step.caption, data: { status: "skipped" } });
          continue;
        }
        emit({ type: "step", stepId: step.id, message: step.caption, data: { status: "running" } });
        const t0 = Date.now();

        let current = step;
        let error = await attempt(page, current);
        let attempts = 0;
        // A blocked off-site navigation is not a broken target, so repair is not asked to fix it.
        while (error !== null && repair && !error.startsWith(OFFSITE_PREFIX) && attempts < MAX_REPAIR_ATTEMPTS) {
          attempts++;
          emit({ type: "log", stepId: step.id, message: `repair attempt ${attempts}/${MAX_REPAIR_ATTEMPTS}: ${error}` });
          let next: Step | null = null;
          let note = "";
          try {
            const inventory = toElementInventory(await buildInventory(page));
            const proposed = await repair({ step: current, error, inventory, baseUrl });
            if (proposed) {
              const candidate = { ...proposed, id: step.id } as Step; // a repair never renumbers the step
              if (StepSchema.safeParse(candidate).success) next = candidate; // not PlanSchema: a lone step 4 breaks its 1..n id rule
              else note = "repair returned an invalid step";
            } else {
              note = "repair returned no step";
            }
          } catch (e) {
            note = `repair hook failed: ${message(e)}`;
          }
          if (note) emit({ type: "log", stepId: step.id, message: note });
          if (!next) break;
          current = next;
          repairs.push({ stepId: step.id, attempt: attempts, step: next });
          error = await attempt(page, current);
        }

        const status = error !== null ? "failed" : attempts > 0 ? "repaired" : "ok";
        const durationMs = Date.now() - t0;
        results.push(
          error !== null
            ? { stepId: step.id, status, error, durationMs, repairAttempts: attempts }
            : { stepId: step.id, status, durationMs, repairAttempts: attempts },
        );
        emit({ type: "step", stepId: step.id, message: step.caption, data: error !== null ? { status, error } : { status } });

        if (error !== null && (step.action === "navigate" || current.action === "navigate")) {
          stopped = true;
          emit({ type: "log", stepId: step.id, message: "navigation failed: skipping the remaining steps" });
        }
      }
    } finally {
      // Closing the context is what flushes the video to disk, so it must happen even if a step threw.
      await context?.close().catch((e) => emit({ type: "log", message: `context close failed: ${message(e)}` }));
    }

    try {
      await video?.saveAs(webmPath);
      await video?.delete().catch(() => {}); // drop the randomly named original
    } catch (e) {
      // e.g. the run failed before anything was painted: keep the step results anyway
      emit({ type: "log", message: `video not saved: ${message(e)}` });
    }
  } finally {
    await browser.close();
  }

  // Prefer the mp4; if ffmpeg is missing or fails, hand back the webm instead.
  let videoPath = webmPath;
  const converted = await convertToMp4(webmPath, mp4Path);
  if (converted.ok) {
    videoPath = mp4Path;
  } else {
    emit({ type: "log", message: `mp4 not produced, keeping webm: ${converted.reason}` });
  }

  const finishedAt = Date.now();
  emit({ type: "done", message: `${results.filter((r) => r.status === "ok").length}/${plan.steps.length} steps ok` });
  await writeFile(eventLogPath, lines.join("\n") + "\n");
  await writeFile(logPath, JSON.stringify({ plan, results, repairs }, null, 2) + "\n");
  const run: RunResult = { videoPath, logPath, results, startedAt, finishedAt };
  return run;
};

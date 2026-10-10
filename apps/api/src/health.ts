import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { z } from "zod";

export type HealthItem = {
  id: "ollama" | "model" | "ffmpeg" | "chromium";
  label: string;
  ok: boolean;
  /** What was found (version, error, ...). */
  detail: string;
  /** Command that fixes a failed check. */
  fix?: string;
};
/** `mocks` is set by the server: true when it runs with USE_MOCKS=1 (then Ollama and the model are not used). */
export type HealthReport = { ok: boolean; items: HealthItem[]; mocks?: boolean };

export type HealthDeps = {
  ollamaUrl: string;
  model: string;
  fetch: typeof fetch;
  /** Runs `ffmpeg -version`; resolves with stdout, rejects when it fails. */
  ffmpegVersion: () => Promise<string>;
  /** Path where Playwright expects its Chromium build. */
  chromiumPath: () => Promise<string>;
  fileExists: (path: string) => boolean;
  platform: NodeJS.Platform;
  timeoutMs: number;
};

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Ollama's GET /api/tags response; only the model names matter. */
const TagsSchema = z.object({ models: z.array(z.object({ name: z.string() }).passthrough()).default([]) });

/** "qwen2.5:7b-instruct" matches itself; a bare "llama3" also matches "llama3:latest". */
export const hasModel = (names: string[], model: string): boolean => {
  const want = model.includes(":") ? model : `${model}:latest`;
  return names.some((n) => n === model || n === want);
};

const ffmpegFix = (platform: NodeJS.Platform): string =>
  platform === "darwin" ? "brew install ffmpeg" : platform === "win32" ? "winget install ffmpeg" : "sudo apt install ffmpeg";

export const defaultHealthDeps = (): HealthDeps => ({
  ollamaUrl: (process.env.DEMOFORGE_OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, ""),
  model: process.env.DEMOFORGE_MODEL || "qwen2.5:7b-instruct",
  fetch: globalThis.fetch,
  ffmpegVersion: () =>
    new Promise((resolve, reject) => {
      execFile("ffmpeg", ["-version"], { timeout: 5000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    }),
  chromiumPath: async () => {
    // Same Playwright build the runner uses.
    const { chromium } = await import("playwright-core");
    return chromium.executablePath();
  },
  fileExists: existsSync,
  platform: process.platform,
  timeoutMs: 3000,
});

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });

async function checkOllama(d: HealthDeps): Promise<HealthItem[]> {
  const pull = `ollama pull ${d.model}`;
  let names: string[];
  try {
    const res = await withTimeout(d.fetch(`${d.ollamaUrl}/api/tags`), d.timeoutMs, "Ollama");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    names = TagsSchema.parse(await res.json()).models.map((m) => m.name);
  } catch (e) {
    return [
      { id: "ollama", label: "Ollama running", ok: false, detail: `Not reachable at ${d.ollamaUrl}: ${errText(e)}`, fix: "ollama serve" },
      { id: "model", label: `Model ${d.model}`, ok: false, detail: "Cannot check until Ollama is running", fix: `ollama serve, then ${pull}` },
    ];
  }
  const pulled = hasModel(names, d.model);
  return [
    { id: "ollama", label: "Ollama running", ok: true, detail: `Reachable at ${d.ollamaUrl}` },
    pulled
      ? { id: "model", label: `Model ${d.model}`, ok: true, detail: "Pulled" }
      : { id: "model", label: `Model ${d.model}`, ok: false, detail: "Not pulled yet", fix: pull },
  ];
}

async function checkFfmpeg(d: HealthDeps): Promise<HealthItem> {
  const label = "ffmpeg installed";
  try {
    const out = await withTimeout(d.ffmpegVersion(), d.timeoutMs * 2, "ffmpeg -version");
    const version = out.split("\n")[0]?.trim() || "ffmpeg found";
    return { id: "ffmpeg", label, ok: true, detail: version };
  } catch (e) {
    const missing = (e as { code?: unknown }).code === "ENOENT";
    return {
      id: "ffmpeg",
      label,
      ok: false,
      detail: missing ? "ffmpeg was not found on PATH" : `ffmpeg -version failed: ${errText(e)}`,
      fix: ffmpegFix(d.platform),
    };
  }
}

async function checkChromium(d: HealthDeps): Promise<HealthItem> {
  const label = "Playwright Chromium installed";
  const fix = "npx playwright install chromium";
  try {
    const path = await withTimeout(d.chromiumPath(), d.timeoutMs, "Chromium lookup");
    return d.fileExists(path)
      ? { id: "chromium", label, ok: true, detail: path }
      : { id: "chromium", label, ok: false, detail: `Not found at ${path}`, fix };
  } catch (e) {
    return { id: "chromium", label, ok: false, detail: errText(e), fix };
  }
}

/** Run every check in parallel. Never throws: a failed check is a red item. */
export async function checkHealth(overrides: Partial<HealthDeps> = {}): Promise<HealthReport> {
  let d: HealthDeps;
  try {
    d = { ...defaultHealthDeps(), ...overrides };
  } catch (e) {
    return { ok: false, items: [{ id: "ollama", label: "Health check", ok: false, detail: errText(e) }] };
  }
  const safe = async <T>(fn: () => Promise<T>, fallback: (e: unknown) => T): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      return fallback(e);
    }
  };
  const [ollama, ffmpeg, chromium] = await Promise.all([
    safe(() => checkOllama(d), (e) => [{ id: "ollama", label: "Ollama running", ok: false, detail: errText(e), fix: "ollama serve" } as HealthItem]),
    safe(() => checkFfmpeg(d), (e) => ({ id: "ffmpeg", label: "ffmpeg installed", ok: false, detail: errText(e), fix: ffmpegFix(d.platform) }) as HealthItem),
    safe(() => checkChromium(d), (e) => ({ id: "chromium", label: "Playwright Chromium installed", ok: false, detail: errText(e), fix: "npx playwright install chromium" }) as HealthItem),
  ]);
  const items = [...ollama, ffmpeg, chromium];
  return { ok: items.every((i) => i.ok), items };
}

import { describe, expect, it } from "vitest";
import { checkHealth, hasModel, type HealthDeps } from "./health.js";

const tags = (...names: string[]) =>
  (async () => new Response(JSON.stringify({ models: names.map((name) => ({ name })) }))) as unknown as typeof fetch;

const healthy: Partial<HealthDeps> = {
  ollamaUrl: "http://ollama.test",
  model: "qwen2.5:7b-instruct",
  fetch: tags("qwen2.5:7b-instruct", "llama3:latest"),
  ffmpegVersion: async () => "ffmpeg version 6.1 Copyright\nmore",
  chromiumPath: async () => "/browsers/chrome",
  fileExists: () => true,
  platform: "linux",
  timeoutMs: 200,
};

const item = (r: Awaited<ReturnType<typeof checkHealth>>, id: string) => r.items.find((i) => i.id === id)!;

describe("checkHealth", () => {
  it("is green when everything is in place", async () => {
    const r = await checkHealth(healthy);
    expect(r.ok).toBe(true);
    expect(r.items.map((i) => i.id)).toEqual(["ollama", "model", "ffmpeg", "chromium"]);
    expect(item(r, "ffmpeg").detail).toBe("ffmpeg version 6.1 Copyright");
    expect(r.items.every((i) => i.fix === undefined)).toBe(true);
  });

  it("Ollama down: both Ollama items red, with ollama serve", async () => {
    const r = await checkHealth({
      ...healthy,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    expect(item(r, "ollama")).toMatchObject({ ok: false, fix: "ollama serve" });
    expect(item(r, "model")).toMatchObject({ ok: false, fix: "ollama serve, then ollama pull qwen2.5:7b-instruct" });
    expect(item(r, "ffmpeg").ok).toBe(true);
  });

  it("Ollama hanging is a timeout, not a hang", async () => {
    const r = await checkHealth({ ...healthy, fetch: (() => new Promise(() => {})) as unknown as typeof fetch, timeoutMs: 30 });
    expect(item(r, "ollama")).toMatchObject({ ok: false, detail: expect.stringMatching(/timed out/) });
  });

  it("model not pulled: fix is ollama pull <model>", async () => {
    const r = await checkHealth({ ...healthy, fetch: tags("llama3:latest") });
    expect(item(r, "ollama").ok).toBe(true);
    expect(item(r, "model")).toMatchObject({ ok: false, fix: "ollama pull qwen2.5:7b-instruct" });
  });

  it("bad Ollama response is a red item", async () => {
    const r = await checkHealth({ ...healthy, fetch: (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch });
    expect(item(r, "ollama")).toMatchObject({ ok: false, detail: expect.stringMatching(/HTTP 500/) });
  });

  it("ffmpeg missing: platform install command", async () => {
    const enoent = async () => {
      throw Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" });
    };
    const linux = await checkHealth({ ...healthy, ffmpegVersion: enoent });
    expect(item(linux, "ffmpeg")).toMatchObject({ ok: false, detail: "ffmpeg was not found on PATH", fix: "sudo apt install ffmpeg" });
    const mac = await checkHealth({ ...healthy, ffmpegVersion: enoent, platform: "darwin" });
    expect(item(mac, "ffmpeg").fix).toBe("brew install ffmpeg");
  });

  it("Chromium missing or lookup failing: npx playwright install chromium", async () => {
    const missing = await checkHealth({ ...healthy, fileExists: () => false });
    expect(item(missing, "chromium")).toMatchObject({ ok: false, fix: "npx playwright install chromium" });
    const broken = await checkHealth({
      ...healthy,
      chromiumPath: async () => {
        throw new Error("Cannot find module 'playwright-core'");
      },
    });
    expect(item(broken, "chromium")).toMatchObject({ ok: false, fix: "npx playwright install chromium" });
  });

  it("never throws, even when every dependency throws synchronously", async () => {
    const boom = () => {
      throw new Error("boom");
    };
    const r = await checkHealth({
      fetch: boom as unknown as typeof fetch,
      ffmpegVersion: boom,
      chromiumPath: boom,
      fileExists: boom,
      timeoutMs: 50,
    });
    expect(r.ok).toBe(false);
    expect(r.items).toHaveLength(4);
    expect(r.items.every((i) => !i.ok && i.fix)).toBe(true);
  });

  it("matches model tags", () => {
    expect(hasModel(["llama3:latest"], "llama3")).toBe(true);
    expect(hasModel(["qwen2.5:7b"], "qwen2.5:7b-instruct")).toBe(false);
  });
});

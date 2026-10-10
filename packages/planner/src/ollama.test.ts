import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanSchema, loadFixture } from "@demoforge/shared";
import { PLAN_JSON_SCHEMA } from "./plan-schema.js";

type Seen = { method?: string; url?: string; body: any };
let server: Server;
let url: string;
let seen: Seen[];
let handler: (req: IncomingMessage, res: ServerResponse, body: any) => void;

const json = (res: ServerResponse, status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
const chatReply = (content: string, extra: object = {}) => ({ message: { role: "assistant", content }, ...extra });
const tags = (...names: string[]) => ({ models: names.map((name) => ({ name, model: name })) });

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined;
      seen.push({ method: req.method, url: req.url, body });
      handler(req, res, body);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const log = vi.spyOn(console, "log").mockImplementation(() => {});
// The first-call report is module state, so every test gets a fresh copy of the module.
const load = async () => {
  vi.resetModules();
  return import("./ollama.js");
};

beforeEach(() => {
  seen = [];
  handler = (_req, res) => json(res, 200, chatReply("{}"));
  process.env.DEMOFORGE_OLLAMA_URL = url;
  process.env.DEMOFORGE_MODEL = "tiny:1b";
});
afterEach(() => {
  log.mockClear();
  delete process.env.DEMOFORGE_OLLAMA_URL;
  delete process.env.DEMOFORGE_MODEL;
});

describe("health", () => {
  it("is ok when the server answers and the model is pulled", async () => {
    handler = (_req, res) => json(res, 200, tags("other:7b", "tiny:1b"));
    const { health } = await load();
    expect(await health()).toEqual({ ok: true });
    expect(seen[0]).toMatchObject({ method: "GET", url: "/api/tags" });
  });

  it("says to pull the model when it is missing", async () => {
    handler = (_req, res) => json(res, 200, tags("other:7b"));
    const { health } = await load();
    expect(await health()).toEqual({ ok: false, error: "Model not found: run ollama pull tiny:1b" });
  });

  it("treats a model name without a tag as :latest", async () => {
    process.env.DEMOFORGE_MODEL = "llama3";
    handler = (_req, res) => json(res, 200, tags("llama3:latest"));
    const { health } = await load();
    expect((await health()).ok).toBe(true);
  });

  it("says to run ollama serve when nothing is listening", async () => {
    const dead = createServer();
    await new Promise<void>((r) => dead.listen(0, "127.0.0.1", r));
    process.env.DEMOFORGE_OLLAMA_URL = `http://127.0.0.1:${(dead.address() as AddressInfo).port}/`; // trailing slash is fine
    await new Promise((r) => dead.close(r));
    const { health, chatJson } = await load();
    const res = await health();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^Ollama is not running: run ollama serve \(could not reach http:\/\/127\.0\.0\.1:\d+/);
    await expect(chatJson([{ role: "user", content: "hi" }], PLAN_JSON_SCHEMA)).rejects.toMatchObject({ code: "OLLAMA_DOWN" });
  });

  it("says so when the URL is not an Ollama server", async () => {
    handler = (_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("<html>hi</html>");
    const { health } = await load();
    expect((await health()).error).toMatch(/is DEMOFORGE_OLLAMA_URL really an Ollama server/);
  });

  it("defaults to http://localhost:11434", async () => {
    delete process.env.DEMOFORGE_OLLAMA_URL;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    try {
      const { health } = await load();
      expect((await health()).ok).toBe(false);
      expect(String(fetchSpy.mock.calls[0]![0])).toBe("http://localhost:11434/api/tags");
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("chatJson", () => {
  const messages = [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
  ] as const;

  it("POSTs /api/chat with stream:false, the schema as format, temperature 0.2, num_ctx 8192, keep_alive 10m", async () => {
    handler = (_req, res) => json(res, 200, chatReply('{"title":"t","steps":[]}'));
    const { chatJson } = await load();
    const out = await chatJson([...messages], PLAN_JSON_SCHEMA);
    expect(out).toEqual({ title: "t", steps: [] });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "POST", url: "/api/chat" });
    expect(seen[0]!.body).toEqual({
      model: "tiny:1b",
      messages,
      stream: false,
      format: PLAN_JSON_SCHEMA,
      options: { temperature: 0.2, num_ctx: 8192 },
      keep_alive: "10m",
    });
  });

  it("uses qwen2.5:7b-instruct when DEMOFORGE_MODEL is unset or empty", async () => {
    process.env.DEMOFORGE_MODEL = "";
    const { chatJson } = await load();
    await chatJson([...messages], PLAN_JSON_SCHEMA);
    expect(seen[0]!.body.model).toBe("qwen2.5:7b-instruct");
  });

  it("fails with a readable error when the reply is not JSON", async () => {
    handler = (_req, res) => json(res, 200, chatReply("Sure! Here is your plan"));
    const { chatJson, OllamaError } = await load();
    await expect(chatJson([...messages], PLAN_JSON_SCHEMA)).rejects.toThrow(OllamaError);
    await expect(chatJson([...messages], PLAN_JSON_SCHEMA)).rejects.toThrow(/did not return valid JSON .*Sure! Here is your plan/);
    await expect(chatJson([...messages], PLAN_JSON_SCHEMA)).rejects.toMatchObject({ code: "PLAN_INVALID" });
  });

  it("turns Ollama's 'model not found' into 'run ollama pull'", async () => {
    handler = (_req, res) => json(res, 404, { error: 'model "tiny:1b" not found, try pulling it first' });
    const { chatJson } = await load();
    await expect(chatJson([...messages], PLAN_JSON_SCHEMA)).rejects.toThrow("Model not found: run ollama pull tiny:1b");
    await expect(chatJson([...messages], PLAN_JSON_SCHEMA)).rejects.toMatchObject({ code: "MODEL_MISSING" });
  });

  it("reports other HTTP errors with Ollama's message", async () => {
    handler = (_req, res) => json(res, 500, { error: "out of memory" });
    const { chatJson } = await load();
    await expect(chatJson([...messages], PLAN_JSON_SCHEMA)).rejects.toThrow("Ollama returned HTTP 500: out of memory");
    await expect(chatJson([...messages], PLAN_JSON_SCHEMA)).rejects.toMatchObject({ code: "OLLAMA_DOWN" });
  });

  it("times out instead of hanging", async () => {
    handler = () => {}; // never answers
    const { chatJson } = await load();
    await expect(chatJson([...messages], PLAN_JSON_SCHEMA, { timeoutMs: 100 })).rejects.toThrow(/did not answer within 0\.1s/);
    await expect(chatJson([...messages], PLAN_JSON_SCHEMA, { timeoutMs: 100 })).rejects.toMatchObject({ code: "PLAN_TIMEOUT" });
  });

  it("uses a 90 second timeout by default", async () => {
    const { CHAT_TIMEOUT_MS } = await load();
    expect(CHAT_TIMEOUT_MS).toBe(90_000);
  });
});

describe("warmUp", () => {
  it("makes one tiny call with the same options (so the model is not reloaded) and returns its latency", async () => {
    const { warmUp } = await load();
    const ms = await warmUp();
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(seen).toHaveLength(1);
    const body = seen[0]!.body;
    expect(body).toMatchObject({ model: "tiny:1b", stream: false, keep_alive: "10m", options: { temperature: 0.2, num_ctx: 8192, num_predict: 4 } });
    expect(body.format).toBeUndefined();
    expect(JSON.stringify(body.messages).length).toBeLessThan(120);
  });
});

describe("first-call latency", () => {
  it("is printed once, with the model load time when Ollama reports it", async () => {
    handler = (_req, res) => json(res, 200, chatReply("{}", { load_duration: 3_400_000_000 }));
    const { warmUp, chatJson } = await load();
    await warmUp();
    await chatJson([{ role: "user", content: "x" }], PLAN_JSON_SCHEMA);
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("first Ollama call"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[planner\] first Ollama call \(tiny:1b\) took \d+(\.\d)?s \(3\.4s of it loading the model\)$/);
  });

  it("is not printed for a failed call", async () => {
    handler = (_req, res) => json(res, 500, { error: "boom" });
    const { warmUp } = await load();
    await expect(warmUp()).rejects.toThrow();
    expect(log.mock.calls.some((c) => String(c[0]).includes("first Ollama call"))).toBe(false);
  });
});

describe("PLAN_JSON_SCHEMA", () => {
  const step = PLAN_JSON_SCHEMA.properties.steps.items;

  it("describes every field the fixture plan uses, and lists every action", () => {
    for (const s of loadFixture("plan.json", PlanSchema).steps) {
      expect(Object.keys(step.properties)).toEqual(expect.arrayContaining(Object.keys(s)));
      for (const key of step.required) expect(s).toHaveProperty(key);
    }
    expect(step.properties.action.enum).toEqual(["navigate", "click", "fill", "wait", "assert_text", "scroll"]);
    expect(PLAN_JSON_SCHEMA.properties.steps.maxItems).toBe(25);
  });
});

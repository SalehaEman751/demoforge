import { z } from "zod";

const DEFAULT_URL = "http://localhost:11434";
const DEFAULT_MODEL = "qwen2.5:7b-instruct";
/** A chat call may include loading the model from disk, so it gets a long timeout. */
export const CHAT_TIMEOUT_MS = 90_000;
const HEALTH_TIMEOUT_MS = 5_000;
/** Low temperature for stable plans. num_ctx must stay identical on every call or Ollama reloads the model. */
const OPTIONS = { temperature: 0.2, num_ctx: 8192 };
const KEEP_ALIVE = "10m";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Stable codes for planner failures (read by apps/api/src/failure.ts before it looks at any message text).
 * OLLAMA_DOWN: server unreachable, not an Ollama server, or an HTTP error; MODEL_MISSING: model not pulled;
 * PLAN_INVALID: the model's answer is not a usable plan; PLAN_TIMEOUT: no answer in time.
 */
export type PlannerErrorCode = "OLLAMA_DOWN" | "MODEL_MISSING" | "PLAN_INVALID" | "PLAN_TIMEOUT";

/** Message is plain language, meant to be shown to the person running the demo. */
export class OllamaError extends Error {
  override name = "OllamaError";
  constructor(
    message: string,
    readonly code: PlannerErrorCode = "OLLAMA_DOWN",
  ) {
    super(message);
  }
}

// Read on every call so tests (and a changed .env) take effect without a restart.
const baseUrl = (): string => (process.env.DEMOFORGE_OLLAMA_URL || DEFAULT_URL).replace(/\/+$/, "");
const modelName = (): string => process.env.DEMOFORGE_MODEL || DEFAULT_MODEL;

const ChatReply = z.object({
  message: z.object({ content: z.string() }),
  load_duration: z.number().optional(), // nanoseconds spent loading the model
});
const TagsReply = z.object({ models: z.array(z.object({ name: z.string(), model: z.string().optional() })) });

const seconds = (ms: number): string => String(Math.round(ms / 100) / 10);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** One HTTP round trip. Network failures and timeouts become OllamaError; HTTP status is left to the caller. */
async function call(path: string, init: { method: "GET" | "POST"; body?: unknown }, timeoutMs: number): Promise<{ status: number; text: string }> {
  const url = baseUrl();
  try {
    const res = await fetch(url + path, {
      method: init.method,
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new OllamaError(`Ollama did not answer within ${seconds(timeoutMs)}s. It may still be loading the model: wait a moment and try again.`, "PLAN_TIMEOUT");
    }
    const code = (e as { cause?: { code?: string } }).cause?.code;
    throw new OllamaError(`Ollama is not running: run ollama serve (could not reach ${url}${code ? `, ${code}` : ""})`, "OLLAMA_DOWN");
  }
}

function httpError(status: number, text: string): OllamaError {
  const body = parseJson(text) as { error?: unknown } | undefined;
  const detail = typeof body?.error === "string" ? body.error : text.slice(0, 200);
  if (/model .*not found|try pulling/i.test(detail)) return new OllamaError(`Model not found: run ollama pull ${modelName()}`, "MODEL_MISSING");
  return new OllamaError(`Ollama returned HTTP ${status}: ${detail || "no details"}`, "OLLAMA_DOWN");
}

let firstCallReported = false;

async function chat(
  messages: ChatMessage[],
  format: Record<string, unknown> | undefined,
  extraOptions: Record<string, number>,
  timeoutMs: number,
): Promise<{ content: string; latencyMs: number }> {
  const model = modelName();
  const t0 = performance.now();
  const { status, text } = await call(
    "/api/chat",
    {
      method: "POST",
      body: {
        model,
        messages,
        stream: false,
        ...(format ? { format } : {}),
        options: { ...OPTIONS, ...extraOptions },
        keep_alive: KEEP_ALIVE,
      },
    },
    timeoutMs,
  );
  if (status < 200 || status >= 300) throw httpError(status, text);
  const reply = ChatReply.safeParse(parseJson(text));
  if (!reply.success) throw new OllamaError(`Unexpected reply from Ollama at ${baseUrl()}: is DEMOFORGE_OLLAMA_URL really an Ollama server?`, "OLLAMA_DOWN");
  const latencyMs = performance.now() - t0;

  if (!firstCallReported) {
    firstCallReported = true;
    const load = reply.data.load_duration ? ` (${seconds(reply.data.load_duration / 1e6)}s of it loading the model)` : "";
    console.log(`[planner] first Ollama call (${model}) took ${seconds(latencyMs)}s${load}`);
  }
  return { content: reply.data.message.content, latencyMs };
}

/** Is the server reachable and is the model pulled? Never throws; `error` is ready to show. */
export async function health(): Promise<{ ok: boolean; error?: string }> {
  const model = modelName();
  try {
    const { status, text } = await call("/api/tags", { method: "GET" }, HEALTH_TIMEOUT_MS);
    const tags = status === 200 ? TagsReply.safeParse(parseJson(text)) : undefined;
    if (!tags?.success) {
      return { ok: false, error: `Unexpected reply from ${baseUrl()} (HTTP ${status}): is DEMOFORGE_OLLAMA_URL really an Ollama server?` };
    }
    const wanted = model.includes(":") ? model : `${model}:latest`;
    if (!tags.data.models.some((m) => m.name === wanted || m.model === wanted)) {
      return { ok: false, error: `Model not found: run ollama pull ${model}` };
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof OllamaError) return { ok: false, error: e.message };
    throw e;
  }
}

/** One tiny call so the model is loaded (and kept for 10 minutes) before the real one. Returns its latency in ms. */
export async function warmUp(): Promise<number> {
  const { latencyMs } = await chat([{ role: "user", content: "Reply with the single word: ready" }], undefined, { num_predict: 4 }, CHAT_TIMEOUT_MS);
  return latencyMs;
}

/**
 * Chat with the output constrained to `schema` (a JSON schema, sent as Ollama's `format`).
 * Returns the model's exact text plus its JSON parse (`undefined` when it is not JSON), still unvalidated:
 * the caller checks it with Zod / validatePlan and may want the raw text for a debug log.
 */
export async function chatJsonRaw(messages: ChatMessage[], schema: Record<string, unknown>, opts: { timeoutMs?: number } = {}): Promise<{ raw: string; json: unknown }> {
  const { content } = await chat(messages, schema, {}, opts.timeoutMs ?? CHAT_TIMEOUT_MS);
  return { raw: content, json: parseJson(content) };
}

/** Like chatJsonRaw, but returns only the parsed JSON and throws an OllamaError when the reply is not JSON. */
export async function chatJson(messages: ChatMessage[], schema: Record<string, unknown>, opts: { timeoutMs?: number } = {}): Promise<unknown> {
  const { raw, json } = await chatJsonRaw(messages, schema, opts);
  if (json === undefined) throw new OllamaError(`The model did not return valid JSON (it said: ${raw.slice(0, 120)})`, "PLAN_INVALID");
  return json;
}

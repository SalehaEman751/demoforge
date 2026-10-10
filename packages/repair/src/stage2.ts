import type { ElementInventory, Step } from "@demoforge/shared";
import { z } from "zod";

const TIMEOUT_MS = 60_000;
const Reply = z.object({ message: z.object({ content: z.string() }) });
const Answer = z.object({ role: z.string(), name: z.string() }).nullable();

/**
 * Stage 2: ask the local Ollama model which inventory element the step meant. The answer must be an element
 * that really exists in the inventory. Any failure (Ollama down, timeout, bad JSON, invented element) gives null.
 */
export async function stage2Ask(args: { step: Step; error: string; inventory: ElementInventory }): Promise<{ role: string; name: string } | null> {
  const { step, error, inventory } = args;
  if (!step.target) return null;
  const elements = inventory.pages.flatMap((p) => p.elements.map((e) => ({ role: e.role, name: e.name })));
  const prompt = [
    "A browser demo step failed because its target element was not found.",
    `Step: ${step.action} role="${step.target.role}" name="${step.target.name}", caption "${step.caption}".`,
    `Error: ${error}`,
    `Elements that exist on the site: ${JSON.stringify(elements)}`,
    'Pick the one element the step most likely meant. Reply with only JSON: {"role":"...","name":"..."} copied from the list, or null if none fits.',
  ].join("\n");
  try {
    const res = await fetch((process.env.DEMOFORGE_OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, "") + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.DEMOFORGE_MODEL || "qwen2.5:7b-instruct",
        stream: false,
        format: "json",
        options: { temperature: 0, num_ctx: 8192 },
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const content = Reply.parse(await res.json()).message.content;
    const answer = Answer.parse(JSON.parse(content));
    if (!answer) return null;
    return elements.some((e) => e.role === answer.role && e.name === answer.name) ? { role: answer.role, name: answer.name } : null;
  } catch {
    return null;
  }
}

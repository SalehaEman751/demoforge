import type { ElementInventory, ProjectBrief } from "@demoforge/shared";
import type { ChatMessage } from "./ollama.js";

/** Keeps the prompt well inside num_ctx (8192): Ollama silently drops the start of an over-long prompt. */
const MAX_ELEMENT_LINES = 150;
const MAX_README_CHARS = 1200;

export const SYSTEM_PROMPT = `You plan a product demo that a robot browser will perform and record on video.
Reply with one JSON object: {"title": string, "steps": [...]}.

Rules:
- Use only these actions: navigate (needs url), click (needs target), fill (needs target and value), wait (needs ms), assert_text (needs text), scroll (nothing else).
- A target is {"role": ..., "name": ...}. Use a role and the exact accessible name listed in the inventory. Never invent or reword a name.
- The first step is navigate. Navigate urls are relative paths such as /signup. Never navigate off-site.
- Use 6 to 14 steps, with ids 1, 2, 3, ... in order.
- Every step has a caption of at most 8 words, written for a viewer watching the video (for example "Create the account"), not for a developer.
- Fill steps use realistic sample values: email demo@example.com, password demo1234, and believable text for anything else.
- Finish with an assert_text step whose text is visible on the page and proves the goal was reached.
- Follow the user's special instructions first; these rules fill in everything they do not cover.

Example step: {"id": 2, "action": "fill", "target": {"role": "textbox", "name": "Email"}, "value": "demo@example.com", "caption": "Enter an email address"}`;

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/** One line per element: `page | role | name`. Pages that redirect have unknown elements and say so. */
export function inventoryText(inventory: ElementInventory): string {
  const lines: string[] = [];
  let elements = 0;
  let hidden = 0;
  for (const page of inventory.pages) {
    if (page.redirectedTo) {
      lines.push(`${page.url} | redirects to ${page.redirectedTo} | element names unknown: make your best guess from the README and the instructions`);
    } else if (page.elements.length === 0) {
      lines.push(`${page.url} | (no elements found)`);
    }
    if (page.redirectedTo) continue;
    for (const el of page.elements) {
      if (elements >= MAX_ELEMENT_LINES) hidden++;
      else {
        lines.push(`${page.url} | ${oneLine(el.role)} | ${oneLine(el.name)}`);
        elements++;
      }
    }
  }
  if (hidden > 0) lines.push(`(${hidden} more elements not shown)`);
  return lines.join("\n");
}

export function buildUserPrompt(args: { brief: ProjectBrief; inventory: ElementInventory; instructions: string }): string {
  const { brief, inventory, instructions } = args;
  const readme = oneLine(brief.readmeSummary);
  return [
    `Project: ${brief.name} (${brief.framework})`,
    `Routes: ${brief.routes.join(", ")}`,
    `README: ${readme.length > MAX_README_CHARS ? readme.slice(0, MAX_README_CHARS) + "..." : readme}`,
    "",
    "Inventory (page | role | name):",
    inventoryText(inventory),
    "",
    `Instructions: ${instructions.trim() || "(none: show the app's main flow)"}`,
  ].join("\n");
}

export function buildMessages(args: { brief: ProjectBrief; inventory: ElementInventory; instructions: string }): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(args) },
  ];
}

const bullets = (items: string[]): string => items.map((p) => `- ${p}`).join("\n");

/** Appended after a reply that was not a valid plan. */
export function schemaRetryMessage(problems: string[]): string {
  return `That reply is not a valid plan:\n${bullets(problems)}\nReply again with the complete corrected plan as JSON.`;
}

/** Appended after a well-formed plan that does not fit the app. */
export function replanMessage(problems: string[]): string {
  return `That plan does not fit the app:\n${bullets(problems)}\nFix every problem and reply with the complete corrected plan as JSON. Use only elements from the inventory.`;
}

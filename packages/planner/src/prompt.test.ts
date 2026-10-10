import { describe, expect, it } from "vitest";
import { ElementInventorySchema, ProjectBriefSchema, loadFixture, type ElementInventory } from "@demoforge/shared";
import { SYSTEM_PROMPT, buildMessages, buildUserPrompt, inventoryText, replanMessage, schemaRetryMessage } from "./prompt.js";

const brief = loadFixture("brief.json", ProjectBriefSchema);
const inventory = loadFixture("element-inventory.json", ElementInventorySchema);

describe("SYSTEM_PROMPT", () => {
  it("carries every rule from the ticket", () => {
    for (const needle of [
      "navigate (needs url)", "click (needs target)", "fill (needs target and value)", "wait (needs ms)", "assert_text (needs text)", "scroll",
      "exact accessible name", "The first step is navigate", "Never navigate off-site", "6 to 14 steps", "at most 8 words", "viewer",
      "demo@example.com", "demo1234", "Finish with an assert_text", "special instructions first",
    ]) {
      expect(SYSTEM_PROMPT, needle).toContain(needle);
    }
  });
});

describe("inventoryText", () => {
  it("is one `page | role | name` line per element", () => {
    const lines = inventoryText(inventory).split("\n");
    expect(lines).toHaveLength(inventory.pages.reduce((n, p) => n + p.elements.length, 0));
    expect(lines).toContain("/ | link | Get started");
    expect(lines).toContain("/signup | button | Create account");
    expect(lines.every((l) => l.split(" | ").length === 3)).toBe(true);
  });

  it("says element names are unknown for a page that redirects, and lists nothing for it", () => {
    const inv: ElementInventory = {
      pages: [
        { url: "/dashboard", title: "Dashboard", redirectedTo: "/login", elements: [{ role: "button", name: "Ghost" }] },
        { url: "/", title: "Home", elements: [{ role: "link", name: "Sign up" }] },
      ],
    };
    const text = inventoryText(inv);
    expect(text).toContain("/dashboard | redirects to /login | element names unknown: make your best guess from the README and the instructions");
    expect(text).not.toContain("Ghost");
    expect(text).toContain("/ | link | Sign up");
  });

  it("notes a page with no elements, collapses whitespace, and caps very long inventories", () => {
    expect(inventoryText({ pages: [{ url: "/empty", title: "", elements: [] }] })).toBe("/empty | (no elements found)");
    expect(inventoryText({ pages: [{ url: "/", title: "", elements: [{ role: "button", name: "Save\n  now" }] }] })).toBe("/ | button | Save now");
    const many: ElementInventory = { pages: [{ url: "/", title: "", elements: Array.from({ length: 200 }, (_, i) => ({ role: "link", name: `L${i}` })) }] };
    const lines = inventoryText(many).split("\n");
    expect(lines).toHaveLength(151);
    expect(lines.at(-1)).toBe("(50 more elements not shown)");
  });
});

describe("buildUserPrompt / buildMessages", () => {
  const prompt = buildUserPrompt({ brief, inventory, instructions: "Show a new user signing up." });

  it("contains the brief, the inventory and the instructions", () => {
    expect(prompt).toContain("Project: Taskly (Next.js)");
    expect(prompt).toContain("Routes: /, /signup, /dashboard");
    expect(prompt).toContain("README: Taskly is a minimal task manager.");
    expect(prompt).toContain("Inventory (page | role | name):\n/ | heading | Taskly");
    expect(prompt.endsWith("Instructions: Show a new user signing up.")).toBe(true);
  });

  it("falls back to the main flow when there are no instructions", () => {
    expect(buildUserPrompt({ brief, inventory, instructions: "  " })).toContain("Instructions: (none: show the app's main flow)");
  });

  it("is a system message followed by a user message", () => {
    const messages = buildMessages({ brief, inventory, instructions: "x" });
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(messages[0]!.content).toBe(SYSTEM_PROMPT);
  });
});

describe("follow-up messages", () => {
  it("list every problem", () => {
    expect(schemaRetryMessage(["steps.0.action: bad", "title: Required"])).toMatch(/- steps\.0\.action: bad\n- title: Required\n.*corrected plan/s);
    expect(replanMessage(["step 2: no button named \"X\""])).toMatch(/- step 2: no button named "X"\n.*inventory/s);
  });
});

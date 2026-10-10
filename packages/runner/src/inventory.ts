import type { Page } from "playwright-core";
import type { ElementInventory } from "@demoforge/shared";

/** Hard cap so the repair hook (usually an LLM prompt) gets a bounded snapshot. */
export const MAX_INVENTORY_ELEMENTS = 100;

export type InventoryElement = {
  /** Explicit `role` attribute, else the implicit ARIA role; null when there is none (e.g. password inputs). */
  role: string | null;
  /** Accessible name: aria-label, aria-labelledby, <label>, value (buttons), text, title, placeholder. */
  name: string;
  tag: string;
  type?: string;
  id?: string;
  testId?: string;
  href?: string;
  placeholder?: string;
  disabled?: true;
  checked?: boolean;
};

export type PageInventory = {
  url: string;
  title: string;
  headings: string[];
  elements: InventoryElement[];
  /** True when the page had more than MAX_INVENTORY_ELEMENTS candidates. */
  truncated: boolean;
};

/**
 * Runs inside the page. Plain function serialised with .toString(), so it must not reference
 * anything from this module. Values of inputs are deliberately never read (they may be secrets).
 */
function collect(max: number): PageInventory {
  const clean = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const isVisible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const INPUT_ROLES: Record<string, string | null> = {
    button: "button", submit: "button", reset: "button", image: "button",
    checkbox: "checkbox", radio: "radio", range: "slider", search: "searchbox",
    password: null, hidden: null,
  };
  const roleOf = (el: Element): string | null => {
    const explicit = el.getAttribute("role")?.trim().split(/\s+/)[0];
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : null;
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return (el as HTMLSelectElement).multiple ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = ((el as HTMLInputElement).type || "text").toLowerCase();
      return type in INPUT_ROLES ? INPUT_ROLES[type]! : "textbox";
    }
    return null;
  };
  const nameOf = (el: Element): string => {
    const aria = clean(el.getAttribute("aria-label"));
    if (aria) return aria;
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = clean(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" "));
      if (t) return t;
    }
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) {
      const t = clean(Array.from(labels).map((l) => l.textContent).join(" "));
      if (t) return t;
    }
    if (el instanceof HTMLInputElement && ["button", "submit", "reset"].includes(el.type)) return clean(el.value);
    return clean(el.textContent) || clean(el.getAttribute("title")) || clean(el.getAttribute("alt")) || clean(el.getAttribute("placeholder"));
  };

  const selector = [
    "a[href]", "button", "input:not([type=hidden])", "select", "textarea", "summary",
    "[role]", "[contenteditable='']", "[contenteditable='true']", "[tabindex]:not([tabindex='-1'])",
  ].join(",");
  const candidates = Array.from(document.querySelectorAll(selector)).filter(isVisible);
  const elements: InventoryElement[] = [];
  for (const el of candidates.slice(0, max)) {
    const tag = el.tagName.toLowerCase();
    const role = roleOf(el);
    const name = nameOf(el);
    const isControl = ["a", "button", "input", "select", "textarea", "summary"].includes(tag);
    if (!role && !name && !isControl) continue; // anonymous focusable div: noise
    const item: InventoryElement = { role, name, tag };
    if (el instanceof HTMLInputElement) {
      item.type = el.type;
      if (el.type === "checkbox" || el.type === "radio") item.checked = el.checked;
    }
    if (el.id) item.id = el.id;
    const testId = el.getAttribute("data-testid");
    if (testId) item.testId = testId;
    const href = el.getAttribute("href");
    if (href) item.href = href.slice(0, 200);
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) item.placeholder = clean(placeholder);
    if ((el as HTMLButtonElement).disabled) item.disabled = true;
    elements.push(item);
  }
  const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
    .filter(isVisible)
    .slice(0, 10)
    .map((h) => clean(h.textContent))
    .filter(Boolean);
  return { url: location.href, title: document.title, headings, elements, truncated: candidates.length > max };
}

/**
 * Snapshot of the live page for the repair hook. Never throws: if the page is mid-navigation, closed or
 * still about:blank, the caller still gets a (possibly empty) inventory and can repair e.g. a bad URL.
 */
export async function buildInventory(page: Page): Promise<PageInventory> {
  try {
    // `__name` shim: esbuild/tsx may inject calls to it into serialised functions (keepNames).
    return await page.evaluate(`(function(){var __name=function(f){return f};return (${collect.toString()})(${MAX_INVENTORY_ELEMENTS});})()`) as PageInventory;
  } catch {
    return { url: page.url(), title: "", headings: [], elements: [], truncated: false };
  }
}

/**
 * Converts the runtime snapshot into the shared contract shape the repair hook is typed with:
 * `{ pages: [{ url, title, elements: [{ role, name, placeholder? }] }] }`.
 *
 * - Headings become `heading` elements (same convention as fixtures/element-inventory.json).
 * - The contract requires a string role. Password inputs have no ARIA role, so they are reported as
 *   `textbox`, which is what `performStep` already treats as "fall back to the label" for those fields.
 * - Any other element without a role cannot be targeted by role + name, so it is left out.
 * - tag/id/testId/href/disabled/checked and the `truncated` flag are runtime-only and not part of the contract.
 */
export function toElementInventory(page: PageInventory): ElementInventory {
  const headings = page.headings.map((name) => ({ role: "heading", name }));
  const controls: ElementInventory["pages"][number]["elements"] = [];
  for (const el of page.elements) {
    const role = el.role ?? (el.type === "password" ? "textbox" : null);
    if (!role) continue;
    controls.push(el.placeholder ? { role, name: el.name, placeholder: el.placeholder } : { role, name: el.name });
  }
  return { pages: [{ url: page.url, title: page.title, elements: [...headings, ...controls] }] };
}

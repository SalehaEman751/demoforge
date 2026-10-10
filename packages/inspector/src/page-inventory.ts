import type { Page } from "playwright-core";
import type { ElementInventory } from "@demoforge/shared";

export type PageElement = ElementInventory["pages"][number]["elements"][number];

/** The roles worth targeting in a demo. Everything else in the accessibility tree is ignored. */
const ROLES = new Set(["link", "button", "textbox", "checkbox", "combobox"]);
const ATTRIBUTE_TIMEOUT_MS = 1000;

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * Pulls `role "name"` pairs out of a Playwright aria snapshot (YAML-like text), keeping only ROLES.
 * Unnamed elements (`- button` with no quoted name) are skipped, as are regex-style names.
 */
export function parseAriaSnapshot(snapshot: string): { role: string; name: string }[] {
  const found: { role: string; name: string }[] = [];
  for (const line of snapshot.split("\n")) {
    const m = /^\s*-\s+([a-z]+)\s+("(?:[^"\\]|\\.)*")/.exec(line);
    if (!m || !ROLES.has(m[1]!)) continue;
    let name: string;
    try {
      name = clean(JSON.parse(m[2]!) as string);
    } catch {
      continue;
    }
    if (name) found.push({ role: m[1]!, name });
  }
  return found;
}

// Runs in the page. Plain JS in a string on purpose: a compiled function can pick up helpers (like esbuild's __name) that do not exist there.
const LINK_HREFS = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  return Array.from(document.querySelectorAll("a[href]")).filter(visible).map((a) => a.href);
})()`;

/** Absolute hrefs of the visible links on the page (the caller decides which are same-origin). */
export async function collectLinkHrefs(page: Page): Promise<string[]> {
  try {
    return (await page.evaluate(LINK_HREFS)) as string[];
  } catch {
    return [];
  }
}

/**
 * Interactive elements of the current page: links, buttons, textboxes, checkboxes, comboboxes with their ARIA role,
 * accessible name and (for inputs) placeholder. Hidden elements and elements without an accessible name never appear
 * (the accessibility tree leaves hidden ones out; unnamed ones are dropped here).
 * Two elements with the same role+name are both kept, and `warn` is told about them.
 */
export async function collectElements(page: Page, warn: (message: string) => void = () => {}, pagePath = page.url()): Promise<PageElement[]> {
  const snapshot = await page.locator("body").ariaSnapshot({ timeout: 5000 });
  const elements: PageElement[] = parseAriaSnapshot(snapshot);

  for (const el of elements) {
    if (el.role !== "textbox" && el.role !== "combobox") continue;
    const placeholder = await page
      .getByRole(el.role, { name: el.name, exact: true })
      .first()
      .getAttribute("placeholder", { timeout: ATTRIBUTE_TIMEOUT_MS })
      .catch(() => null);
    if (placeholder && clean(placeholder)) el.placeholder = clean(placeholder);
  }

  const seen = new Map<string, number>();
  for (const el of elements) seen.set(`${el.role}\u0000${el.name}`, (seen.get(`${el.role}\u0000${el.name}`) ?? 0) + 1);
  for (const [key, count] of seen) {
    if (count > 1) {
      const [role, name] = key.split("\u0000");
      warn(`${pagePath}: ${count} elements share the same role and name: ${role} "${name}" (all kept)`);
    }
  }
  return elements;
}

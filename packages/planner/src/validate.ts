import { PlanSchema, type ElementInventory, type ValidatePlanFn } from "@demoforge/shared";

type Page = ElementInventory["pages"][number];

const warn = (message: string): void => console.warn(`[planner] validatePlan: ${message}`);

/** Path of `url` (relative or absolute) without query/hash or trailing slash: "/signup/?a=1" -> "/signup". */
function pathOf(url: string, base: URL): string {
  let p: string;
  try {
    p = new URL(url, base).pathname;
  } catch {
    p = url;
  }
  return p.length > 1 ? p.replace(/\/+$/, "") || "/" : p;
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** Case-insensitive, whitespace-insensitive, with a small typo allowance (1 edit from 4 chars, 2 from 8). */
function sameName(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x === y) return true;
  const len = Math.max(x.length, y.length);
  const tolerance = len >= 8 ? 2 : len >= 4 ? 1 : 0;
  return distance(x, y) <= tolerance;
}

/** Looks for `target` on `page`. Returns null when found, else why not. */
function findTarget(page: Page, target: { role: string; name: string }): string | null {
  const named = page.elements.filter((e) => sameName(e.name, target.name));
  if (named.some((e) => norm(e.role) === norm(target.role))) return null;
  if (named.length > 0) {
    return `"${target.name}" is a ${named.map((e) => e.role).join("/")} on ${page.url}, not a ${target.role}`;
  }
  const names = page.elements.slice(0, 12).map((e) => `${e.role} "${e.name}"`).join(", ");
  return `no ${target.role} named "${target.name}" on ${page.url} (it has: ${names || "nothing"})`;
}

/**
 * Pure check of a plan against the element inventory: no LLM, no network.
 * `plan` is typed `unknown` on purpose: it usually comes straight from a model.
 */
export function validatePlan(plan: unknown, inventory: ElementInventory, baseUrl: string): { ok: boolean; errors: string[] } {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return { ok: false, errors: [`baseUrl is not a valid URL: ${baseUrl}`] };
  }

  // Shape, action allowlist, required fields per action, ids 1..n in order, 1 to 25 steps.
  const parsed = PlanSchema.safeParse(plan);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "plan"}: ${i.message}`) };
  }

  const errors: string[] = [];
  const steps = parsed.data.steps;
  if (steps[0]!.action !== "navigate") errors.push(`step 1: the first step must be navigate, got ${steps[0]!.action}`);

  const pages = inventory.pages.map((p) => ({ page: p, path: pathOf(p.url, base) }));
  const pageAt = (path: string): Page | undefined => pages.find((p) => p.path === path)?.page;

  let current: string | null = null; // path of the page we are on; null until the first navigate
  let mayHaveMoved = false; // a click can navigate, and we cannot know where

  for (const step of steps) {
    const at = `step ${step.id}`;
    if (step.action === "navigate") {
      const url = step.url ?? "";
      let target: URL | null = null;
      try {
        target = new URL(url, base);
      } catch {
        /* handled below */
      }
      if (!target || target.origin !== base.origin) {
        errors.push(`${at}: navigate url "${url}" must be a relative path or start with ${base.origin}, never another origin`);
        current = null;
      } else {
        current = pathOf(url, base);
      }
      mayHaveMoved = false;
    } else if (step.action === "fill" || step.action === "click") {
      if (step.action === "fill" && !step.value?.trim()) errors.push(`${at}: fill needs a non-empty value`);
      const target = step.target!;
      const here: Page | undefined = current === null ? undefined : pageAt(current);
      if (!here) {
        warn(`${at}: current page ${current ?? "(unknown)"} is not in the inventory, skipping the target check for "${target.name}"`);
      } else if (here.redirectedTo) {
        warn(`${at}: ${here.url} redirects to ${here.redirectedTo}, skipping the target check for "${target.name}"`);
      } else {
        const problem = findTarget(here, target);
        if (problem) {
          // After a click the browser may be on another page; accept the target if some other page has it.
          const elsewhere: { page: Page; path: string } | undefined = mayHaveMoved
            ? pages.find((p) => p.page !== here && !p.page.redirectedTo && findTarget(p.page, target) === null)
            : undefined;
          if (elsewhere) current = elsewhere.path;
          else errors.push(`${at}: ${problem}`);
        }
      }
      if (step.action === "click") mayHaveMoved = true;
    } else if (step.action === "assert_text" && !step.text?.trim()) {
      errors.push(`${at}: assert_text needs non-empty text`);
    }
  }

  return { ok: errors.length === 0, errors };
}

// Compile-time check that the function above still fits the shared contract.
const _contract: ValidatePlanFn = validatePlan;
void _contract;

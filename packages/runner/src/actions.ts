import type { Locator, Page } from "playwright-core";
import type { Step } from "@demoforge/shared";

export const STEP_TIMEOUT_MS = 8000;
export const ASSERT_TIMEOUT_MS = 5000;
export const MAX_WAIT_MS = 5000;
export const SCROLL_PX = 400;
const TYPE_DELAY_MS = 30;

type Role = Parameters<Page["getByRole"]>[0];

function target(step: Step): { role: string; name: string } {
  if (!step.target) throw new Error(`${step.action} step ${step.id} has no target`);
  return step.target;
}

function byRole(page: Page, step: Step): Locator {
  const { role, name } = target(step);
  return page.getByRole(role as Role, { name, exact: true });
}

/** Resolves `url` against `baseUrl`; throws if the result is on another origin. */
export function resolveUrl(url: string, baseUrl: string): string {
  const base = new URL(baseUrl);
  let resolved: URL;
  try {
    resolved = new URL(url, base);
  } catch {
    throw new Error(`Invalid url "${url}"`);
  }
  if (resolved.origin !== base.origin) {
    throw new Error(`Refusing to navigate to ${resolved.origin}: only ${base.origin} is allowed`);
  }
  return resolved.href;
}

export async function navigate(page: Page, step: Step, baseUrl: string): Promise<void> {
  if (step.url === undefined) throw new Error(`navigate step ${step.id} has no url`);
  await page.goto(resolveUrl(step.url, baseUrl), { timeout: STEP_TIMEOUT_MS });
}

export async function click(page: Page, step: Step): Promise<void> {
  await byRole(page, step).click({ timeout: STEP_TIMEOUT_MS });
}

export async function fill(page: Page, step: Step): Promise<void> {
  if (step.value === undefined) throw new Error(`fill step ${step.id} has no value`);
  const { role, name } = target(step);
  let field = byRole(page, step);
  // Password inputs have no ARIA role, so a plan that calls them textboxes falls back to the label.
  if (role === "textbox" && (await field.count()) === 0) {
    const labelled = page.getByLabel(name, { exact: true });
    if ((await labelled.count()) > 0) field = labelled;
  }
  await field.clear({ timeout: STEP_TIMEOUT_MS });
  // Keep typing well inside the step timeout for long values.
  const delay = Math.min(TYPE_DELAY_MS, Math.floor(6000 / Math.max(step.value.length, 1)));
  await field.pressSequentially(step.value, { delay, timeout: STEP_TIMEOUT_MS });
}

export async function wait(page: Page, step: Step): Promise<void> {
  if (step.ms === undefined) throw new Error(`wait step ${step.id} has no ms`);
  await page.waitForTimeout(Math.min(step.ms, MAX_WAIT_MS));
}

export async function assertText(page: Page, step: Step): Promise<void> {
  if (step.text === undefined) throw new Error(`assert_text step ${step.id} has no text`);
  await page.getByText(step.text).first().waitFor({ state: "visible", timeout: ASSERT_TIMEOUT_MS });
}

export async function scroll(page: Page): Promise<void> {
  // String form: this package has no DOM typings.
  await page.evaluate(`window.scrollBy({ top: ${SCROLL_PX}, behavior: "smooth" })`);
}

export async function performStep(page: Page, step: Step, baseUrl: string): Promise<void> {
  switch (step.action) {
    case "navigate":
      return navigate(page, step, baseUrl);
    case "click":
      return click(page, step);
    case "fill":
      return fill(page, step);
    case "wait":
      return wait(page, step);
    case "assert_text":
      return assertText(page, step);
    case "scroll":
      return scroll(page);
  }
}

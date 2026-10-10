import { expect, test, type Page } from "@playwright/test";

const CHECKED_ROLES = new Set([
  "link", "button", "textbox", "searchbox", "combobox", "checkbox",
  "radio", "switch", "slider", "spinbutton",
]);
// Headings are included in the uniqueness check only.
const UNIQUE_ROLES = new Set([...CHECKED_ROLES, "heading"]);

type AXNode = {
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
};

/** Reads Chromium's accessibility tree and returns every accessibility problem found. */
async function findProblems(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: AXNode[] };
  await cdp.detach();

  const problems: string[] = [];
  const seen = new Map<string, number>();
  for (const n of nodes) {
    if (n.ignored) continue;
    const role = n.role?.value ?? "";
    const name = (n.name?.value ?? "").trim();
    if (CHECKED_ROLES.has(role) && !name) problems.push(`${role} has no accessible name`);
    if (UNIQUE_ROLES.has(role) && name) {
      const key = `${role} "${name}"`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of seen) if (count > 1) problems.push(`${key} appears ${count} times`);
  return problems;
}

async function signUp(page: Page) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill("a11y@taskly.dev");
  await page.getByLabel("Password").fill("password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("No tasks yet")).toBeVisible();
}

test("checker flags unnamed controls and duplicate role+name pairs", async ({ page }) => {
  await page.setContent(
    `<button></button><input type="text"><a href="/a">Go</a><a href="/b">Go</a>`,
  );
  const problems = await findProblems(page);
  expect(problems).toContain("button has no accessible name");
  expect(problems).toContain("textbox has no accessible name");
  expect(problems).toContain('link "Go" appears 2 times');
});

test("/ has no accessibility name problems", async ({ page }) => {
  await page.goto("/");
  expect(await findProblems(page)).toEqual([]);
});

test("/signup has no accessibility name problems", async ({ page }) => {
  await page.goto("/signup");
  expect(await findProblems(page)).toEqual([]);
});

test("/signup with an error showing has no problems", async ({ page }) => {
  await page.goto("/signup");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "." })).toBeVisible();
  expect(await findProblems(page)).toEqual([]);
});

test("/dashboard (empty) has no accessibility name problems", async ({ page }) => {
  await signUp(page);
  expect(await findProblems(page)).toEqual([]);
});

test("/dashboard (with tasks) has no accessibility name problems", async ({ page }) => {
  await signUp(page);
  for (const task of ["Write tests", "Record the demo"]) {
    await page.getByLabel("New task").fill(task);
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(page.getByRole("checkbox", { name: task })).toBeVisible();
  }
  expect(await findProblems(page)).toEqual([]);
});

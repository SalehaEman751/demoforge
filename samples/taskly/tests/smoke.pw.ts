import { expect, test } from "@playwright/test";

test("sign up and add one task", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Get started" }).click();
  await expect(page).toHaveURL(/\/signup$/);

  await page.getByLabel("Email").fill("demo@taskly.dev");
  await page.getByLabel("Password").fill("demo-password-123");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Welcome, demo@taskly.dev" })).toBeVisible();
  await expect(page.getByText("No tasks yet")).toBeVisible();

  await page.getByLabel("New task").fill("Record the demo video");
  await page.getByRole("button", { name: "Add task" }).click();

  await expect(page.getByRole("checkbox", { name: "Record the demo video" })).toBeVisible();
  await expect(page.getByText("No tasks yet")).toHaveCount(0);
});

test("?variant=renamed on /signup survives redirect: dashboard shows 'Add item'", async ({ page }) => {
  await page.goto("/signup?variant=renamed");
  await page.getByLabel("Email").fill("demo@taskly.dev");
  await page.getByLabel("Password").fill("demo-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("button", { name: "Add item" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add task" })).toHaveCount(0);

  await page.getByLabel("New task").fill("Heal me");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByRole("checkbox", { name: "Heal me" })).toBeVisible();
});

test("without the flag the button stays 'Add task'", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Email").fill("demo@taskly.dev");
  await page.getByLabel("Password").fill("demo-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("button", { name: "Add task" })).toBeVisible();
});

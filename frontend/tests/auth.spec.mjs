import { test, expect } from "@playwright/test";
import fs from "node:fs";

const credentialsPath = new URL("../../.local/dev-accounts.json", import.meta.url);
const accounts = fs.existsSync(credentialsPath) ? JSON.parse(fs.readFileSync(credentialsPath, "utf8")) : [];

test("five developer accounts are configured", () => {
  expect(accounts, "Run npm run dev:accounts in backend before browser tests.").toHaveLength(5);
});

async function fillAccount(page, account) {
  await page.getByText("Developer test accounts", { exact: true }).click();
  await page.getByRole("button", { name: new RegExp(account.name) }).click();
  await expect(page.locator('input[name="identifier"]')).toHaveValue(account.email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator('input[name="password"]').waitFor({ state: "visible" });
}

async function login(page, account) {
  await fillAccount(page, account);
  // Use action filling rather than assertions so passwords never appear in test reports.
  await page.locator('input[name="password"]').fill(account.password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  // Managed development accounts use email/password without a new-device code.
  await page.waitForURL(url => !url.pathname.startsWith("/login"), { timeout: 15000 });
}
test("visitors can browse; contributor routes return to login", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "All Artifacts" })).toBeVisible();
  const records = await request.get("http://localhost:3000/api/records");
  expect(records.status()).toBe(200);
  const data = await records.json();
  if (data.length) {
    await page.goto("/record/" + data[0].id);
    await expect(page.getByRole("heading", { name: data[0].title, exact: true })).toBeVisible();
  }
  for (const route of ["/create", "/profile", "/edit/example"]) {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp("/login\\?redirect="));
    expect(new URL(page.url()).searchParams.get("redirect")).toBe(route);
    await expect(page.getByRole("heading", { name: "Welcome back to the collection." })).toBeVisible();
  }
});

test("API denies anonymous contribution requests with JSON 401", async ({ request }) => {
  for (const [method, path] of [
    ["get", "/records/my"], ["post", "/records"], ["put", "/records/example"],
    ["delete", "/records/example"], ["post", "/collections"], ["post", "/users/sync"],
  ]) {
    const response = await request[method]("http://localhost:3000/api" + path, { data: {}, maxRedirects: 0 });
    expect(response.status()).toBe(401);
    expect((await response.json()).error).toBe("Sign in to continue");
  }
});

test("login is responsive and signup remains available", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    await expect(page.locator('input[name="identifier"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Every artifact has a story. Share yours." })).toBeVisible();
  await expect(page.locator('input[name="emailAddress"]')).toBeVisible();
});

test("incorrect password stays on login", async ({ page }) => {
  test.skip(!accounts.length, "Run the backend dev:accounts script first.");
  await page.goto("/login");
  await fillAccount(page, accounts[0]);
  await page.locator('input[name="password"]').fill("This-is-not-the-account-password-123!");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".cl-formFieldErrorText")).toBeVisible();
  expect(new URL(page.url()).pathname).toContain("/login");
});

for (const account of accounts) {
  test(account.name + " signs in, reaches profile, and signs out", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/profile");
    await login(page, account);
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole("heading", { name: "My Records" })).toBeVisible();
    await page.getByRole("link", { name: "New Record", exact: true }).click();
    await expect(page.getByRole("heading", { name: "New Record" })).toBeVisible();
    await page.locator(".cl-userButtonTrigger").click();
    await page.getByText("Sign out", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "All Artifacts" })).toBeVisible();
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/login\?redirect=/);
    expect(errors).toEqual([]);
  });
}

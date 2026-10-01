import { test, expect } from "@playwright/test";
import fs from "node:fs";

const credentialsPath = new URL("../../.local/dev-accounts.json", import.meta.url);
const accounts = fs.existsSync(credentialsPath) ? JSON.parse(fs.readFileSync(credentialsPath, "utf8")) : [];
const apiUrl = process.env.E2E_API_URL || "http://localhost:3000/api";

test("five developer accounts are configured", () => {
  expect(accounts, "Run npm run dev:accounts in backend before browser tests.").toHaveLength(5);
});

async function fillAccount(page, account) {
  if (process.env.E2E_HOSTED) {
    await page.locator('input[name="identifier"]').fill(account.email);
  } else {
    await page.getByText("Developer test accounts", { exact: true }).click();
    await page.getByRole("button", { name: new RegExp(account.name) }).click();
  }
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
test("visitors are sent to login before any catalog page loads", async ({ page }) => {
  for (const route of ["/", "/collections", "/record/example", "/search", "/create", "/profile", "/edit/example"]) {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp("/login\\?redirect="));
    expect(new URL(page.url()).searchParams.get("redirect")).toBe(route);
    await expect(page.getByRole("heading", { name: "Welcome back to the collection." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "All Artifacts" })).toHaveCount(0);
  }
});

test("odd paths still require login or return API 401", async ({ page, request }) => {
  for (const route of ["/unknown/path", "/record/%2e%2e%2fsearch", "/collections//extra"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login\?redirect=/);
    await expect(page.getByRole("heading", { name: "Welcome back to the collection." })).toBeVisible();
  }
  for (const route of ["//records", "/records%2Fmy", "/unknown/%2e%2e/records"]) {
    const response = await request.get(apiUrl + route, { maxRedirects: 2 });
    expect(response.status()).toBe(401);
  }
});
test("API denies anonymous reads and writes with JSON 401", async ({ request }) => {
  for (const [method, path] of [
    ["get", "/access"], ["get", "/records"], ["get", "/records/example"],
    ["get", "/records/my"], ["get", "/collections"], ["get", "/collections/example"],
    ["post", "/records"], ["put", "/records/example"],
    ["delete", "/records/example"], ["post", "/collections"], ["post", "/users/sync"],
  ]) {
    const response = await request[method](apiUrl + path, { data: {}, maxRedirects: 0 });
    expect(response.status()).toBe(401);
    expect((await response.json()).error).toBe("Sign in to continue");
  }
});
test("login is responsive and signup follows environment policy", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    await expect(page.locator('input[name="identifier"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto("/signup");
  if (process.env.E2E_HOSTED) {
    await expect(page).toHaveURL(/\/login\?redirect=/);
    await expect(page.getByRole("heading", { name: "Welcome back to the collection." })).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { name: "Every artifact has a story. Share yours." })).toBeVisible();
    await expect(page.locator('input[name="emailAddress"]')).toBeVisible();
  }
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

test("hosted approved account reads the Neon catalog", async ({ page }) => {
  test.skip(!process.env.E2E_HOSTED, "Run this check against the Vercel deployment.");
  await page.goto("/");
  const responsePromise = page.waitForResponse(response =>
    response.url() === apiUrl + "/records" && response.request().method() === "GET");
  await login(page, accounts[0]);
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual([]);
  await expect(page.getByRole("heading", { name: "No artifact records available" })).toBeVisible();
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
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/login\?redirect=/);
    expect(errors).toEqual([]);
  });
}

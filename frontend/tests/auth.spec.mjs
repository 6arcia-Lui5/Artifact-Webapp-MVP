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
  const password = page.locator('input[name="password"]');
  const passwordMethod = page.getByRole("button", { name: "Sign in with your password", exact: true });
  await expect.poll(async () =>
    (await passwordMethod.isVisible()) || await password.isEditable({ timeout: 250 }).catch(() => false),
    { timeout: 15000 }).toBe(true);
  if (await passwordMethod.isVisible()) await passwordMethod.click();
  await expect(password).toBeEditable({ timeout: 15000 });
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
    ["get", "/records/my"], ["get", "/records/search?query=test"],
    ["get", "/object-types"], ["post", "/object-types"], ["post", "/records/import"],
    ["get", "/collections"], ["get", "/collections/example"],
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
    await expect(page.getByRole("heading", { name: "Create your account", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
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
  const records = await response.json();
  expect(Array.isArray(records)).toBe(true);
  if (records.length) {
    await expect(page.getByRole("heading", { name: records[0].itemName, exact: false }).first()).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { name: "No artifact records available" })).toBeVisible();
  }
});
test("search, record details and object types work with an approved account", async ({ page }) => {
  await page.goto("/");
  const catalogPromise = page.waitForResponse(response =>
    response.url() === apiUrl + "/records" && response.request().method() === "GET");
  await login(page, accounts[0]);
  const catalog = await catalogPromise;
  expect(catalog.status()).toBe(200);
  const records = await catalog.json();
  test.skip(!records.length, "Search needs an existing catalog record.");
  const record = records[0];

  await page.getByRole("link", { name: "Search", exact: true }).click();
  await page.getByPlaceholder("Search records...").fill(record.itemName);
  const searchPromise = page.waitForResponse(response =>
    response.url().startsWith(apiUrl + "/records/search?") && response.request().method() === "GET");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const search = await searchPromise;
  expect(search.status()).toBe(200);
  expect((await search.json()).some(result => result.id === record.id)).toBe(true);
  const result = page.locator(".card").filter({
    has: page.getByRole("heading", { name: record.itemName, exact: true }),
  }).first();
  await result.getByRole("button", { name: "View", exact: true }).click();
  await expect(page.getByRole("heading", { name: record.itemName, exact: true })).toBeVisible();
  await expect(page.locator("dd").filter({ hasText: record.museumName }).first()).toBeVisible();

  const typesPromise = page.waitForResponse(response =>
    response.url() === apiUrl + "/object-types" && response.request().method() === "GET");
  await page.getByRole("link", { name: "New Record", exact: true }).click();
  const types = await typesPromise;
  expect(types.status()).toBe(200);
  expect(Array.isArray(await types.json())).toBe(true);
  await expect(page.getByRole("heading", { name: "Manually enter a new record" })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toBeVisible();
});

test("museum links show real images while invalid sources have a visible fallback", async ({ page }) => {
  await page.goto("/");
  await login(page, accounts[0]);
  const museumImage = page.locator('img[src*="images.metmuseum.org/CRDImages/"]').first();
  await expect(museumImage).toBeVisible({ timeout: 20000 });
  await expect.poll(() => museumImage.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.getByText("Image unavailable", { exact: true }).first()).toBeVisible();
  expect(await page.locator('img[src="Colour photo"]').count()).toBe(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.E2E_CAPTURE) await page.screenshot({
      path: `../.local/artifact-images-${process.env.E2E_HOSTED ? "live" : "local"}-${width}.png`, fullPage: true,
    });
  }
});

test("the create form keeps image entry available and preserves input after a save error", async ({ page }) => {
  await page.goto("/create");
  const typesPromise = page.waitForResponse(response => response.url() === apiUrl + "/object-types");
  await login(page, accounts[0]);
  const types = await (await typesPromise).json();
  const field = label => page.locator(".form-control").filter({
    has: page.locator("label").filter({ hasText: label }),
  }).locator("input, textarea, select").first();
  for (const [label, value] of [
    ["Item Name", "Save verification"], ["Museum or Institute's Name", "Museum"],
    ["City", "City"], ["Country", "Country"], ["Museum or Institute Number", "123"],
    ["Date / Culture / Time Period", "6th century"], ["Materials", "Gold"], ["Dimensions", "10 cm"],
  ]) await field(label).fill(value);
  await page.getByRole("textbox", { name: "Object Type", exact: true }).fill(types[0].name);
  await page.getByRole("button", { name: types[0].name, exact: true }).click();
  const imageInput = page.getByPlaceholder("Direct image URL or Met Museum collection link");
  await expect(imageInput).toBeVisible();
  await imageInput.fill("https://www.metmuseum.org/art/collection/search/464070");
  let payload;
  await page.route(apiUrl + "/records", route => {
    if (route.request().method() !== "POST") return route.continue();
    payload = route.request().postDataJSON();
    return route.fulfill({ status: 400, contentType: "application/json",
      body: JSON.stringify({ error: "Choose an existing Object Type or create it before saving." }) });
  });
  await page.getByRole("button", { name: "Create Record", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Choose an existing Object Type");
  await expect(field("Item Name")).toHaveValue("Save verification");
  await expect(imageInput).toHaveValue("https://www.metmuseum.org/art/collection/search/464070");
  expect(payload.imageSourceUrl).toBe("https://www.metmuseum.org/art/collection/search/464070");
  expect(payload.imagery).toBe(false);
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
    await expect(page.getByRole("heading", { name: "Manually enter a new record" })).toBeVisible();
    await page.locator(".cl-userButtonTrigger").click();
    await page.getByText("Sign out", { exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/profile");
    await expect(page).toHaveURL(/\/login\?redirect=/);
    expect(errors).toEqual([]);
  });
}

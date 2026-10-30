import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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
  for (const route of ["/", "/collections", "/collections/example", "/record/example", "/search", "/create", "/profile", "/edit/example", "/import", "/review"]) {
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
    ["get", "/research/records"], ["get", "/research/export"], ["get", "/research/collections"],
    ["get", "/research/imports"], ["post", "/research/imports/preview"], ["get", "/research/storage/status"],
    ["get", "/research/access"], ["get", "/research/moderation"], ["get", "/research/roles"], ["post", "/research/records/00000000-0000-0000-0000-000000000001/moderate"],
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
    response.url().startsWith(apiUrl + "/research/records?") && response.request().method() === "GET");
  await login(page, accounts[0]);
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const { items: records, total, pageSize } = await response.json();
  expect(Array.isArray(records)).toBe(true);
  expect(records.length).toBeLessThanOrEqual(pageSize);
  expect(total).toBeGreaterThanOrEqual(records.length);
  if (records.length) {
    await expect(page.getByRole("heading", { name: records[0].itemName, exact: false }).first()).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { name: "No artifact records available" })).toBeVisible();
  }
});
test("search, record details and object types work with an approved account", async ({ page }) => {
  await page.goto("/");
  const catalogPromise = page.waitForResponse(response =>
    response.url().startsWith(apiUrl + "/research/records?") && response.request().method() === "GET");
  await login(page, accounts[0]);
  const catalog = await catalogPromise;
  expect(catalog.status()).toBe(200);
  const { items: records } = await catalog.json();
  test.skip(!records.length, "Search needs an existing catalog record.");
  const record = records[0];

  await page.getByRole("link", { name: "Search", exact: true }).click();
  await page.getByPlaceholder("Search records...").fill(record.itemName);
  const searchPromise = page.waitForResponse(response =>
    response.url().startsWith(apiUrl + "/research/records?") && new URL(response.url()).searchParams.get('q') === record.itemName && response.request().method() === "GET");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const search = await searchPromise;
  expect(search.status()).toBe(200);
  expect((await search.json()).items.some(result => result.id === record.id)).toBe(true);
  const result = page.locator(".card").filter({
    has: page.getByRole("heading", { name: record.itemName, exact: true }),
  }).first();
  await result.getByRole("link", { name: "View", exact: true }).click();
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

test("approved accounts can use the integrated ML bridge while anonymous callers are denied", async ({ page, request }) => {
  test.skip(!process.env.E2E_ML, "Set E2E_ML=1 when the integrated Python service is running.");
  const path = apiUrl + "/ml/check";
  const examples = JSON.parse(fs.readFileSync(new URL("../../ml/demo/examples.json", import.meta.url), "utf8"));
  const anonymous = await request.post(path, { data: examples[0] });
  expect(anonymous.status()).toBe(401);
  await page.goto("/");
  await login(page, accounts[0]);
  await expect(page.getByRole("heading", { name: "All Artifacts", exact: true })).toBeVisible();
  const token = await page.evaluate(() => window.Clerk.session.getToken());
  const response = await request.post(path, {
    headers: { Authorization: `Bearer ${token}` },
    data: examples[0],
  });
  expect(response.status()).toBe(200);
  const prediction = await response.json();
  expect(prediction.model).toContain("deep");
  expect(typeof prediction.region).toBe("string");
  expect(typeof prediction.date.year).toBe("number");
  expect(Array.isArray(prediction.flags)).toBe(true);
});

test("create, edit, reload and review multiple inscriptions against the real isolated database", async ({ page, request }) => {
  test.skip(!process.env.E2E_WRITE, "Run through backend test:workflow to isolate database writes.");
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const fixture = JSON.parse(fs.readFileSync(process.env.E2E_FIXTURE, "utf8"));
  const examples = JSON.parse(fs.readFileSync(new URL("../../ml/demo/examples.json", import.meta.url), "utf8"));
  await page.goto("/create");
  await login(page, accounts[0]);
  await expect(page.getByRole("heading", { name: "Manually enter a new record" })).toBeVisible();
  const token = await page.evaluate(() => window.Clerk.session.getToken());
  const headers = { Authorization: `Bearer ${token}` };
  // This guard must succeed before any artifact writes. Fixture IDs exist only
  // in the disposable schema created by the runner, never in public tables.
  const guard = await request.get(apiUrl + `/records/${fixture.ownId}`, { headers });
  expect(guard.status()).toBe(200);
  expect((await guard.json()).itemName).toBe("Sample catalog artifact");
  for (const [label, value] of [
    ["Item Name", "Workflow demo artifact"], ["Museum or Institute's Name", "Demo museum"],
    ["City", "Demo city"], ["Country", "Demo country"], ["Museum or Institute Number", "WORKFLOW-DEMO"],
    ["Date / Culture / Time Period", "201-500 CE"], ["Place of Production", "Sicilia"],
    ["Materials", "Gold"], ["Dimensions", "10 cm"],
  ]) await page.getByLabel(label).fill(value);
  await page.getByRole("textbox", { name: "Object Type", exact: true }).fill("Pendant");
  await page.getByRole("button", { name: "Pendant", exact: true }).click();
  await page.getByLabel("Inscribed?", { exact: true }).check();
  await page.getByLabel(/Original inscription text/).fill(examples[0].text);
  await page.getByLabel(/Language of inscription/).fill("Greek");
  await page.getByLabel(/Script used/).fill("Greek");
  await page.getByLabel(/Translation \(English\)/).fill("Demo translation");
  await page.getByRole("button", { name: "Add inscription", exact: true }).click();
  await page.getByLabel(/Original inscription text/).nth(1).fill("D M VIXIT");
  await page.getByLabel(/Language of inscription/).nth(1).fill("Latin");
  await page.getByLabel(/Script used/).nth(1).fill("Latin");
  const createResponse = page.waitForResponse(response => response.url() === apiUrl + "/records" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create Record", exact: true }).click();
  const createdResponse = await createResponse;
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();
  await expect(page).toHaveURL(new RegExp(`/record/${created.id}$`));
  await expect(page.getByText(examples[0].text, { exact: true })).toBeVisible();
  await expect(page.getByText("D M VIXIT", { exact: true })).toBeVisible();
  const before = await (await request.get(apiUrl + `/records/${created.id}`, { headers })).json();
  expect(before.inscriptions).toHaveLength(2);
  const ids = before.inscriptions.map(entry => entry.id).sort();
  const mlResponse = page.waitForResponse(response => response.url() === apiUrl + `/ml/records/${created.id}/check`);
  await page.getByRole("button", { name: "Run ML check", exact: true }).click();
  expect((await mlResponse).status()).toBe(200);
  await expect(page.getByText("Suggested date interval", { exact: true })).toBeVisible();
  const afterCheck = await (await request.get(apiUrl + `/records/${created.id}`, { headers })).json();
  expect(afterCheck.updatedAt).toBe(before.updatedAt);
  expect(afterCheck.dateCulturePeriod).toBe(before.dateCulturePeriod);
  expect(afterCheck.productionPlace).toBe(before.productionPlace);
  await page.screenshot({ path: path.join(os.tmpdir(), "artifact-workflow-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(os.tmpdir(), "artifact-workflow-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit artifact", exact: true })).toBeVisible();
  await expect(page.getByLabel(/Original inscription text/).first()).toHaveValue(examples[0].text);
  await page.getByLabel("Item Name").fill("Corrected workflow artifact");
  await page.getByLabel(/Translation \(English\)/).first().fill("Revised demo translation");
  const saveResponse = page.waitForResponse(response => response.url() === apiUrl + `/records/${created.id}` && response.request().method() === "PUT");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  expect((await saveResponse).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Corrected workflow artifact", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Revised demo translation", { exact: true })).toBeVisible();
  const saved = await (await request.get(apiUrl + `/records/${created.id}`, { headers })).json();
  expect(saved.inscriptions.map(entry => entry.id).sort()).toEqual(ids);
  expect(saved.inscriptions).toHaveLength(2);
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Corrected workflow artifact", exact: true })).toBeVisible();
  await page.goto(`/record/${created.id}`);
  await page.route(apiUrl + `/ml/records/${created.id}/check`, route => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "ML service unavailable" }) }));
  await page.getByRole("button", { name: "Run ML check", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your artifact is unchanged");
  await page.unroute(apiUrl + `/ml/records/${created.id}/check`);
  await page.getByRole("button", { name: "Run ML check", exact: true }).click();
  await expect(page.getByText("Suggested date interval", { exact: true })).toBeVisible();
  const count = (await (await request.get(apiUrl + "/records", { headers })).json()).length;
  const invalid = await request.post(apiUrl + "/records", { headers, data: {
    ...saved, inscriptions: [{ content: "", language: "Greek", script: "Greek" }],
  } });
  expect(invalid.status()).toBe(400);
  expect((await (await request.get(apiUrl + "/records", { headers })).json()).length).toBe(count);
});

test("another approved account cannot edit an artifact or its inscriptions", async ({ page, request }) => {
  test.skip(!process.env.E2E_WRITE, "Requires the isolated database runner.");
  const fixture = JSON.parse(fs.readFileSync(process.env.E2E_FIXTURE, "utf8"));
  await page.goto(`/edit/${fixture.ownId}`);
  await login(page, accounts[1]);
  await expect(page.getByRole("heading", { name: "Editing is limited to the creator or an administrator", exact: true })).toBeVisible();
  const token = await page.evaluate(() => window.Clerk.session.getToken());
  const headers = { Authorization: `Bearer ${token}` };
  const response = await request.put(apiUrl + `/records/${fixture.ownId}`, { headers, data: { itemName: "Should not save", inscriptions: [] } });
  expect(response.status()).toBe(403);
  const existing = await (await request.get(apiUrl + `/records/${fixture.ownId}`, { headers })).json();
  expect(existing.itemName).toBe("Sample catalog artifact");
  expect(existing.inscriptions).toHaveLength(1);
});

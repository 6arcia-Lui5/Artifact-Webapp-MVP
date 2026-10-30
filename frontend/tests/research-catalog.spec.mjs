import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '../..');
const api = process.env.E2E_API_URL || 'http://localhost:3307/api';
const enabled = process.env.E2E_WRITE === '1' && process.env.E2E_RESEARCH === '1';

async function headers(page) {
  const token = await page.evaluate(() => window.Clerk.session.getToken());
  return { Authorization: `Bearer ${token}` };
}
async function login(page) {
  const account = JSON.parse(fs.readFileSync(path.join(root, '.local/dev-accounts.json'), 'utf8'))[0];
  await page.goto('/');
  await page.locator('input[name="identifier"]').fill(account.email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const password = page.locator('input[name="password"]');
  const passwordMethod = page.getByRole('button', { name: 'Sign in with your password', exact: true });
  await expect.poll(async () => (await passwordMethod.isVisible()) || await password.isEditable({ timeout: 250 }).catch(() => false)).toBe(true);
  if (await passwordMethod.isVisible()) await passwordMethod.click();
  await password.fill(account.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All Artifacts', exact: true })).toBeVisible({ timeout: 20000 });
  return JSON.parse(fs.readFileSync(process.env.E2E_FIXTURE, 'utf8'));
}

test.beforeEach(() => test.skip(!enabled, 'Requires the explicitly isolated research workflow database.'));

test('original inscriptions are searchable, filters survive reload and exports retain the original text', async ({ page, request }) => {
  test.setTimeout(90000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const fixture = await login(page);
  const originalResponse = await request.get(`${api}/records/${fixture.ownId}`, { headers: await headers(page) });
  expect(originalResponse.status()).toBe(200);
  const original = await originalResponse.json();
  const word = original.inscriptions[0].content.trim().split(/\s+/)[0];
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search records', exact: true }).fill(word);
  await page.getByLabel('Language', { exact: true }).fill('Greek');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: original.itemName, exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('q')).toBe(word);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Search records', exact: true })).toHaveValue(word);
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('Greek');
  await page.getByRole('checkbox', { name: `Select ${original.itemName}`, exact: true }).check();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Selected JSON', exact: true }).click();
  const exported = JSON.parse(fs.readFileSync(await (await downloading).path(), 'utf8'));
  expect(exported).toHaveLength(1);
  expect(exported[0].inscriptions[0].content).toBe(original.inscriptions[0].content);
  await page.screenshot({ path: path.join(os.tmpdir(), 'artifact-research-search.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(os.tmpdir(), 'artifact-research-search-mobile.png'), fullPage: true });
  await page.getByLabel('Start year', { exact: true }).fill('500');
  await page.getByLabel('End year', { exact: true }).fill('-500');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /year|date/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test('collections organize readable records from different owners without deleting the artifacts', async ({ page, request }) => {
  test.setTimeout(90000);
  const fixture = await login(page);
  await page.getByRole('link', { name: 'Collections', exact: true }).click();
  await page.getByRole('button', { name: 'New collection', exact: true }).click();
  const title = `Epigraphic study ${Date.now()}`;
  await page.getByLabel('Title', { exact: true }).fill(title);
  const creating = page.waitForResponse(response => response.url() === `${api}/research/collections` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save collection', exact: true }).click();
  const response = await creating; expect(response.status()).toBe(201);
  const collection = await response.json();
  await page.goto('/search?q=Sample');
  await page.getByRole('checkbox', { name: 'Select all records on this page', exact: true }).check();
  await page.getByRole('combobox', { name: 'Your collection', exact: true }).selectOption(collection.id);
  await page.getByRole('button', { name: 'Add selected to collection', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /records added/ })).toBeVisible();
  await page.goto(`/collections/${collection.id}`);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sample catalog artifact', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sample artifact without an image', exact: true })).toBeVisible();
  const deleting = await request.delete(`${api}/research/collections/${collection.id}`, { headers: await headers(page) });
  expect(deleting.status()).toBe(204);
  for (const id of [fixture.ownId, fixture.foreignId]) expect((await request.get(`${api}/records/${id}`, { headers: await headers(page) })).status()).toBe(200);
});

test('import preview creates no artifacts, then imports a draft with literal original inscription and skips duplicates', async ({ page, request }) => {
  test.setTimeout(120000);
  await login(page);
  const name = `Inscribed study fragment ${Date.now()}`;
  const hhw = `STUDY-${Date.now()}`;
  const original = 'DIS MANIBVS';
  const csv = `Item Name,HHW,Materials,Original inscription,Language,Script,Translation\n${name},${hhw},Marble,${original},Latin,Latin,To the spirits of the dead\n`;
  await page.getByRole('link', { name: 'Import records', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'inscribed-fragment.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await page.getByRole('button', { name: 'Create preview', exact: true }).click();
  await expect(page.getByRole('heading', { name: /preview/i }).first()).toBeVisible();
  const absent = await request.get(`${api}/research/records`, { params: { q: hhw }, headers: await headers(page) });
  expect((await absent.json()).total).toBe(0);
  // Explicit mapping prevents descriptions/translations being mistaken for original text.
  for (const [column, field] of [['Original inscription', 'inscriptionContent'], ['Language', 'inscriptionLanguage'], ['Script', 'inscriptionScript'], ['Translation', 'inscriptionTranslation']]) {
    await page.getByRole('combobox', { name: column, exact: true }).selectOption(field);
  }
  const mappedPreview = page.waitForResponse(response => response.url() === `${api}/research/imports/preview` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create preview', exact: true }).click();
  const mappedResponse = await mappedPreview;
  expect(mappedResponse.status()).toBe(201);
  const mappedJob = await mappedResponse.json();
  await expect.poll(() => new URL(page.url()).searchParams.get('job')).toBe(mappedJob.id);
  await page.locator('summary').filter({ hasText: `Row 2: ${name}` }).click();
  await expect(page.getByText(original, { exact: false }).first()).toBeVisible();
  await page.getByRole('checkbox', { name: 'I confirm importing the selected new records.', exact: true }).check();
  await page.getByRole('button', { name: 'Start import', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: /job has finished|selected rows.*processed|selected.*imported/i }).first()).toBeVisible({ timeout: 30000 });
  const found = await request.get(`${api}/research/records`, { params: { q: hhw }, headers: await headers(page) });
  expect(found.status()).toBe(200);
  const { items, total } = await found.json(); expect(total).toBe(1);
  expect(items[0].reviewStatus).toBe('draft');
  expect(items[0].dimensions).toBeNull();
  expect(items[0].inscriptions[0].content).toBe(original);
  const duplicatePreview = await request.post(`${api}/research/imports/preview`, { headers: await headers(page), multipart: {
    file: { name: 'inscribed-fragment.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') },
    mapping: JSON.stringify({ 'Original inscription': 'inscriptionContent', Language: 'inscriptionLanguage', Script: 'inscriptionScript', Translation: 'inscriptionTranslation' }),
  } });
  expect(duplicatePreview.status()).toBe(201);
  const duplicateJob = await duplicatePreview.json();
  expect(Boolean(duplicateJob.rows[0].duplicateRecordId || duplicateJob.rows[0].duplicate)).toBe(true);
  const duplicateCommit = await request.post(`${api}/research/imports/${duplicateJob.id}/commit`, { headers: await headers(page), data: { skipDuplicates: true } });
  expect(duplicateCommit.status()).toBe(200);
  expect((await duplicateCommit.json()).importedCount).toBe(0);
  await page.goto(`/edit/${items[0].id}`);
  await expect(page.getByRole('checkbox', { name: 'Save as a draft with incomplete metadata', exact: true })).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Item Name', exact: true })).toHaveValue(name);
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/record/${items[0].id}$`));
  await page.getByLabel('Review notes', { exact: true }).fill('Original text checked against the uploaded research photograph.');
  await page.getByRole('combobox', { name: 'Review status', exact: true }).selectOption('reviewed');
  await page.getByRole('button', { name: 'Save review', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Review saved.' })).toBeVisible();
  await page.getByRole('button', { name: 'Show revision history', exact: true }).click();
  await page.locator('details').filter({ has: page.locator('summary').filter({ hasText: /review|update|insert/i }) }).first().locator('summary').click();
  await expect(page.getByText(/Actor:/).first()).toBeVisible();
});

test('private original photographs preserve uploaded bytes and obey ownership and storage accounting', async ({ page, request }) => {
  test.setTimeout(90000);
  const fixture = await login(page);
  await page.goto(`/record/${fixture.ownId}`);
  const gallery = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Artifact photographs', exact: true }) });
  await gallery.getByRole('combobox', { name: 'Add method', exact: true }).selectOption('upload');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAFCAIAAAD38zoCAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWPYtmoqVsRABwkAI1ZOSbSf3XgAAAAASUVORK5CYII=', 'base64');
  await gallery.locator('input[type="file"]').setInputFiles({ name: 'artifact-view.png', mimeType: 'image/png', buffer: png });
  await gallery.getByRole('textbox', { name: 'Caption or view description', exact: true }).fill('Reverse view');
  await gallery.getByRole('textbox', { name: 'License', exact: true }).fill('Research test fixture');
  await gallery.getByRole('checkbox', { name: 'I have permission to upload and store this original photograph.', exact: true }).check();
  const uploading = page.waitForResponse(response => response.url() === `${api}/research/records/${fixture.ownId}/images` && response.request().method() === 'POST');
  await gallery.getByRole('button', { name: 'Upload photograph', exact: true }).click();
  const uploaded = await uploading; expect(uploaded.status()).toBe(201);
  const image = await uploaded.json();
  await expect(gallery.getByRole('img', { name: 'Reverse view', exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await gallery.getByRole('button', { name: 'Download original', exact: true }).click();
  expect(fs.readFileSync(await (await downloading).path())).toEqual(png);
  const unauthorized = await request.get(`${api}/research/records/${fixture.ownId}/images/${image.id}/file`);
  expect(unauthorized.status()).toBe(401);
  const otherOwner = await request.post(`${api}/research/records/${fixture.foreignId}/images`, { headers: await headers(page), data: { sourceUrl: 'https://www.metmuseum.org/art/collection/search/256771' } });
  expect(otherOwner.status()).toBe(403);
  const status = await request.get(`${api}/research/storage/status`, { headers: await headers(page) });
  const storedBytes = (await status.json()).usedBytes;
  expect(storedBytes).toBeGreaterThanOrEqual(png.length);
  if (await gallery.getByRole('button', { name: 'Use as primary photograph', exact: true }).count()) {
    await gallery.getByRole('button', { name: 'Use as primary photograph', exact: true }).click();
    await expect(gallery.getByRole('button', { name: 'Reverse view (primary)', exact: true })).toBeVisible();
  }
  const listing = await request.get(`${api}/research/records`, { params: { ids: fixture.ownId }, headers: await headers(page) });
  expect((await listing.json()).items[0].primaryImage.id).toBe(image.id);
  await gallery.getByRole('button', { name: 'Remove photograph', exact: true }).click();
  await gallery.getByRole('button', { name: 'Confirm removal', exact: true }).click();
  await expect(gallery.getByRole('img', { name: 'Reverse view', exact: true })).toHaveCount(0);
  const after = await request.get(`${api}/research/storage/status`, { headers: await headers(page) });
  expect((await after.json()).usedBytes).toBeLessThan(storedBytes);
});

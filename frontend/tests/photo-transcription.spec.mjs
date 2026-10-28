import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '../..');
const api = process.env.E2E_API_URL || 'http://localhost:3000/api';
const enabled = process.env.E2E_WRITE === '1' && process.env.E2E_PHOTO === '1';
const reference = 'D M\nC PORCIO DIONYSIO\nVIXIT ANN VIII M X\nDIEBVS XIII\nC PORCIVS DIONYSIVS\nFILIO DVLCISSIMO\nFECIT';
const photoFile = name => path.join(root, '.local/ocr-evaluation/fixtures', name);
test.beforeEach(({ page }) => page.setDefaultTimeout(15000));

async function session(page, request) {
  const fixture = JSON.parse(fs.readFileSync(process.env.E2E_FIXTURE, 'utf8'));
  const account = JSON.parse(fs.readFileSync(path.join(root, '.local/dev-accounts.json'), 'utf8'))[0];
  await page.goto('/');
  await page.locator('input[name="identifier"]').fill(account.email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const password = page.locator('input[name="password"]');
  const passwordMethod = page.getByRole('button', { name: 'Sign in with your password', exact: true });
  await expect.poll(async () => (await passwordMethod.isVisible()) || await password.isEditable({ timeout: 250 }).catch(() => false), { timeout: 15000 }).toBe(true);
  if (await passwordMethod.isVisible()) await passwordMethod.click();
  await expect(password).toBeEditable({ timeout: 15000 });
  await password.fill(account.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'All Artifacts', exact: true })).toBeVisible();
  const token = await page.evaluate(() => window.Clerk.session.getToken());
  const headers = { Authorization: `Bearer ${token}` };
  const guard = await request.get(`${api}/records/${fixture.ownId}`, { headers });
  expect(guard.status()).toBe(200);
  const original = await guard.json();
  expect(original.itemName).toBe('Sample catalog artifact');
  return { fixture, original, headers };
}

async function openPanel(page, id) {
  await page.goto(`/edit/${id}`);
  await page.getByRole('button', { name: 'Transcribe a photo', exact: true }).click();
  const panel = page.locator('#photo-transcription-panel');
  await expect(panel.getByRole('combobox', { name: 'Recognition method', exact: true })).toBeEnabled();
  return panel;
}

test('real vision photo draft is corrected, appended and saved without replacing the existing inscription', async ({ page, request }) => {
  test.skip(!enabled, 'Requires local photo fixtures and the disposable database.');
  test.setTimeout(180000);
  const { original, headers } = await session(page, request);
  let created;
  try {
    const response = await request.post(`${api}/records`, { headers, data: {
      itemName: 'Photo transcription workflow', museumName: 'Test collection', museumCity: 'Test city', museumCountry: 'Test country',
      museumNumber: 'PHOTO-TRANSCRIPTION-E2E', objectTypeId: original.objectTypeId,
      dateCulturePeriod: '100-200 CE', productionPlace: 'Italia', materials: 'Marble', dimensions: '21.4 x 37 cm', inscribed: true,
      inscriptions: [{ content: 'Existing text remains', language: 'Latin', script: 'Latin', translation: '', serifsPresent: false, stopmarksPresent: false }],
    } });
    expect(response.status()).toBe(201);
    created = await response.json();
    const before = await (await request.get(`${api}/records/${created.id}`, { headers })).json();
    const panel = await openPanel(page, created.id);
    await panel.getByRole('combobox', { name: 'Recognition method', exact: true }).selectOption('vision');
    await panel.locator('input[type="file"]').setInputFiles(photoFile('met-256771.jpg'));
    await expect(panel.getByAltText('Inscription photo. The outlined area is selected for transcription.')).toBeVisible();
    await panel.getByRole('button', { name: 'Run transcription', exact: true }).click();
    const draft = panel.getByRole('textbox', { name: 'Original inscription text', exact: true });
    await expect(draft).toBeVisible({ timeout: 120000 });
    await expect(draft).toHaveValue(/PORCI/);
    const unchanged = await (await request.get(`${api}/records/${created.id}`, { headers })).json();
    expect(unchanged.inscriptions).toEqual(before.inscriptions);
    expect(unchanged.updatedAt).toBe(before.updatedAt);
    await draft.fill(reference);
    await panel.screenshot({ path: path.join(os.tmpdir(), 'artifact-photo-draft.png') });
    await page.setViewportSize({ width: 390, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.screenshot({ path: path.join(os.tmpdir(), 'artifact-photo-draft-mobile.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
    await panel.getByRole('button', { name: 'Add transcription', exact: true }).click();
    await expect(page.getByLabel(/Original inscription text \*/)).toHaveCount(2);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/record/${created.id}$`));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Inscription 2', exact: true })).toBeVisible();
    const saved = await (await request.get(`${api}/records/${created.id}`, { headers })).json();
    expect(saved.inscriptions).toHaveLength(2);
    expect(saved.inscriptions.find(entry => entry.id === before.inscriptions[0].id).content).toBe('Existing text remains');
    expect(saved.inscriptions.some(entry => entry.content === reference)).toBe(true);
  } finally {
    if (created?.id) expect((await request.delete(`${api}/records/${created.id}`, { headers })).status()).toBe(200);
  }
});

test('on-device OCR reads a control, cancels safely, and never adds text without an explicit action', async ({ page, request }) => {
  test.skip(!enabled, 'Requires local photo fixtures and the disposable database.');
  test.setTimeout(180000);
  const { fixture } = await session(page, request);
  const panel = await openPanel(page, fixture.ownId);
  await panel.getByRole('combobox', { name: 'Recognition method', exact: true }).selectOption('browser');
  await panel.locator('input[type="file"]').setInputFiles(photoFile('latin-control.png'));
  await panel.getByRole('button', { name: 'Run transcription', exact: true }).click();
  await panel.getByRole('button', { name: 'Cancel transcription', exact: true }).click();
  await expect(panel.getByText('Transcription cancelled. You can try again.', { exact: true })).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Original inscription text', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Run transcription', exact: true }).click();
  const draft = panel.getByRole('textbox', { name: 'Original inscription text', exact: true });
  await expect(draft).toHaveValue(/DIS MANIBVS/, { timeout: 120000 });
  await expect(page.getByLabel(/Original inscription text \*/)).toHaveCount(1);
  await panel.getByRole('combobox', { name: 'Recognition language', exact: true }).selectOption('grc');
  await expect(draft).toHaveCount(0);
  await expect(page.getByLabel(/Original inscription text \*/)).toHaveCount(1);
});

test('blank vision results cannot be applied and service outages preserve existing form input', async ({ page, request }) => {
  test.skip(!enabled, 'Requires local photo fixtures and the disposable database.');
  test.setTimeout(180000);
  const { fixture } = await session(page, request);
  const panel = await openPanel(page, fixture.ownId);
  await page.getByRole('textbox', { name: 'Item Name', exact: true }).fill('Unsaved artifact title');
  await panel.getByRole('combobox', { name: 'Recognition method', exact: true }).selectOption('vision');
  await panel.locator('input[type="file"]').setInputFiles(photoFile('blank-control.png'));
  await panel.getByRole('button', { name: 'Run transcription', exact: true }).click();
  await expect(panel.getByRole('textbox', { name: 'Original inscription text', exact: true })).toHaveValue('', { timeout: 120000 });
  await expect(panel.getByRole('button', { name: 'Add transcription', exact: true })).toBeDisabled();
  await page.route(`${api}/transcription`, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Photo transcription is unavailable.' }) }));
  await panel.getByRole('button', { name: 'Retry transcription', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Your artifact is unchanged');
  await expect(page.getByRole('textbox', { name: 'Item Name', exact: true })).toHaveValue('Unsaved artifact title');
  await expect(page.getByLabel(/Original inscription text \*/)).toHaveCount(1);
});

test('an existing museum image can be selected without uploading a local file', async ({ page, request }) => {
  test.skip(!enabled, 'Requires the disposable database and public museum image access.');
  const { fixture } = await session(page, request);
  await page.goto(`/edit/${fixture.ownId}`);
  await page.getByRole('textbox', { name: 'Image Source URL', exact: true }).fill('https://www.metmuseum.org/art/collection/search/256771');
  await page.getByRole('button', { name: 'Transcribe a photo', exact: true }).click();
  const panel = page.locator('#photo-transcription-panel');
  await panel.getByRole('button', { name: 'Use catalog image', exact: true }).click();
  const photo = panel.getByAltText('Inscription photo. The outlined area is selected for transcription.');
  await expect(photo).toBeVisible({ timeout: 30000 });
  expect(await photo.evaluate(image => image.naturalWidth)).toBeGreaterThan(600);
  await expect(panel.getByRole('button', { name: 'Run transcription', exact: true })).toBeEnabled();
  await panel.getByRole('combobox', { name: 'Recognition method', exact: true }).selectOption('vision');
  await panel.getByRole('button', { name: 'Run transcription', exact: true }).click();
  await expect(panel.getByRole('textbox', { name: 'Original inscription text', exact: true })).toHaveValue(/PORCI/, { timeout: 120000 });
  await expect(page.getByLabel(/Original inscription text \*/)).toHaveCount(1);
});

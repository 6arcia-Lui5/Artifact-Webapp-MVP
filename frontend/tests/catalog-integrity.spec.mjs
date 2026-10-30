import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const origin = process.env.E2E_FRONTEND_URL || 'http://localhost:5317';
const api = process.env.E2E_API_URL || 'http://localhost:3307/api';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAFCAIAAAD38zoCAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWPYtmoqVsRABwkAI1ZOSbSf3XgAAAAASUVORK5CYII=', 'base64');
async function login(browser, index) {
  const account = JSON.parse(fs.readFileSync(path.join(root, '.local/dev-accounts.json'), 'utf8'))[index];
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  await page.goto('/');
  await page.locator('input[name="identifier"]').fill(account.email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const password = page.locator('input[name="password"]');
  const method = page.getByRole('button', { name: 'Sign in with your password', exact: true });
  await expect.poll(async () => await method.isVisible() || await password.isEditable({ timeout: 250 }).catch(() => false), { timeout: 15000 }).toBe(true);
  if (await method.isVisible()) await method.click();
  await password.fill(account.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All Artifacts', exact: true })).toBeVisible({ timeout: 20000 });
  return { context, page, userId: account.userId };
}
async function auth(session) {
  return { Authorization: `Bearer ${await session.page.evaluate(() => window.Clerk.session.getToken())}` };
}
async function getRecord(request, session, id) {
  const response = await request.get(`${api}/records/${id}`, { headers: await auth(session) });
  expect(response.status()).toBe(200);
  return response.json();
}
async function approve(request, admin, id) {
  const current = await getRecord(request, admin, id);
  const response = await request.post(`${api}/research/records/${id}/moderate`, { headers: await auth(admin), data: {
    status: 'approved', notes: 'Source facts inspected; unknown properties remain explicitly documented.', expectedRevision: current.revision,
  } });
  expect(response.status()).toBe(200);
  expect((await response.json()).record.moderationStatus).toBe('approved');
}
test.beforeEach(() => test.skip(process.env.E2E_RESEARCH !== '1' || process.env.E2E_MODERATION !== '1', 'Requires the isolated research/moderation workflow.'));

test('concurrent admin edits cannot overwrite a researcher’s unsaved fields or deleted inscriptions', async ({ browser, request }) => {
  test.setTimeout(120000);
  const author = await login(browser, 0);
  const admin = await login(browser, 4);
  try {
    const creating = await request.post(`${api}/records`, { headers: await auth(author), data: {
      itemName: `Inscribed fragment ${Date.now()}`, saveAsDraft: true, inscribed: true,
      inscriptions: [{ content: 'D M', language: 'Latin', script: 'Latin', serifsPresent: false, stopmarksPresent: false }],
    } });
    expect(creating.status()).toBe(201);
    const created = await creating.json();
    await author.page.goto(`/edit/${created.id}`);
    const name = author.page.getByRole('textbox', { name: 'Item Name', exact: true });
    await expect(name).toHaveValue(created.itemName);
    const current = await getRecord(request, admin, created.id);
    const adminName = `${created.itemName} checked`;
    const change = await request.put(`${api}/records/${created.id}`, { headers: await auth(admin), data: {
      itemName: adminName, inscriptions: [], expectedRevision: current.revision,
    } });
    expect(change.status()).toBe(200);
    const unsaved = `${created.itemName} researcher notes`;
    await name.fill(unsaved);
    const saving = author.page.waitForResponse(response => response.url() === `${api}/records/${created.id}` && response.request().method() === 'PUT');
    await author.page.getByRole('button', { name: 'Save changes', exact: true }).click();
    expect((await saving).status()).toBe(409);
    await expect(name).toHaveValue(unsaved);
    await expect(author.page.getByRole('alert')).toContainText(/changed|latest/i);
    await expect(author.page.getByRole('link', { name: 'Open the latest saved record', exact: true })).toBeVisible();
    const stored = await getRecord(request, author, created.id);
    expect(stored.itemName).toBe(adminName);
    expect(stored.inscriptions).toHaveLength(0);
    expect(stored.userId).toBe(author.userId);
  } finally { await Promise.all([author.context.close(), admin.context.close()]); }
});

test('unknown source properties survive draft editing and photo changes require renewed approval', async ({ browser, request }) => {
  test.setTimeout(150000);
  const author = await login(browser, 0);
  const admin = await login(browser, 4);
  try {
    const literal = '\u03c7\u03b1\u1fd6\u03c1\u03b5\nD M';
    const creating = await request.post(`${api}/records`, { headers: await auth(author), data: {
      itemName: `Published inscription fragment ${Date.now()}`, saveAsDraft: true, inscribed: true, imagery: null,
      inscriptions: [{ content: literal, language: null, script: null, translation: null, serifsPresent: null, stopmarksPresent: null }],
    } });
    expect(creating.status()).toBe(201);
    const created = await creating.json();
    await author.page.goto(`/edit/${created.id}`);
    await expect(author.page.getByRole('checkbox', { name: 'Save as a draft with incomplete metadata', exact: true })).toBeChecked();
    await author.page.getByRole('textbox', { name: 'Item Name', exact: true }).fill(`${created.itemName} cataloged`);
    await author.page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(author.page).toHaveURL(new RegExp(`/record/${created.id}$`));
    const edited = await getRecord(request, author, created.id);
    expect(edited.inscriptions[0]).toMatchObject({ id: created.inscriptions[0].id, content: literal, language: null, script: null, translation: null, serifsPresent: null, stopmarksPresent: null });
    const review = await request.patch(`${api}/research/records/${created.id}/review`, { headers: await auth(author), data: { reviewStatus: 'reviewed', notes: 'Literal source text checked; script and physical markings remain unknown.' } });
    expect(review.status()).toBe(200);
    await author.page.goto(`/edit/${created.id}`);
    await expect(author.page.getByRole('textbox', { name: 'Item Name', exact: true })).toHaveValue(edited.itemName);
    await author.page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(author.page).toHaveURL(new RegExp(`/record/${created.id}$`));
    expect((await getRecord(request, author, created.id)).reviewStatus).toBe('reviewed');
    await approve(request, admin, created.id);
    const photograph = await request.post(`${api}/research/records/${created.id}/images`, { headers: await auth(author), multipart: {
      photo: { name: 'fragment.png', mimeType: 'image/png', buffer: png }, rightsConfirmed: 'true', caption: 'Obverse view',
    } });
    expect(photograph.status()).toBe(201);
    const image = await photograph.json();
    expect(await getRecord(request, author, created.id)).toMatchObject({ moderationStatus: 'pending', reviewStatus: 'reviewed', moderatedBy: null, moderatedAt: null });
    await approve(request, admin, created.id);
    const primary = await request.patch(`${api}/research/records/${created.id}/images/${image.id}`, { headers: await auth(author), data: { isPrimary: true } });
    expect(primary.status()).toBe(200);
    expect((await getRecord(request, author, created.id)).moderationStatus).toBe('pending');
    await approve(request, admin, created.id);
    const noChange = await request.patch(`${api}/research/records/${created.id}/images/${image.id}`, { headers: await auth(author), data: { isPrimary: true } });
    expect(noChange.status()).toBe(200);
    expect(await getRecord(request, author, created.id)).toMatchObject({ moderationStatus: 'approved', reviewStatus: 'reviewed' });
    const removing = await request.delete(`${api}/research/records/${created.id}/images/${image.id}`, { headers: await auth(author) });
    expect(removing.status()).toBe(204);
    expect(await getRecord(request, author, created.id)).toMatchObject({ moderationStatus: 'pending', reviewStatus: 'reviewed' });
  } finally { await Promise.all([author.context.close(), admin.context.close()]); }
});

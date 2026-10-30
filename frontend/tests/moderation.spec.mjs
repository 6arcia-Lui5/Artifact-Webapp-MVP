import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname, '../..');
const api = process.env.E2E_API_URL || 'http://localhost:3307/api';
const enabled = process.env.E2E_WRITE === '1' && process.env.E2E_MODERATION === '1';
const accounts = () => JSON.parse(fs.readFileSync(path.join(root, '.local/dev-accounts.json'), 'utf8'));
async function session(browser, index) {
  const context = await browser.newContext({ baseURL: process.env.E2E_FRONTEND_URL || 'http://localhost:5317' });
  const page = await context.newPage();
  const account = accounts()[index];
  await page.goto(process.env.E2E_FRONTEND_URL || 'http://localhost:5317');
  await page.locator('input[name="identifier"]').fill(account.email);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const password = page.locator('input[name="password"]');
  const passwordMethod = page.getByRole('button', { name: 'Sign in with your password', exact: true });
  await expect.poll(async () => (await passwordMethod.isVisible()) || await password.isEditable({ timeout: 250 }).catch(() => false), { timeout: 15000 }).toBe(true);
  if (await passwordMethod.isVisible()) await passwordMethod.click();
  await password.fill(account.password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All Artifacts', exact: true })).toBeVisible({ timeout: 20000 });
  return { context, page, userId: account.userId };
}
async function auth(session) {
  const token = await session.page.evaluate(() => window.Clerk.session.getToken());
  return { Authorization: `Bearer ${token}` };
}
test.beforeEach(() => test.skip(!enabled, 'Requires an isolated workflow schema and server-only test admin assignment.'));

test('pending submissions require a trusted decision, conceal private data and return to review after edits', async ({ browser, request }) => {
  test.setTimeout(180000);
  const opened = [];
  try {
    const author = await session(browser, 0); opened.push(author.context);
    const outsider = await session(browser, 1); opened.push(outsider.context);
    const admin = await session(browser, 4); opened.push(admin.context);
    const title = `Funerary research fragment ${Date.now()}`;
    const creating = await request.post(`${api}/records`, { headers: await auth(author), data: {
      itemName: title, saveAsDraft: true, inscribed: true, imagery: null,
      inscriptions: [{ content: 'DIS MANIBVS', language: 'Latin', script: 'Latin', translation: 'To the spirits of the dead', serifsPresent: false, stopmarksPresent: false }],
      moderationStatus: 'approved', moderatedBy: admin.userId, userId: admin.userId,
    } });
    expect(creating.status()).toBe(201);
    const created = await creating.json();
    expect(created.userId).toBe(author.userId);
    expect(created.moderationStatus).toBe('pending');
    const id = created.id;
    const image = await request.post(`${api}/research/records/${id}/images`, { headers: await auth(author), multipart: {
      photo: { name: 'private-fragment.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAFCAIAAAD38zoCAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWPYtmoqVsRABwkAI1ZOSbSf3XgAAAAASUVORK5CYII=', 'base64') },
      rightsConfirmed: 'true', caption: 'Private research photograph', license: 'Synthetic test fixture',
    } });
    expect(image.status()).toBe(201);
    const storedImage = await image.json();
    for (const suffix of [`/records/${id}`, `/research/records/${id}/images`, `/research/records/${id}/images/${storedImage.id}/file`, `/research/records/${id}/images/${storedImage.id}/file?thumbnail=1`, `/ml/records/${id}/check`, `/research/records/${id}/history`]) {
      expect((await request.get(api + suffix, { headers: await auth(outsider) })).status(), suffix).toBe(404);
    }
    const hidden = await request.get(`${api}/research/records`, { headers: await auth(outsider), params: { ids: id } });
    expect((await hidden.json()).total).toBe(0);
    const hiddenExport = await request.get(`${api}/research/export`, { headers: await auth(outsider), params: { ids: id, format: 'json' } });
    expect(await hiddenExport.json()).toEqual([]);
    expect((await request.post(`${api}/research/records/${id}/moderate`, { headers: await auth(author), data: { status: 'approved', notes: 'Own contributor approval must fail', expectedRevision: created.revision } })).status()).toBe(403);
    await author.page.goto(`/record/${id}`);
    await expect(author.page.getByText('Pending approval', { exact: true })).toBeVisible();
    await expect(author.page.getByRole('link', { name: 'Review submissions', exact: true })).toHaveCount(0);

    await admin.page.getByRole('link', { name: 'Review submissions', exact: true }).click();
    const roleSection = admin.page.locator('section').filter({ has: admin.page.getByRole('heading', { name: 'Manage trusted reviewers', exact: true }) });
    const roleRow = roleSection.locator('div.border-t').filter({ hasText: accounts()[3].userId });
    await roleRow.getByRole('combobox', { name: 'Role', exact: true }).selectOption('reviewer');
    await roleRow.getByRole('checkbox', { name: 'Confirm role change', exact: true }).check();
    const roleSaved = admin.page.waitForResponse(response => response.url() === `${api}/research/roles/${accounts()[3].userId}` && response.request().method() === 'PATCH');
    await roleRow.getByRole('button', { name: 'Save role', exact: true }).click();
    const roles = await roleSaved;
    expect(roles.status()).toBe(200);
    expect((await request.patch(`${api}/research/roles/${accounts()[1].userId}`, { headers: await auth(outsider), data: { role: 'admin' } })).status()).toBe(403);
    expect((await request.patch(`${api}/research/roles/${accounts()[3].userId}`, { headers: await auth(admin), data: { role: 'admin' } })).status()).toBe(400);
    const reviewer = await session(browser, 3); opened.push(reviewer.context);
    const access = await request.get(`${api}/research/access`, { headers: await auth(reviewer) });
    expect((await access.json()).role).toBe('reviewer');
    const reviewerOwnResponse = await request.post(`${api}/records`, { headers: await auth(reviewer), data: { itemName: `Reviewer study ${Date.now()}`, saveAsDraft: true } });
    expect(reviewerOwnResponse.status()).toBe(201);
    const reviewerOwn = await reviewerOwnResponse.json();
    expect((await request.post(`${api}/research/records/${reviewerOwn.id}/moderate`, { headers: await auth(reviewer), data: { status: 'approved', notes: 'A reviewer must not approve their own submission.', expectedRevision: reviewerOwn.revision } })).status()).toBe(403);
    await reviewer.page.getByRole('link', { name: 'Review submissions', exact: true }).click();
    const submission = reviewer.page.locator('article').filter({ has: reviewer.page.getByRole('heading', { name: title, exact: true }) });
    await expect(submission).toBeVisible();
    const before = await request.get(`${api}/records/${id}`, { headers: await auth(reviewer) });
    const current = await before.json();
    const stale = await request.post(`${api}/research/records/${id}/moderate`, { headers: await auth(reviewer), data: { status: 'approved', notes: 'Stale revision must not publish', expectedRevision: current.revision - 1 } });
    expect(stale.status()).toBe(409);
    // Use the rendered queue to make the real editorial decision.
    await submission.getByRole('combobox', { name: 'Editorial decision', exact: true }).selectOption('approved');
    await submission.getByRole('textbox', { name: /Decision notes/ }).fill('Source identity and original inscription inspected; reading uncertainty remains documented separately.');
    await submission.getByRole('checkbox').check();
    await reviewer.page.screenshot({ path: path.join(os.tmpdir(), 'artifact-moderation-queue.png'), fullPage: true });
    await reviewer.page.setViewportSize({ width: 390, height: 900 });
    expect(await reviewer.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await reviewer.page.screenshot({ path: path.join(os.tmpdir(), 'artifact-moderation-queue-mobile.png'), fullPage: true });
    await reviewer.page.setViewportSize({ width: 1280, height: 900 });
    await submission.getByRole('button', { name: 'Approve submission', exact: true }).click();
    await expect(submission).toHaveCount(0);
    const publishedResponse = await request.get(`${api}/records/${id}`, { headers: await auth(outsider) });
    expect(publishedResponse.status()).toBe(200);
    const published = await publishedResponse.json();
    expect(published.moderationStatus).toBe('approved');
    expect(published.moderatedBy).toBe(reviewer.userId);
    expect(published.userId).toBe(author.userId);
    const histories = await request.get(`${api}/research/records/${id}/history`, { headers: await auth(reviewer) });
    expect((await histories.json()).items.some(item => item.actorId === reviewer.userId)).toBe(true);
    const edited = await request.put(`${api}/records/${id}`, { headers: await auth(author), data: { itemName: `${title} corrected` } });
    expect(edited.status()).toBe(200);
    expect((await edited.json()).moderationStatus).toBe('pending');
    expect((await request.get(`${api}/records/${id}`, { headers: await auth(outsider) })).status()).toBe(404);
    const revoked = await request.patch(`${api}/research/roles/${reviewer.userId}`, { headers: await auth(admin), data: { role: 'contributor' } });
    expect(revoked.status()).toBe(200);
    expect((await request.get(`${api}/research/moderation`, { headers: await auth(reviewer) })).status()).toBe(403);
    expect((await request.get(`${api}/records/${id}`, { headers: await auth(reviewer) })).status()).toBe(404);
  } finally { await Promise.all(opened.map(context => context.close())); }
});

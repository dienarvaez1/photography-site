import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ROOT } from '../support/lib.js';
import { addLighthouseRuns, signInSettled } from '../support/browser.js';

const { RESULTS_API_URL } = await import(join(ROOT, 'src/config/results.ts'));
const RESULTS_ORIGIN = new URL(RESULTS_API_URL).origin;

const page = (world) => world.b.page;
const panel = (world) => page(world).locator('#panel-lighthouse-results');
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until the check passes (the viewer answers asynchronously). */
async function eventually(check, describe, timeout = 8000) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try {
      const result = await check();
      if (result !== false) return result;
      last = new Error('not yet');
    } catch (error) {
      last = error;
    }
    if (Date.now() > end) throw new Error(`${describe}: ${last?.message ?? last}`);
    await settle(100);
  }
}

// --- Setting the scene ------------------------------------------------------------------------------------------------

Given('the results bucket also holds these Lighthouse runs:', async function (table) {
  await addLighthouseRuns(this, table.hashes().map((row) => ({ time: row.time, commit: row.commit, phone: Number(row.phone), laptop: Number(row.laptop) })));
});

Given('the results bucket holds no Lighthouse runs', function () {
  const { objects } = this.b.results.bucket;
  for (const key of [...objects.keys()]) if (key.startsWith('lighthouse-results/')) objects.delete(key);
});

// --- Doing things ----------------------------------------------------------------------------------------------------

const gateField = (world) => page(world).locator('#admin-token');

When('I sign in to the Lighthouse Test Results tab with the token {string}', async function (token) {
  await gateField(this).waitFor({ state: 'visible', timeout: 8000 });
  await gateField(this).fill(token);
  await gateField(this).press('Enter');
  await signInSettled(this);
});

const runLinks = (world) => panel(world).locator('.results-runs a.lighthouse-run');

When('I open the Lighthouse run for commit {string}', async function (commit) {
  await runLinks(this).filter({ hasText: commit }).first().click();
  await panel(this).locator('.results-run-heading').waitFor({ state: 'visible', timeout: 8000 });
});

When('I click the Lighthouse {string} link', async function (name) {
  await panel(this).getByRole('link', { name, exact: true }).click();
});

// --- What the tab shows ------------------------------------------------------------------------------------------------

Then('the Lighthouse Test Results tab should ask for the admin token', async function () {
  await gateField(this).waitFor({ state: 'visible', timeout: 8000 });
  await page(this).getByLabel('Admin token').waitFor({ state: 'visible' });
  assert.equal(await page(this).locator('[data-tabs]').isHidden(), true, 'the tabs stay hidden until the token is accepted');
});

Then('the Lighthouse Test Results tab should say {string}', async function (text) {
  // Signed out (a refused token, the idle timeout), the tab is hidden and the page's token box says it instead.
  await panel(this).or(page(this).locator('[data-admin-gate]')).getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 8000 });
});

Then('the results API should not have been asked for any Lighthouse run', async function () {
  await settle(300);
  assert.deepEqual(this.b.results.requests.filter((r) => r.path.startsWith('/lighthouse')).map((r) => r.path), []);
});

Then('the latest Lighthouse run should be shown as commit {string}, {string}, with {string}', async function (commit, status, totals) {
  const card = panel(this).locator('.results-latest a.lighthouse-run');
  await card.waitFor({ state: 'visible', timeout: 8000 });
  const text = await card.innerText();
  assert.ok(text.includes(commit), text);
  assert.equal(await card.locator('.results-badge').innerText(), status);
  assert.ok(text.includes(totals), text);
});

Then('the Lighthouse runs should be listed newest first, for the commits {string}', async function (commits) {
  const expected = commits.split(', ');
  await eventually(async () => (await runLinks(this).count()) === expected.length, `${expected.length} runs listed`);
  const shown = await runLinks(this).locator('.run-what').allInnerTexts();
  assert.deepEqual(shown.map((t) => t.split(' ')[0]), expected);
});

Then('the Lighthouse run for commit {string} should be shown as {string}, with {string}', async function (commit, status, totals) {
  const link = runLinks(this).filter({ hasText: commit }).first();
  assert.equal(await link.locator('.results-badge').innerText(), status);
  assert.ok((await link.innerText()).includes(totals));
});

Then("the address should be that Lighthouse run's own address", async function () {
  const runId = this.b.results.lighthouseRunIds.find((id) => id.includes('aaaaaaa'));
  assert.ok(page(this).url().endsWith(`#lighthouse-results/run/${runId}`), page(this).url());
});

Then('the Lighthouse run should list, in order: {string}', async function (list) {
  const rows = panel(this).locator('.lighthouse-table tbody tr');
  const expected = list.split(', ');
  await eventually(async () => (await rows.count()) === expected.length, 'every measurement listed');
  const shown = await rows.evaluateAll((trs) => trs.map((tr) => {
    const cells = [...tr.querySelectorAll('th, td')].map((c) => c.textContent.trim());
    // Page, device, performance, …, budget (the second-to-last column).
    return `${cells[0]} ${cells[1]} ${cells[2]} ${cells.at(-2)}`;
  }));
  assert.deepEqual(shown, expected);
});

Then('the Lighthouse run should say what was over budget: {string} on {string}', async function (miss, where) {
  const item = panel(this).locator('.results-failure', { hasText: miss }).first();
  await item.waitFor({ state: 'visible', timeout: 8000 });
  assert.equal(await item.locator('h4').innerText(), miss);
  assert.ok((await item.locator('p').innerText()).includes(where));
});

Then('every Lighthouse report link should be a signed link to the results API that opens in a new tab', async function () {
  const links = await panel(this).locator('.lighthouse-table a').evaluateAll((as) => as.map((a) => ({ href: a.href, target: a.target, rel: a.rel })));
  assert.equal(links.length, 3);
  for (const link of links) {
    const url = new URL(link.href);
    assert.equal(url.origin, RESULTS_ORIGIN);
    assert.match(url.pathname, /^\/lighthouse\/files\/[^/]+\/(mobile|desktop)-[a-z0-9-]+\.html$/);
    assert.match(url.searchParams.get('sig') ?? '', /^[0-9a-f]{64}$/);
    assert.equal(link.target, '_blank');
    assert.ok(link.rel.includes('noopener'));
  }
});

Then("the run's index page and raw data should be linked, with how long the links last", async function () {
  const files = panel(this).locator('.results-files a');
  const hrefs = await files.evaluateAll((as) => as.map((a) => new URL(a.href).pathname));
  assert.ok(hrefs.some((p) => p.endsWith('/index.html')), hrefs);
  assert.ok(hrefs.some((p) => p.endsWith('/summary.json')), hrefs);
  assert.ok((await panel(this).locator('.results-hint', { hasText: 'minutes' }).first().innerText()).includes('15 minutes'));
});

Then('the Lighthouse run should say {string}', async function (text) {
  await panel(this).getByText(text, { exact: true }).waitFor({ state: 'visible', timeout: 8000 });
});

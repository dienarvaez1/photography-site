import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { ROOT } from '../support/lib.js';
import { runsFromRows } from '../support/results-fixtures.js';
import { setUpResultsApi } from '../support/browser.js';

const { RESULTS_API_URL } = await import(join(ROOT, 'src/config/results.ts'));
const RESULTS_ORIGIN = new URL(RESULTS_API_URL).origin;

const page = (world) => world.b.page;
const panel = (world) => page(world).locator('#panel-test-results');
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

// --- Setting the scene ----------------------------------------------------------------------------------------

Given('the results API holds the admin token {string} and these published runs:', async function (token, table) {
  await setUpResultsApi(this, token, runsFromRows(table.hashes()));
});

Given('the results API holds the admin token {string} and no published runs', async function (token) {
  await setUpResultsApi(this, token, []);
});

Given('the results API has no admin token set up', function () {
  delete this.b.results.env.ADMIN_TOKEN;
});

Given('the results API cannot be reached', function () {
  this.b.results.mode = 'unreachable';
});

Given('the results API hands out a link to another site for {string}', function (file) {
  this.b.results.foreignLink = file;
});

When('the results API comes back', function () {
  this.b.results.mode = 'ok';
});

When("the results API's admin token is changed to {string}", function (token) {
  this.b.results.env.ADMIN_TOKEN = token;
});

// --- Doing things -------------------------------------------------------------------------------------------------

const gateField = (world) => panel(world).locator('#results-token');

async function signIn(world, token) {
  await gateField(world).fill(token);
  await gateField(world).press('Enter');
}

When('I sign in with the token {string}', async function (token) {
  await signIn(this, token);
});

When('I type the token {string} into the focused token field and press Enter', async function (token) {
  // Reached with the keyboard alone: Tab until the token field has focus.
  for (let i = 0; i < 60 && (await page(this).evaluate(() => document.activeElement?.id)) !== 'results-token'; i++) await page(this).keyboard.press('Tab');
  assert.equal(await page(this).evaluate(() => document.activeElement?.id), 'results-token', 'the token field is reachable with Tab');
  await page(this).keyboard.type(token);
  await page(this).keyboard.press('Enter');
});

When('I reload the page', async function () {
  this.b.results.markAtReload = this.b.results.requests.length;
  await page(this).reload();
});

When('I click {string} in the Test Results tab', async function (name) {
  await panel(this).getByRole('button', { name, exact: true }).click();
});

When('I open the run with commit {string} from the list', async function (commit) {
  await panel(this).locator('.results-runs a.results-run', { hasText: commit }).click();
  await panel(this).locator('.results-run-heading').waitFor({ state: 'visible', timeout: 8000 });
});

When('I open the latest run card', async function () {
  await panel(this).locator('.results-latest a.results-run').click();
  await panel(this).locator('.results-run-heading').waitFor({ state: 'visible', timeout: 8000 });
});

When('I go back in the browser', async function () {
  await page(this).goBack();
});

When(/^I click the "([^"]+)" link$/, async function (name) {
  await panel(this).getByRole('link', { name, exact: true }).click();
});

When('I focus the run with commit {string} and press Enter', async function (commit) {
  await panel(this).locator('.results-runs a.results-run', { hasText: commit }).focus();
  await page(this).keyboard.press('Enter');
  await panel(this).locator('.results-run-heading').waitFor({ state: 'visible', timeout: 8000 });
});

When('I open the address {string} in this page', async function (path) {
  await page(this).goto(`${this.b.siteOrigin}${path}`);
});

When('I click the report link {string}', async function (name) {
  const link = panel(this).getByRole('link', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')}`) });
  [this.b.popup] = await Promise.all([this.b.context.waitForEvent('page'), link.click()]);
  await this.b.popup.waitForLoadState('load');
});

When('I show the Test Results tab in its {string} state', async function (state) {
  if (state === 'wrong token') {
    await signIn(this, 'definitely-the-wrong-one');
    await panel(this).getByRole('alert').waitFor({ state: 'visible' });
  } else if (state !== 'sign-in') {
    await signIn(this, 'browser-test-admin-token');
    await panel(this).locator('.results-runs').waitFor({ state: 'visible', timeout: 8000 });
    if (state === 'passing run' || state === 'failing run') {
      await panel(this).locator('.results-runs a.results-run', { hasText: state === 'passing run' ? 'ccccccc' : 'bbbbbbb' }).click();
      await panel(this).locator('.results-run-heading').waitFor({ state: 'visible', timeout: 8000 });
      await panel(this).locator('.results-artifact img').first().waitFor({ state: 'attached' }).catch(() => {});
    }
  }
});

// --- What the tab shows ----------------------------------------------------------------------------------------

Then('the Test Results tab should ask for the admin token', async function () {
  await gateField(this).waitFor({ state: 'visible', timeout: 8000 });
  await panel(this).getByLabel('Admin token').waitFor({ state: 'visible' });
  await panel(this).getByRole('button', { name: 'Show results' }).waitFor({ state: 'visible' });
});

Then('the Test Results tab should ask for the token in Spanish', async function () {
  await panel(this).getByLabel('Token de administrador').waitFor({ state: 'visible', timeout: 8000 });
  await panel(this).getByRole('button', { name: 'Mostrar resultados' }).waitFor({ state: 'visible' });
});

Then('the Test Results tab should say {string}', async function (text) {
  await panel(this).getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 8000 });
});

Then(/^the Test Results tab should show ((?:"[^"]+"(?:, | and )?)+)$/, async function (list) {
  for (const [, text] of list.matchAll(/"([^"]+)"/g)) await panel(this).getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 8000 });
});

Then('the results API should not have been asked for anything', async function () {
  await settle(500);
  assert.deepEqual(this.b.results.requests, []);
});

Then('the results API should not have been asked for anything since the reload', async function () {
  await settle(800);
  assert.deepEqual(this.b.results.requests.slice(this.b.results.markAtReload), []);
});

Then('the browser should not remember any token', async function () {
  const stored = await page(this).evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }));
  assert.doesNotMatch(stored, /wrong|browser-test-admin-token|admin-token/);
});

Then('the latest run should be shown as commit {string}, Passed, with {string}', async function (commit, totals) {
  const card = panel(this).locator('.results-latest');
  await card.waitFor({ state: 'visible', timeout: 8000 });
  await eventually(async () => {
    const text = await card.innerText();
    return text.includes(commit) && text.includes('Passed') && text.includes(totals);
  }, `the latest card should show ${commit}, Passed, ${totals}`);
});

Then('the list of all runs should show the commits {string} in that order', async function (commits) {
  const items = panel(this).locator('.results-runs .run-what');
  await eventually(async () => (await items.count()) === commits.split(', ').length, 'the runs list');
  const shown = (await items.allInnerTexts()).map((t) => t.split(' ')[0]);
  assert.deepEqual(shown, commits.split(', '));
});

Then('the results API should have been asked only for {string} and {string}, each with the token in the Authorization header', function (a, b) {
  const asked = this.b.results.requests.filter((r) => r.method === 'GET');
  assert.deepEqual(asked.map((r) => r.path).sort(), [a, b].sort());
  for (const r of asked) assert.equal(r.authorization, `Bearer ${this.b.results.token}`);
});

Then('the token should not appear in any address', async function () {
  const token = this.b.results.token;
  assert.ok(!page(this).url().includes(token));
  for (const r of this.b.results.requests) assert.ok(!r.url.includes(token), r.url);
});

const runIdOfAddress = (world) => decodeURIComponent(new URL(page(world).url()).hash.split('/')[2] ?? '');

Then('the address should show that run', async function () {
  const hash = new URL(page(this).url()).hash;
  assert.match(hash, /^#test-results\/run\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-[a-z0-9]+-local$/);
});

Then(/^the run's details should show the commit "([^"]+)", (Passed|Failed) and "([^"]+)"$/, async function (commit, status, totals) {
  const heading = panel(this).locator('.results-run-heading');
  await heading.waitFor({ state: 'visible', timeout: 8000 });
  assert.match(await heading.innerText(), new RegExp(status));
  assert.equal(await panel(this).locator('.results-totals').innerText(), totals);
  assert.match(await panel(this).locator('.results-meta').first().innerText(), new RegExp(commit));
});

Then('the results API should have been asked for that run, with the token in the Authorization header', function () {
  const runId = runIdOfAddress(this);
  const asked = this.b.results.requests.filter((r) => r.method === 'GET' && r.path === `/runs/${runId}`);
  assert.equal(asked.length, 1, `asked for /runs/${runId}`);
  assert.equal(asked[0].authorization, `Bearer ${this.b.results.token}`);
});

Then(/^the "([^"]+)" tab should be the selected one$/, async function (name) {
  await eventually(async () => (await page(this).getByRole('tab', { name, exact: true }).getAttribute('aria-selected')) === 'true', `${name} tab selected`);
});

Then('there should be an {string} link', async function (name) {
  await panel(this).getByRole('link', { name, exact: true }).waitFor({ state: 'visible', timeout: 8000 });
});

Then("keyboard focus should be on the run's heading", async function () {
  await eventually(async () => (await page(this).evaluate(() => document.activeElement?.className ?? '')).includes('results-run-heading'), 'focus on the run heading');
});

Then('the suites table should show these rows:', async function (table) {
  const suites = panel(this).locator('section', { has: page(this).locator('#results-suites-heading') }).locator('.results-table');
  await suites.waitFor({ state: 'visible', timeout: 8000 });
  const rows = await suites.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent)));
  for (const expected of table.hashes()) {
    const row = rows.find((r) => r[0] === expected.Suite);
    assert.ok(row, `no row for ${expected.Suite}: ${JSON.stringify(rows)}`);
    assert.deepEqual([row[1], row[2], row[3], row[5]], [expected.Scenarios, expected.Passed, expected.Failed, expected.Steps]);
  }
});

Then('the features of the {string} suite should list {string} with {int} scenarios, {int} passed and {int} failed', async function (suite, feature, scenarios, passed, failed) {
  const details = panel(this).locator('details.results-features', { hasText: suite }).first();
  await details.locator('summary').click();
  const row = details.locator('tbody tr', { has: page(this).locator('th', { hasText: feature }) });
  const cells = await row.locator('td').allInnerTexts();
  assert.deepEqual(cells, [String(scenarios), String(passed), String(failed)]);
});

Then('the slowest scenarios of the {string} suite should be listed by name', async function (suite) {
  const group = panel(this).locator('section', { has: page(this).locator('h3', { hasText: 'Slowest scenarios' }) }).locator('div', { has: page(this).locator('h4', { hasText: suite }) }).first();
  const items = await group.locator('li').allInnerTexts();
  assert.ok(items.length > 0, 'some slowest scenarios');
  for (const item of items) assert.match(item, /^[\d.]+ (ms|s|min)\b.* · (passed|failed) scenario \d+$/);
});

Then('the run should show no missing values such as {string}, {string} or {string}', async function (a, b, c) {
  const text = await panel(this).innerText();
  for (const junk of [a, b, c, 'NaN']) assert.ok(!text.includes(junk), `the run shows "${junk}"`);
});

Then("the run's failures should say {string}", async function (text) {
  await panel(this).locator('.results-none').filter({ hasText: text }).waitFor({ state: 'visible' });
});

Then('the failures should list the scenario {string} of the feature {string} with the reason {string}', async function (scenario, feature, reason) {
  const failure = panel(this).locator('.results-failure').first();
  await failure.waitFor({ state: 'visible', timeout: 8000 });
  assert.equal(await failure.locator('h4').innerText(), scenario);
  assert.match(await failure.locator('dl').innerText(), new RegExp(feature.replace('.', '\\.')));
  assert.ok((await failure.locator('pre').innerText()).includes(reason), 'the reason is shown as written');
});

Then('nothing from the results should have been treated as page markup', async function () {
  assert.equal(await page(this).evaluate(() => window.__xss), undefined, 'injected script ran');
  assert.equal(await panel(this).locator('.results-failure img').count(), 0, 'an <img> was created from result text');
});

Then('every report link should open in a new tab without giving the new page access to this one', async function () {
  const links = panel(this).locator('.results-files a');
  assert.ok((await links.count()) >= 5, 'two reports and raw data for each suite');
  for (const attrs of await links.evaluateAll((as) => as.map((a) => ({ target: a.target, rel: a.rel })))) {
    assert.equal(attrs.target, '_blank');
    assert.match(attrs.rel, /noopener/);
    assert.match(attrs.rel, /noreferrer/);
  }
});

Then('the run should show no link to another site, and no report link for that file', async function () {
  await panel(this).locator('.results-files').waitFor({ state: 'visible', timeout: 8000 });
  assert.equal(await panel(this).locator('a[href*="evil.example"]').count(), 0);
  assert.equal(await panel(this).getByRole('link', { name: /^Open report \(Offline\)/ }).count(), 0);
  assert.ok((await panel(this).getByRole('link', { name: /^Open report \(Browser\)/ }).count()) > 0, 'the other reports are still offered');
});

Then('every file link should lead to the results API, with no token in it', async function () {
  const urls = await panel(this).locator('.results-files a, .results-artifact a, .results-artifact img').evaluateAll((els) => els.map((e) => e.href ?? e.src));
  assert.ok(urls.length >= 5);
  for (const url of urls) {
    assert.equal(new URL(url).origin, RESULTS_ORIGIN);
    assert.match(new URL(url).pathname, /^\/files\//);
    assert.ok(!url.includes(this.b.results.token));
  }
});

Then('a new tab should show the stored report {string}', async function (text) {
  const popup = this.b.popup;
  assert.equal(new URL(popup.url()).origin, RESULTS_ORIGIN);
  await eventually(async () => (await popup.locator('body').innerText()).includes(text), `the report shows "${text}"`);
});

Then('a new tab should be refused with the error {string}', async function (error) {
  const popup = this.b.popup;
  await eventually(async () => (await popup.locator('body').innerText()).includes(`"error":"${error}"`), `the new tab shows the error ${error}`);
});

const evidence = (world, slug) => panel(world).locator('.results-artifact', { hasText: slug });

Then('the evidence for {string} should show its screenshot, loaded, with a description', async function (slug) {
  const image = evidence(this, slug).locator('img');
  await image.scrollIntoViewIfNeeded();
  await eventually(async () => (await image.evaluate((img) => img.complete && img.naturalWidth > 0)) === true, 'the screenshot loads');
  assert.match(await image.getAttribute('alt'), new RegExp(`Screenshot of the failed scenario ${slug}`));
});

Then('the evidence for {string} should offer the trace as a download and the log as a link', async function (slug) {
  const item = evidence(this, slug);
  assert.equal(await item.getByRole('link', { name: /^Trace \(zip\)/ }).getAttribute('download'), '');
  assert.ok(await item.getByRole('link', { name: /^Log/ }).isVisible());
});

// --- Checks on the whole page ---------------------------------------------------------------------------------------------

Then('the page should pass the automated accessibility audit', async function () {
  const { violations } = await new AxeBuilder({ page: page(this) }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  assert.deepEqual(violations.map((v) => `${v.id} (${v.impact}): ${v.nodes[0].target.join(' ')}`), []);
});

Then('the page should not scroll sideways', async function () {
  const overflow = await page(this).evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `${overflow}px wider than the screen`);
});

Then('nothing but the site and the results API should have been requested', function () {
  assert.deepEqual(this.b.blocked, []);
});

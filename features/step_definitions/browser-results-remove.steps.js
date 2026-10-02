import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ROOT } from '../support/lib.js';
import { startResultsService } from '../support/browser.js';

const page = (world) => world.b.page;
// Whichever results tab is showing: Test Results or Lighthouse Test Results (the same Remove Results on both).
const panel = (world) => page(world).locator('#panel-test-results:visible, #panel-lighthouse-results:visible');
const bar = (world) => panel(world).locator('[data-remove-bar]');
const boxes = (world) => panel(world).locator('.results-runs input.run-check');
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The checkbox of the run with this commit (each fixture run has its own commit). */
const boxOf = (world, commit) => panel(world).locator('.results-runs li', { hasText: commit }).locator('input.run-check');

Given('the local results service is running', async function () {
  await startResultsService(this);
});

Given('deleting files of {string} fails in the results bucket', function (fragment) {
  this.b.results.bucket.faults.failDeleteMatching = fragment;
});

When(/^I press "([^"]+)" in the (?:Lighthouse )?Test Results tab$/, async function (name) {
  await panel(this).getByRole('button', { name, exact: true }).click();
});

When('I press {string} in the removal bar', async function (name) {
  await bar(this).getByRole('button', { name, exact: true }).click();
});

When('I tick the runs {string}', async function (commits) {
  for (const commit of commits.split(', ')) await boxOf(this, commit).check();
});

Then('no run should have a checkbox', async function () {
  await settle(200);
  assert.equal(await boxes(this).count(), 0);
});

Then('every run in the list should have a checkbox, none ticked', async function () {
  await boxes(this).first().waitFor({ state: 'visible', timeout: 8000 });
  const rows = await panel(this).locator('.results-runs li').count();
  assert.equal(await boxes(this).count(), rows);
  assert.deepEqual(await boxes(this).evaluateAll((all) => all.map((b) => b.checked)), Array(rows).fill(false));
  // Each one is named after its run, for a screen reader.
  for (const label of await boxes(this).evaluateAll((all) => all.map((b) => b.getAttribute('aria-label')))) assert.match(label, /^Select the run \S+ for removal$/);
});

Then('every run in the list should be ticked', async function () {
  assert.ok((await boxes(this).evaluateAll((all) => all.map((b) => b.checked))).every(Boolean));
});

Then(/^the removal bar should say "([^"]+)", with "([^"]+)" (available|unavailable)$/, async function (count, button, state) {
  await bar(this).locator('.pics-remove-count').filter({ hasText: count }).waitFor({ state: 'visible', timeout: 8000 });
  assert.equal(await bar(this).getByRole('button', { name: button, exact: true }).isDisabled(), state === 'unavailable');
});

Then('the removal bar should ask {string}', async function (question) {
  await bar(this).locator('.pics-remove-warning').filter({ hasText: question }).waitFor({ state: 'visible', timeout: 8000 });
});

Then('the confirmation should name the runs {string}', async function (commits) {
  const named = await bar(this).locator('.pics-remove-named li').allInnerTexts();
  assert.equal(named.length, commits.split(', ').length);
  commits.split(', ').forEach((commit, i) => assert.ok(named[i].includes(commit), `${named[i]} names ${commit}`));
});

Then('{string} should have the keyboard focus', async function (name) {
  assert.equal(await page(this).evaluate(() => document.activeElement?.textContent?.trim()), name);
});

Then('the local results service should not have been asked to remove anything', async function () {
  await settle(200);
  assert.deepEqual(this.b.resultsService.requests.filter((r) => r.method === 'POST'), []);
});

Then('no file of the runs {string} should be left in the results bucket', function (commits) {
  const keys = [...this.b.results.bucket.objects.keys()];
  for (const commit of commits.split(', ')) assert.deepEqual(keys.filter((k) => k.includes(`-${commit}-`)), [], commit);
});

Given(/^a Lighthouse run of production (ends with pages over budget|never ends)$/, function (how) {
  this.b.resultsService.outcome = how === 'never ends' ? 'never' : 'over budget';
});

Then('Lighthouse should have measured the production site {int} time(s)', async function (times) {
  const { PRODUCTION_URL } = await import(join(ROOT, 'scripts/lib/results-form.mjs'));
  await settle(200);
  assert.deepEqual(this.b.resultsService?.measured ?? [], Array(times).fill(PRODUCTION_URL));
});

Then(/^"([^"]+)" should be (available|unavailable)(?: again)? in the (?:Lighthouse )?Test Results tab$/, async function (name, state) {
  const button = panel(this).getByRole('button', { name, exact: true });
  await button.waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(await button.isDisabled(), state === 'unavailable');
});

Then(/^the (?:Lighthouse )?Test Results tab should come to say "([^"]+)"$/, async function (text) {
  await panel(this).getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 15000 });
});

Then('no file of the Lighthouse runs {string} should be left in the results bucket', function (commits) {
  const keys = [...this.b.results.bucket.objects.keys()].filter((k) => k.startsWith('lighthouse-results/runs/'));
  for (const commit of commits.split(', ')) assert.deepEqual(keys.filter((k) => k.includes(`-${commit}-`)), [], commit);
});

Then('the test results should be untouched', function () {
  assert.ok([...this.b.results.bucket.objects.keys()].some((k) => k.startsWith('results/runs/') && k.includes('-ccccccc-')));
});

Then(/^the (?:Lighthouse )?Test Results tab's buttons above the list should be "([^"]+)"$/, async function (names) {
  const toolbar = panel(this).locator('.results-remove-toolbar');
  await toolbar.waitFor({ state: 'visible', timeout: 8000 });
  assert.deepEqual(await toolbar.getByRole('button').allInnerTexts(), names.split(', '));
});

Given(/^the CI run (fails|is never done)$/, function (how) {
  this.b.resultsService.ciAnswers = how === 'fails' ? [{ status: 'in_progress', conclusion: '' }, { status: 'completed', conclusion: 'failure' }] : [{ status: 'in_progress', conclusion: '' }];
});

Given('starting a CI run fails with {string}', function (message) {
  this.b.resultsService.ciFailure = message;
});

Then('the CI workflow should have been started {int} time(s)', async function (times) {
  await settle(200);
  assert.equal(this.b.resultsService?.ciStarted ?? 0, times);
});

Then('the Test Results tab should link to the CI run', async function () {
  const link = panel(this).getByRole('link', { name: 'Open the run on GitHub' });
  await link.first().waitFor({ state: 'visible', timeout: 8000 });
  assert.equal(await link.first().getAttribute('href'), 'https://github.com/dienarvaez1/photography-site/actions/runs/777');
  assert.equal(await link.first().getAttribute('target'), '_blank');
});

Then('the results API should come to have been asked for {string} {int} times', async function (path, times) {
  const end = Date.now() + 8000;
  const count = () => this.b.results.requests.filter((r) => r.method === 'GET' && r.path === path).length;
  while (count() < times && Date.now() < end) await settle(100);
  assert.equal(count(), times);
});

Given('the local results service misses the next {int} checks on the CI run', function (count) {
  this.b.resultsService.missChecks = count;
});

When('the dev server restarts while the CI run is going', async function () {
  // A restarted service starts with no CI run: it forgot the one it was following.
  const end = Date.now() + 8000;
  while (!this.b.resultsService.requests.some((r) => r.method === 'POST' && r.path === 'tests/run') && Date.now() < end) await settle(50);
  await startResultsService(this);
});

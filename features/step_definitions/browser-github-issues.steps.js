import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { setUpGitHub, signInSettled } from '../support/browser.js';
import { fakeGitHub } from '../support/github-fixtures.js';

const page = (world) => world.b.page;
const panel = (world) => page(world).locator('#panel-github-issues');
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const issueCards = (world) => panel(world).locator('.issue-list .issue');

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

Given('GitHub holds these issues of {string}:', function (repo, table) {
  setUpGitHub(this, fakeGitHub(table.hashes(), { repo }), repo);
});

Given('GitHub holds no open issues', function () {
  const { github } = this.b.results;
  github.issues = github.issues.filter((issue) => issue.state !== 'open');
});

Given(/^GitHub is (rate-limited|unreachable) for the Admin page$/, function (mode) {
  this.b.results.github.mode = mode;
});

// --- Doing things ----------------------------------------------------------------------------------------------------

const gateField = (world) => page(world).locator('#admin-token');

When('I sign in to the GitHub Issues tab with the token {string}', async function (token) {
  await gateField(this).waitFor({ state: 'visible', timeout: 8000 });
  await gateField(this).fill(token);
  await gateField(this).press('Enter');
  await signInSettled(this);
});

When('I show the {string} issues', async function (name) {
  const button = panel(this).getByRole('group').getByRole('button', { name, exact: true });
  await button.click();
  await eventually(async () => (await panel(this).getByRole('group').getByRole('button', { name, exact: true }).getAttribute('aria-pressed')) === 'true' && !(await panel(this).locator('.results-loading').count()), `the "${name}" issues shown`);
});

// --- What the tab shows ------------------------------------------------------------------------------------------------

Then('the GitHub Issues tab should ask for the admin token', async function () {
  await gateField(this).waitFor({ state: 'visible', timeout: 8000 });
  await page(this).getByLabel('Admin token').waitFor({ state: 'visible' });
  assert.equal(await page(this).locator('[data-tabs]').isHidden(), true, 'the tabs stay hidden until the token is accepted');
});

Then('the results API should not have been asked for the issues', async function () {
  await settle(300);
  assert.deepEqual(this.b.results.requests.filter((r) => r.path.startsWith('/github')).map((r) => r.path), []);
  assert.deepEqual(this.b.results.github.calls, []);
});

Then('the GitHub Issues tab should list {string}', async function (list) {
  const expected = list.split(', ');
  const titles = async () => issueCards(this).evaluateAll((cards) => cards.map((card) => {
    const meta = card.querySelector('.issue-meta').textContent;
    const title = card.querySelector('.issue-title').firstChild.textContent;
    return `${meta.split(' ')[0]} ${title}`;
  }));
  await eventually(async () => JSON.stringify(await titles()) === JSON.stringify(expected), `issues listed as ${list} (shown: ${JSON.stringify(await titles().catch(() => []))})`);
});

Then('the GitHub Issues tab should say {string}', async function (text) {
  // Signed out (a refused token, the idle timeout), the tab is hidden and the page's token box says it instead.
  await panel(this).or(page(this).locator('[data-admin-gate]')).getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 8000 });
});

const cardOf = (world, number) => issueCards(world).filter({ hasText: `#${number} ` }).first();

Then(/^issue (\d+) should show "([^"]+)", "([^"]+)" and (?:the labels "([^"]+)"|no labels)$/, async function (number, status, comments, labels) {
  const card = cardOf(this, number);
  await card.waitFor({ state: 'visible', timeout: 8000 });
  assert.equal(await card.locator('.issue-state').innerText(), status);
  assert.ok((await card.locator('.issue-meta').innerText()).includes(comments));
  const shown = await card.locator('.issue-label').allInnerTexts();
  assert.deepEqual(shown, labels ? labels.split(', ') : []);
});

Then('every issue should link to GitHub in a new tab', async function () {
  const links = await issueCards(this).locator('a.issue-title').evaluateAll((as) => as.map((a) => ({ href: a.href, target: a.target, rel: a.rel })));
  assert.ok(links.length > 0);
  for (const link of links) {
    assert.match(link.href, /^https:\/\/github\.com\/owner\/site\/issues\/\d+$/);
    assert.equal(link.target, '_blank');
    assert.ok(link.rel.includes('noopener'));
  }
});

Then('the tab should link to {string} at {string}', async function (name, href) {
  const link = panel(this).getByRole('link', { name: new RegExp(`^${name}`) });
  assert.equal(await link.getAttribute('href'), href);
});

Then('the Open, Closed and All filter should still be offered', async function () {
  const names = await panel(this).getByRole('group').getByRole('button').allInnerTexts();
  assert.deepEqual(names, ['Open', 'Closed', 'All']);
  assert.equal(await gateField(this).count(), 0, 'still signed in');
});

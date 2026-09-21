import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';

const page = (world) => world.b.page;
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

Given("the page clock is under the test's control", function () {
  this.b.clock = true;
});

Given('the browser blocks session storage', function () {
  this.b.initScripts.push(() => {
    Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('Storage is blocked', 'SecurityError'); } });
  });
});

When(/^(\d+) minutes?(?: and (\d+) seconds?)? pass(?:es)? with nobody touching the page$/, async function (minutes, seconds) {
  await page(this).clock.runFor((Number(minutes) * 60 + Number(seconds ?? 0)) * 1000);
  await settle(150); // let the page draw what the timers did
});

When(/^the person (moves the mouse|presses a key|scrolls the page|clicks on the page heading)$/, async function (activity) {
  const p = page(this);
  if (activity === 'moves the mouse') await p.mouse.move(300 + Math.round(Math.random() * 50), 400);
  else if (activity === 'presses a key') await p.keyboard.press('Shift');
  else if (activity === 'scrolls the page') await p.mouse.wheel(0, 120);
  else await p.locator('.admin h1').click();
  await settle(100);
});

When('the person taps the page heading', async function () {
  await page(this).locator('.admin h1').tap();
  await settle(100);
});

When('the page reloads its results by itself', async function () {
  // What the page does without anyone there: it asks the API again (it is not a person being there).
  await page(this).evaluate(() => window.dispatchEvent(new Event('admin-refresh')));
  await settle(300);
});

When('the browser had been away from the page for {int} minutes', async function (minutes) {
  await page(this).evaluate((ms) => sessionStorage.setItem('admin-token-seen', String(Date.now() - ms)), minutes * 60 * 1000);
});

Then('the results API should not have been asked for anything more', async function () {
  await settle(300);
  assert.equal(this.b.results.requests.length, this.b.results.mark);
});

Then('the Test Results tab should not mention being signed out for inactivity', async function () {
  await settle(300);
  assert.equal(await page(this).locator('#panel-test-results .results-notice').count(), 0);
});

Then('the reminder should be a status message for screen readers', async function () {
  const notice = page(this).locator('#panel-test-results .results-notice');
  await notice.waitFor({ state: 'visible', timeout: 8000 });
  assert.equal(await notice.getAttribute('role'), 'status');
});

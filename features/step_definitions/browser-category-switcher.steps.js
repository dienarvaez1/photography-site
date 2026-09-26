import { When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';

const page = (world) => world.b.page;

When('I click the category filter {string}', async function (label) {
  await page(this).locator('.filter-pill', { hasText: label }).click();
});

When('I choose {string} from the sort control', async function (label) {
  await page(this).locator('#gallery-sort').selectOption({ label });
  // The rebuild is async (it awaits the already-cached manifest); give it a tick to settle rather
  // than racing the next assertion against tiles that haven't been replaced yet.
  await page(this).waitForTimeout(50);
});

Then('the gallery heading should say {string}', async function (heading) {
  assert.equal(await page(this).locator('#work-heading').textContent(), heading);
});

Then('only one page navigation should have happened', function () {
  const seen = this.b.pageRequests;
  assert.equal(seen.length, 1, `expected exactly one page navigation, saw: ${seen.join(', ')}`);
});

Then('the manifest should have been fetched', function () {
  assert.ok(this.b.manifestRequests.length > 0, 'expected photos/index.json to have been requested');
});

Then('the gallery should show {int} photo(s)', async function (count) {
  await page(this).locator('.tile').nth(Math.max(count - 1, 0)).waitFor({ state: count > 0 ? 'attached' : 'detached', timeout: 8000 }).catch(() => {});
  assert.equal(await page(this).locator('.tile').count(), count);
});

Then('the first gallery tile should be titled {string}', async function (title) {
  const locator = page(this).locator('.tile').first();
  await page(this).waitForFunction(
    (expected) => document.querySelector('.tile')?.getAttribute('data-title') === expected,
    title,
    { timeout: 8000 }
  ).catch(() => {});
  assert.equal(await locator.getAttribute('data-title'), title);
});

Then('the sort control should be visible', async function () {
  await page(this).locator('#gallery-controls').waitFor({ state: 'visible', timeout: 8000 });
});

Then('the sort control should not be visible', async function () {
  assert.ok(!(await page(this).locator('#gallery-controls').isVisible()));
});

// Both component's <style> blocks are `is:global` specifically so their rules still apply to
// elements the category switcher builds with document.createElement() (Astro's default scoped CSS
// only matches elements carrying the data-astro-cid attribute it adds to server-rendered markup —
// an element built by client JS never gets one). A plain className/textContent check can't catch a
// regression back to scoped CSS (the class name would still be right; only the applied style
// wouldn't be), so these check the one thing that would actually break: real computed style.
Then('the current category pill should still be styled like a pill', async function () {
  const border = await page(this).locator('.filter-pill.is-current').evaluate((el) => getComputedStyle(el).borderStyle);
  assert.equal(border, 'solid', 'expected the pill\'s border to still apply (Astro\'s scoped CSS silently skips client-built elements)');
});

Then('the first gallery tile should still be styled like a tile', async function () {
  const height = await page(this).locator('.tile').first().evaluate((el) => getComputedStyle(el).height);
  assert.notEqual(height, 'auto', 'expected the tile\'s row-height rule to still apply (Astro\'s scoped CSS silently skips client-built elements)');
});

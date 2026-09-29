import { When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { checkBudget, measure } from '../support/lighthouse.js';

// "phone" / "laptop" in the scenarios; Lighthouse's own "mobile" / "desktop" presets underneath.
const DEVICES = { phone: 'mobile', laptop: 'desktop' };
const device = (name) => {
  const found = DEVICES[name];
  assert.ok(found, `Unknown device "${name}" (use phone or laptop)`);
  return found;
};
const lhrOf = (world) => {
  assert.ok(world.data.lighthouse, 'No page has been measured yet');
  return world.data.lighthouse;
};
// How the measured page does against its budget on this device (its exception, if it has one — see PAGE_EXCEPTIONS).
const misses = (world, name) => checkBudget(lhrOf(world), world.data.lighthousePage, device(name));
const describe = (world) => `${world.data.lighthousePage} on a ${world.data.lighthouseDevice}`;

// Minutes, not seconds: RUNS full Lighthouse runs of a live page, the first one also starting Chrome.
When('Lighthouse measures {string} on a {word}', { timeout: 10 * 60_000 }, async function (path, name) {
  this.data.lighthouse = await measure(path, device(name));
  this.data.lighthousePage = path;
  this.data.lighthouseDevice = name;
});

Then(/^its performance, accessibility, best practices and SEO scores should be within the (\w+) budget$/, function (name) {
  const found = misses(this, name).scores;
  assert.deepEqual(found, [], `${describe(this)}: ${found.join('; ')}`);
});

Then(/^its First Contentful Paint, Largest Contentful Paint, Total Blocking Time and Cumulative Layout Shift should be within the (\w+) budget$/, function (name) {
  const found = misses(this, name).metrics;
  assert.deepEqual(found, [], `${describe(this)}: ${found.join('; ')}`);
});

Then(/^its total download should be within the (\w+) budget$/, function (name) {
  const found = misses(this, name).bytes;
  assert.deepEqual(found, [], `${describe(this)}: ${found.join('; ')}`);
});

Then('it should log no errors in the browser console', function () {
  const found = misses(this, this.data.lighthouseDevice).console;
  assert.deepEqual(found, [], `${describe(this)} logs ${found.length} browser error(s)`);
});

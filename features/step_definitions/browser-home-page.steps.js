import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';

const page = (world) => world.b.page;
const eyebrowTop = (world, selector) => page(world).locator(selector).first().evaluate((el) => el.getBoundingClientRect().top);

When('I remember the tagline\'s height', async function () {
  this.data.taglineTop = await eyebrowTop(this, '.hero .eyebrow');
});

Then('the About page\'s eyebrow should be at the remembered height', async function () {
  const aboutTop = await eyebrowTop(this, '.about .eyebrow');
  assert.equal(aboutTop, this.data.taglineTop, `home tagline at ${this.data.taglineTop}px, About eyebrow at ${aboutTop}px`);
});

// --- Sections that fade in (src/lib/scroll-reveal.ts) -----------------------------------------------------------------

// Samples every [data-reveal] section on every frame for the first two seconds, from before the page's own scripts run:
// whether it was on screen, and its opacity. A fade (in or out) of something on screen shows up as a sample below 1.
Given('I watch every fading section\'s opacity while the page loads', function () {
  this.b.initScripts.push(() => {
    window.__revealSamples = [];
    const start = performance.now();
    const sample = () => {
      for (const el of document.querySelectorAll('[data-reveal]')) {
        const { top, bottom } = el.getBoundingClientRect();
        window.__revealSamples.push({ id: el.id || el.querySelector('h2')?.textContent, onScreen: top < innerHeight && bottom > 0, opacity: Number(getComputedStyle(el).opacity), t: Math.round(performance.now() - start) });
      }
      if (performance.now() - start < 2000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
});

Given('the browser window is {int} by {int} pixels', function (width, height) {
  this.b.viewportOverride = { width, height };
});

When('I wait for the page to settle', async function () {
  await page(this).waitForFunction(() => window.__revealSamples?.at(-1)?.t >= 1900, null, { timeout: 8000 }).catch(() => {});
});

const samplesOf = (world) => page(world).evaluate(() => window.__revealSamples ?? []);
const section = (world, heading) => page(world).locator('[data-reveal]', { has: page(world).locator('h2', { hasText: heading }) }).first();

Then('no section that was on screen should ever have been partly transparent', async function () {
  const samples = await samplesOf(this);
  assert.ok(samples.some((s) => s.onScreen), 'some fading section starts on screen, or this checks nothing');
  const faded = samples.filter((s) => s.onScreen && s.opacity < 1);
  assert.deepEqual(faded.slice(0, 5), [], `${faded.length} samples of an on-screen section below full opacity`);
});

Then('the {string} section should be out of sight and hidden', async function (heading) {
  const state = await section(this, heading).evaluate((el) => ({ top: el.getBoundingClientRect().top, height: innerHeight, opacity: getComputedStyle(el).opacity }));
  assert.ok(state.top >= state.height, `starts below the window: ${JSON.stringify(state)}`);
  assert.equal(state.opacity, '0');
});

Then('it should never have faded out', async function () {
  // Hidden straight away: once the script has hidden it, it is never seen part-way between visible and hidden.
  const samples = await samplesOf(this);
  const partly = samples.filter((s) => s.opacity > 0 && s.opacity < 1);
  assert.deepEqual(partly.slice(0, 5), [], `${partly.length} samples part-way through a fade`);
});

When('I scroll the {string} section into view', async function (heading) {
  await section(this, heading).scrollIntoViewIfNeeded();
});

Then('the {string} section should become fully visible', async function (heading) {
  const target = section(this, heading);
  await target.evaluate((el) => new Promise((resolve) => {
    const done = () => getComputedStyle(el).opacity === '1';
    const check = () => (done() ? resolve() : requestAnimationFrame(check));
    check();
  }));
  assert.equal(await target.evaluate((el) => getComputedStyle(el).opacity), '1');
});


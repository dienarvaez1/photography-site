import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../support/lib.js';

const page = (world) => world.b.page;
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SELECTORS = {
  'outlined button': (name) => `a.btn:not(.btn-primary):text-is("${name}"), button.results-button:text-is("${name}")`,
  'filled button': (name) => `a.btn.btn-primary:text-is("${name}")`,
  'header link': (name) => `.primary-nav > a:text-is("${name}"), .primary-nav .nav-label:text-is("${name}")`,
  'filter pill': (name) => `a.filter-pill:text-is("${name}")`,
  'Portfolio item': (name) => `.nav-dropdown a:text-is("${name}")`,
  'menu button': (name) => `.nav-action:text-is("${name}")`,
};

/** What the highlight is made of, and the accent as the browser writes colors. */
const look = (locator) =>
  locator.evaluate((el) => {
    const css = getComputedStyle(el);
    const probe = document.createElement('span');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    document.body.append(probe);
    const gold = getComputedStyle(probe).color;
    probe.remove();
    return { background: css.backgroundColor, shadow: css.boxShadow, filter: css.filter, gold };
  });

When(/^I hover over the (outlined button|filled button|header link|filter pill|Portfolio item|menu button) "([^"]+)"$/, async function (what, name) {
  const target = page(this).locator(SELECTORS[what](name)).first();
  if (what === 'Portfolio item') {
    // In the dropdown: at rest with the pointer on "Portfolio" (which keeps the dropdown open), then on the item.
    await page(this).locator('.nav-group > a, .nav-group > button').first().hover();
  } else {
    await page(this).mouse.move(1, 1);
  }
  await target.waitFor({ state: 'visible', timeout: 8000 });
  await settle(250);
  this.b.hoverRest = await look(target);
  await target.hover();
  await settle(250); // the highlight fades in
  this.b.hovered = await look(target);
});

Then(/^it should take the hover highlight: (a tinted face and a gold bar|a gold ring|a tinted face and a gold ring)$/, function (expected) {
  const { hoverRest: rest, hovered } = this.b;
  if (expected.includes('tinted face')) assert.notEqual(hovered.background, rest.background, `the face changes: ${rest.background} → ${hovered.background}`);
  // Along the bottom: an inset shadow pushed up (0 -3px), never one at the left (3px 0).
  if (expected.includes('bar')) assert.ok(/inset/.test(hovered.shadow) && /0px -[23]px/.test(hovered.shadow) && !/ 3px 0px 0px 0px/.test(hovered.shadow), `a bar along the bottom: ${hovered.shadow}`);
  if (expected.includes('ring')) assert.ok(/0px 0px 0px 3px/.test(hovered.shadow), `a ring: ${hovered.shadow}`);
  assert.notEqual(hovered.shadow, rest.shadow, 'nothing like it at rest');
});

Then('the hover highlight should only apply where a pointer can hover', function () {
  // Every hover rule for the shared highlight sits inside @media (hover: hover), which a phone doesn't match.
  for (const file of ['src/styles/global.css', 'src/components/Header.astro', 'src/components/Gallery.astro', 'src/pages/[...lang]/work/[category].astro', 'src/pages/[...lang]/admin.astro']) {
    const css = readFileSync(join(ROOT, file), 'utf-8');
    for (const match of css.matchAll(/var\(--hover-(?:face|bar|ring)\)/g)) {
      const before = css.slice(0, match.index);
      const opened = before.lastIndexOf('@media (hover: hover)');
      assert.ok(opened >= 0, `${file}: the highlight is outside @media (hover: hover)`);
    }
  }
});

When('I open the Portfolio dropdown', async function () {
  await page(this).locator('#nav-work-toggle').hover();
  await page(this).locator('#nav-work-dropdown a').first().waitFor({ state: 'visible', timeout: 8000 });
  await settle(250);
});

Then('every item in the Portfolio dropdown should start its words where "Portfolio" starts', async function () {
  const { label, items } = await page(this).evaluate(() => {
    const textLeft = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().left;
    };
    return { label: textLeft(document.querySelector('#nav-work-toggle')), items: [...document.querySelectorAll('#nav-work-dropdown a')].map(textLeft) };
  });
  assert.ok(items.length > 1);
  for (const left of items) assert.ok(Math.abs(left - label) <= 1, `an item's words start at ${left} px, "Portfolio" at ${label} px`);
});

Then('its background should be the same color as {string} when highlighted', async function (name) {
  const link = page(this).locator(`.primary-nav > a:text-is("${name}")`).first();
  await link.hover();
  await settle(250);
  const about = (await look(link)).background;
  assert.equal(this.b.hovered.background, about, `highlighted background ${this.b.hovered.background}, ${name} ${about}`);
});

Then('the header should show only the gold signature logo, centred and whole', async function () {
  await page(this).waitForLoadState('networkidle');
  const info = await page(this).evaluate(() => {
    const logo = document.querySelector('.brand-logo');
    const r = logo.getBoundingClientRect();
    return { images: document.querySelectorAll('.site-header img').length, src: new URL(logo.src).pathname, loaded: logo.complete && logo.naturalWidth > 0, x: r.x, width: r.width, height: r.height, ratio: logo.naturalWidth / logo.naturalHeight, viewport: innerWidth };
  });
  assert.equal(info.images, 1, 'no aperture logo beside it');
  assert.equal(info.src, '/logo.png');
  assert.ok(info.loaded, 'the logo loaded');
  assert.ok(Math.abs(info.width / info.height - info.ratio) < 0.02, 'not stretched');
  assert.ok(Math.abs(info.x + info.width / 2 - info.viewport / 2) < 2, `centred: ${info.x + info.width / 2} vs ${info.viewport / 2}`);
});

When('the window is {int} pixels wide', async function (width) {
  await page(this).setViewportSize({ width, height: 800 });
  await settle(300);
});

Then('the top menu should show every item on one line, {word} apart, clear of the logo, with the logo at full size', async function (gap) {
  if (/\/admin\//.test(page(this).url())) await page(this).waitForFunction(() => !document.querySelector('[data-admin-actions]').hidden);
  const r = await page(this).evaluate(() => {
    const items = [...document.querySelectorAll('#primary-nav > a, #primary-nav .nav-label, #primary-nav [data-admin-actions]:not([hidden]) .nav-action')];
    const boxes = items.map((el) => el.getBoundingClientRect());
    const logo = document.querySelector('.brand-logo');
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return {
      names: items.map((e) => e.textContent.trim()),
      lines: items.map((e) => e.getClientRects().length),
      middles: boxes.map((b) => Math.round(b.y + b.height / 2)),
      firstLeft: boxes[0].x,
      gap: parseFloat(getComputedStyle(document.getElementById('primary-nav')).columnGap) / rem,
      logo: { right: logo.getBoundingClientRect().right, width: logo.getBoundingClientRect().width, natural: (logo.naturalWidth / logo.naturalHeight) * logo.getBoundingClientRect().height },
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  assert.ok(r.names.length >= 3, r.names.join(', '));
  assert.deepEqual(r.lines, r.names.map(() => 1), `each on one line: ${r.names.join(', ')}`);
  assert.ok(Math.max(...r.middles) - Math.min(...r.middles) <= 2, `all on one row: ${r.middles}`);
  assert.equal(`${r.gap}rem`, gap);
  assert.ok(r.firstLeft > r.logo.right, `the menu starts at ${r.firstLeft}, after the logo ends at ${r.logo.right}`);
  assert.ok(Math.abs(r.logo.width - r.logo.natural) < 1, `logo ${r.logo.width}px wide, should be ${r.logo.natural}`);
  assert.equal(r.overflow, false, 'no sideways scroll');
});

Then('the menu button should show instead of the top menu', async function () {
  assert.ok(await page(this).locator('#nav-toggle').isVisible());
  // Folded: the menu is no taller than its bottom border until the button opens it.
  assert.ok((await page(this).locator('#primary-nav').evaluate((nav) => nav.getBoundingClientRect().height)) <= 1);
});

Then('the menu should span the whole width of the window', async function () {
  const { left, width, viewport } = await page(this).evaluate(() => {
    const nav = document.getElementById('primary-nav').getBoundingClientRect();
    return { left: nav.left, width: nav.width, viewport: document.documentElement.clientWidth };
  });
  assert.ok(Math.abs(left) < 1 && Math.abs(width - viewport) < 1, `the menu is ${width}px wide from ${left}px, in a ${viewport}px window`);
});

Then('resting the mouse anywhere on each of its rows should keep that row highlighted, with no row moving', async function () {
  const rows = page(this).locator('#primary-nav > a, #primary-nav .nav-label, #primary-nav [data-admin-actions]:not([hidden]) .nav-action');
  const tops = () => rows.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  const before = await tops();
  for (let i = 0; i < before.length; i++) {
    const row = rows.nth(i);
    const box = await row.boundingBox();
    for (const dy of [2, box.height / 2, box.height - 2]) {
      await page(this).mouse.move(box.x + 6, box.y + dy);
      for (let n = 0; n < 6; n++) {
        await settle(30);
        await page(this).mouse.move(box.x + 6 + (n % 2), box.y + dy);
        assert.equal(await row.evaluate((el) => el.matches(':hover')), true, `row ${i + 1} lost the hover with the mouse ${Math.round(dy)}px into it`);
      }
      assert.deepEqual(await tops(), before, 'no row moved while hovered');
    }
  }
});

// --- The lightbox's full screen on a phone ----------------------------------------------------------------------------

// How much room the photo is given (the tests' stand-in photo is tiny, and a photo is never enlarged past its own size,
// so its room is what full screen changes): its size limits in pixels, and the lightbox's padding around it.
const room = (img) => {
  const css = getComputedStyle(img);
  const box = getComputedStyle(document.getElementById('lightbox'));
  const figure = img.parentElement.getBoundingClientRect();
  return { maxWidth: Math.round(Math.min(parseFloat(css.maxWidth) || Infinity, css.maxWidth.endsWith('%') ? figure.width : Infinity, innerWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight))), maxHeight: css.maxHeight, padding: box.paddingLeft };
};

Given('the phone notes when the page asks to turn its screen', function () {
  this.b.initScripts.push(`window.__orientation = []; try { screen.orientation.lock = (v) => { window.__orientation.push(v); return Promise.resolve(); }; screen.orientation.unlock = () => { window.__orientation.push('unlock'); }; } catch {}`);
});

When('I tap photo number {int} and wait for it to load', async function (n) {
  await page(this).locator('.gallery a, .gallery button').nth(n - 1).tap();
  await page(this).waitForFunction(() => { const img = document.getElementById('lightbox-img'); return img.complete && img.naturalWidth > 1 && img.getBoundingClientRect().width > 10; }, null, { timeout: 15000 });
  this.b.framed = await page(this).locator('#lightbox-img').evaluate((img, roomSource) => new Function(`return (${roomSource})`)()(img), room.toString());
});

When("I tap the lightbox's full screen button", async function () {
  await page(this).locator('#lightbox-fullscreen').tap();
  await settle(600);
});

Then('the photo should fill the width of the screen, with no title or counter over the page', async function () {
  const r = await page(this).evaluate((roomSource) => {
    const measure = new Function(`return (${roomSource})`)();
    return {
      fullscreen: document.fullscreenElement?.id ?? null,
      room: measure(document.getElementById('lightbox-img')),
      width: innerWidth,
      caption: getComputedStyle(document.getElementById('lightbox-caption')).display,
      counter: getComputedStyle(document.getElementById('lightbox-counter')).display,
    };
  }, room.toString());
  assert.equal(r.fullscreen, 'lightbox');
  assert.equal(r.room.padding, '0px', 'no margin around the photo');
  assert.equal(r.room.maxWidth, r.width, `the photo may be ${r.room.maxWidth}px wide on a ${r.width}px screen`);
  assert.ok(r.room.maxWidth > this.b.framed.maxWidth, `more room than framed (${this.b.framed.maxWidth}px)`);
  assert.deepEqual([r.caption, r.counter], ['none', 'none']);
});

Then('the page should have asked to turn the screen to {string}', async function (orientation) {
  assert.deepEqual(await page(this).evaluate(() => window.__orientation), [orientation]);
});

Then('the title and counter should be back, the photo framed as before', async function () {
  const r = await page(this).evaluate((roomSource) => ({ fullscreen: document.fullscreenElement, room: new Function(`return (${roomSource})`)()(document.getElementById('lightbox-img')), caption: getComputedStyle(document.getElementById('lightbox-caption')).display }), room.toString());
  assert.equal(r.fullscreen, null);
  assert.deepEqual(r.room, this.b.framed);
  assert.equal(r.caption, 'block');
});

Then('the page should have let the screen turn freely again', async function () {
  assert.equal((await page(this).evaluate(() => window.__orientation)).at(-1), 'unlock');
});

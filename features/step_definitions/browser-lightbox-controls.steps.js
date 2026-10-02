// The photo lightbox's control box (features/browser/lightbox-controls.feature): where it sits, its icons, its
// tooltips, dragging a zoomed photo, and the gallery link. The lightbox's other steps (opening a photo, the zoom
// buttons, panning, fullscreen) are in browser.steps.js.
import { Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { loadContentEntries, loadMessages } from '../support/lib.js';

const page = (world) => world.b.page;
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every lightbox control by the name the scenarios use; the first five are the ones inside the box. */
const CONTROLS = {
  'zoom in': '#lightbox-zoom-in',
  'zoom out': '#lightbox-zoom-out',
  fullscreen: '#lightbox-fullscreen',
  'view gallery': '#lightbox-view-gallery',
  close: '#lightbox-close',
  previous: '#lightbox-prev',
  next: '#lightbox-next',
};
const IN_THE_BOX = ['zoom in', 'zoom out', 'fullscreen', 'view gallery', 'close'];
const BOX = '.lightbox-toolbar';
const BOTTOM_MARGIN = 16; // --space-2

const control = (world, which) => {
  assert.ok(CONTROLS[which], `no lightbox control called "${which}"`);
  return page(world).locator(CONTROLS[which]);
};
const names = (list) => list.split(', ');
const boxOf = (world, selector) => page(world).locator(selector).boundingBox();
const overlap = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Polls until the check passes (tooltips fade in; the fullscreen icon turns). */
async function eventually(check, describe, timeout = 2000) {
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
    await settle(50);
  }
}

// --- Where the box sits ----------------------------------------------------------------------------------------------

Then(/^the control box should sit (in the screen's bottom-right corner|centered along the bottom of the screen), stacked one box-height above the bottom margin$/, async function (where) {
  const viewport = page(this).viewportSize();
  await page(this).locator(BOX).waitFor({ state: 'visible', timeout: 8000 });
  const box = await boxOf(this, BOX);
  // Its bottom edge is where the top of a box sitting at the very bottom (16px up) would be.
  const up = viewport.height - (box.y + box.height);
  assert.ok(Math.abs(up - (BOTTOM_MARGIN + box.height)) <= 1, `the box is ${up}px up from the bottom, expected ${BOTTOM_MARGIN + box.height}`);
  if (where.includes('corner')) {
    const inFromRight = viewport.width - (box.x + box.width);
    assert.ok(Math.abs(inFromRight - BOTTOM_MARGIN) <= 1, `the box is ${inFromRight}px in from the right, expected ${BOTTOM_MARGIN}`);
  } else {
    const offCentre = box.x + box.width / 2 - viewport.width / 2;
    assert.ok(Math.abs(offCentre) <= 1, `the box is ${offCentre}px off centre`);
  }
});

Then('the control box should have a white border all round', async function () {
  const sides = await page(this).locator(BOX).evaluate((el) => {
    const style = getComputedStyle(el);
    return ['Top', 'Right', 'Bottom', 'Left'].map((side) => ({ side, style: style[`border${side}Style`], color: style[`border${side}Color`], width: parseFloat(style[`border${side}Width`]) }));
  });
  for (const { side, style, color, width } of sides) {
    assert.equal(style, 'solid', `${side} border`);
    assert.equal(color, 'rgb(255, 255, 255)', `${side} border`);
    assert.ok(width >= 1, `${side} border`);
  }
});

Then('the control box should hold, left to right: {string}', async function (list) {
  const box = await boxOf(this, BOX);
  let lastRight = -Infinity;
  for (const which of names(list)) {
    const c = await control(this, which).boundingBox();
    assert.ok(c.x >= box.x && c.y >= box.y && c.x + c.width <= box.x + box.width && c.y + c.height <= box.y + box.height, `"${which}" is inside the box`);
    assert.ok(c.x >= lastRight, `"${which}" comes after the control before it`);
    lastRight = c.x + c.width;
  }
  assert.equal(await page(this).locator(`${BOX} .lightbox-tool`).count(), names(list).length, 'nothing else in the box');
});

// A real 16:9 photo, as large as the lightbox's own limits allow on this screen (78vh tall, the figure's width).
When('the lightbox photo is the size of a real 16:9 photo', async function () {
  await page(this).evaluate(() => {
    const img = document.getElementById('lightbox-img');
    img.style.width = `${Math.round((innerHeight * 0.78 * 16) / 9)}px`;
    img.style.height = `${Math.round((img.clientWidth * 9) / 16)}px`; // clientWidth: after max-width has capped it
  });
});

Then('the control box should not cover the photo, its title or the counter', async function () {
  const box = await boxOf(this, BOX);
  for (const [what, selector] of [['photo', '#lightbox-img'], ['title', '#lightbox-caption'], ['counter', '#lightbox-counter']]) {
    assert.ok(!overlap(box, await boxOf(this, selector)), `the box covers the ${what}`);
  }
});

When('I note where the control box is', async function () {
  this.b.controlBox = await boxOf(this, BOX);
});

Then('the control box should not have moved', async function () {
  assert.deepEqual(await boxOf(this, BOX), this.b.controlBox);
});

Then('the lightbox photo should reach under the control box', async function () {
  // boundingBox() includes the zoom's transform: the photo as it is drawn now.
  assert.ok(overlap(await boxOf(this, '#lightbox-img'), await boxOf(this, BOX)), 'the zoomed photo should extend under the box');
});

Then('every control in the box should be on top of the photo', async function () {
  for (const which of IN_THE_BOX) {
    const onTop = await control(this, which).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el === hit || el.contains(hit);
    });
    assert.ok(onTop, `"${which}" is covered`);
  }
});

When('I focus the lightbox {string} control', async function (which) {
  await control(this, which).focus();
});

Then('pressing Tab should visit, in order: {string}', async function (list) {
  for (const which of names(list)) {
    await page(this).keyboard.press('Tab');
    const focused = await page(this).evaluate(() => document.activeElement?.id);
    assert.equal(`#${focused}`, CONTROLS[which], `expected "${which}" to be focused`);
  }
});

// --- Icons -------------------------------------------------------------------------------------------------------------

Then(/^the lightbox "(zoom in|zoom out)" control should be a magnifying glass with a (plus|minus)$/, async function (which, sign) {
  const icon = await control(this, which).evaluate((el) => {
    const svg = el.querySelector('svg');
    return {
      circles: svg?.querySelectorAll('circle').length ?? 0,
      // Each straight stroke of its paths: "h" level, "v" upright (the handle is a diagonal, neither).
      strokes: [...(svg?.querySelectorAll('path') ?? [])].flatMap((p) => p.getAttribute('d').match(/[hv]/g) ?? []),
      text: el.textContent.trim(),
    };
  });
  assert.equal(icon.circles, 1, 'a magnifying glass: one lens');
  assert.deepEqual(icon.strokes.sort(), sign === 'plus' ? ['h', 'v'] : ['h']);
  assert.equal(icon.text, '', 'no "+" or "−" character');
});

Then('every control in the box should show only a hidden icon and be named by its label', async function () {
  for (const which of IN_THE_BOX) {
    const c = control(this, which);
    const label = await c.getAttribute('aria-label');
    assert.ok(label, `"${which}" has a label`);
    for (const [hidden, focusable] of await c.locator('svg').evaluateAll((svgs) => svgs.map((s) => [s.getAttribute('aria-hidden'), s.getAttribute('focusable')]))) {
      assert.equal(hidden, 'true', `"${which}"'s icon is hidden from screen readers`);
      assert.equal(focusable, 'false');
    }
    const role = which === 'view gallery' ? 'link' : 'button';
    assert.equal(await page(this).locator(BOX).getByRole(role, { name: label, exact: true }).count(), 1, `"${which}" is named "${label}"`);
  }
});

const iconOpacity = (world, which) => control(world, which).evaluate((el) => ({ disabled: el.disabled, button: getComputedStyle(el).opacity, icon: getComputedStyle(el.querySelector('svg')).opacity }));

Then(/^the lightbox "([^"]+)" control should be disabled with a dimmed icon$/, async function (which) {
  const { disabled, button, icon } = await iconOpacity(this, which);
  assert.equal(disabled, true);
  assert.ok(Number(icon) < 0.5, `icon opacity ${icon}`);
  assert.equal(button, '1', 'the control itself (and so its tooltip) is not dimmed');
});

Then(/^the lightbox "([^"]+)" control should be enabled with a full-strength icon$/, async function (which) {
  const { disabled, icon } = await iconOpacity(this, which);
  assert.equal(disabled, false);
  assert.equal(icon, '1');
});

Then(/^the fullscreen icon's corners should point (outward|inward)$/, async function (way) {
  await eventually(async () => {
    const turns = await control(this, 'fullscreen').locator('path').evaluateAll((paths) => paths.map((p) => new DOMMatrix(getComputedStyle(p).transform === 'none' ? undefined : getComputedStyle(p).transform).a));
    assert.equal(turns.length, 2);
    // a = cos(angle): 1 unturned, -1 turned half way round.
    for (const a of turns) assert.ok(way === 'outward' ? a > 0.99 : a < -0.99, `corner turned to cos ${a}`);
  }, `the corners should point ${way}`);
});

// --- Tooltips ----------------------------------------------------------------------------------------------------------

/** A control's tooltip (its ::after): what it says, whether it's showing, and where it is on screen. */
const tooltipOf = (world, which) =>
  control(world, which).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el, '::after');
    const px = (v) => parseFloat(v) || 0;
    const width = px(s.width) + px(s.paddingLeft) + px(s.paddingRight) + px(s.borderLeftWidth) + px(s.borderRightWidth);
    const height = px(s.height) + px(s.paddingTop) + px(s.paddingBottom) + px(s.borderTopWidth) + px(s.borderBottomWidth);
    // top/left of an absolutely positioned box resolve to pixels, from the control's own box.
    const left = r.left + px(s.left);
    const top = r.top + px(s.top);
    return {
      text: s.content === 'none' ? '' : s.content.replace(/^"|"$/g, ''),
      label: el.getAttribute('aria-label'),
      showing: s.content !== 'none' && s.visibility === 'visible' && Number(s.opacity) > 0.9,
      rect: { left, top, right: left + width, bottom: top + height },
    };
  });

async function expectTooltip(world, which, text) {
  const tip = await eventually(async () => {
    const t = await tooltipOf(world, which);
    assert.ok(t.showing, 'not showing');
    return t;
  }, `the "${which}" tooltip should be showing`);
  assert.equal(tip.text, text ?? tip.label);
  assert.equal(tip.text, tip.label, 'the tooltip says exactly what the control is named');
  return tip;
}

When('I move the mouse away from the controls', async function () {
  await page(this).mouse.move(page(this).viewportSize().width / 2, 4);
});

When('I point at the lightbox {string} control', async function (which) {
  await control(this, which).hover();
});

When('I tap the lightbox {string} control', async function (which) {
  await control(this, which).tap();
});

Then('no lightbox tooltip should be showing', async function () {
  await settle(200); // past the fade-in, so a tooltip on its way can't slip through
  for (const which of Object.keys(CONTROLS)) assert.equal((await tooltipOf(this, which)).showing, false, `the "${which}" tooltip is showing`);
});

Then('pointing at each of {string} should show just its own tooltip, saying its name', async function (list) {
  const { gallery } = loadMessages('en');
  const expected = {
    'zoom in': gallery.zoomIn,
    'zoom out': gallery.zoomOut,
    fullscreen: gallery.enterFullscreen,
    'view gallery': gallery.viewCategoryGallery.replace('{category}', 'Nature'),
    close: gallery.close,
    previous: gallery.previous,
    next: gallery.next,
  };
  for (const which of names(list)) {
    await control(this, which).hover();
    await expectTooltip(this, which, expected[which]);
    for (const other of Object.keys(CONTROLS).filter((o) => o !== which)) {
      assert.equal((await tooltipOf(this, other)).showing, false, `pointing at "${which}" also shows the "${other}" tooltip`);
    }
  }
});

Then('the tooltips of {string} should open above the control box', async function (list) {
  const box = await boxOf(this, BOX);
  for (const which of names(list)) {
    await control(this, which).hover();
    const { rect } = await expectTooltip(this, which);
    assert.ok(rect.bottom <= box.y, `the "${which}" tooltip (bottom ${rect.bottom}) should be above the box (top ${box.y})`);
  }
});

Then('pointing at each of {string} should show a tooltip entirely on screen', async function (list) {
  const viewport = page(this).viewportSize();
  for (const which of names(list)) {
    await control(this, which).hover();
    const { rect } = await expectTooltip(this, which);
    assert.ok(rect.left >= 0 && rect.top >= 0 && rect.right <= viewport.width && rect.bottom <= viewport.height, `the "${which}" tooltip is off screen: ${JSON.stringify(rect)}`);
  }
});

Then('the lightbox {string} control should show the tooltip {string}', async function (which, text) {
  await expectTooltip(this, which, text);
});

Then('the lightbox {string} control should not be highlighted', async function (which) {
  assert.equal(await control(this, which).evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)');
});

// --- Dragging a zoomed photo -------------------------------------------------------------------------------------------

// Grabs the photo's middle and lets go near the lightbox's top-left corner: the dark background, with every test photo
// (a tiny synthetic image), zoomed in or not.
When('I drag the lightbox photo up and left, letting go over the dark background', async function () {
  const photo = await boxOf(this, '#lightbox-img');
  await page(this).mouse.move(photo.x + photo.width / 2, photo.y + photo.height / 2);
  await page(this).mouse.down();
  await page(this).mouse.move(6, 6, { steps: 8 });
  assert.equal(await page(this).evaluate(() => document.elementFromPoint(6, 6)?.id), 'lightbox', 'the pointer should be over the dark background');
  await page(this).mouse.up();
});

// --- The gallery link ----------------------------------------------------------------------------------------------------

Then('the lightbox {string} control should be labelled {string}', async function (which, label) {
  assert.equal(await control(this, which).getAttribute('aria-label'), label);
});

// The truth comes from the photo library itself (test-fixtures/photos), not from anything the page says, so a tile built
// without its category can't pass.
Then("every photo's gallery link should lead to its own category", async function () {
  const categoryOf = new Map(loadContentEntries().map(({ frontmatter }) => [frontmatter.photo?.id ?? frontmatter.photo, frontmatter.category]));
  const tiles = page(this).locator('.gallery .tile');
  const count = await tiles.count();
  const seen = new Set();
  for (let n = 0; n < count; n++) {
    const id = await tiles.nth(n).getAttribute('data-id');
    await tiles.nth(n).click();
    await page(this).waitForSelector('#lightbox', { state: 'visible' });
    const expected = `/work/${categoryOf.get(id)}/`;
    assert.equal(await control(this, 'view gallery').getAttribute('href'), expected, `photo ${n + 1} (${id})`);
    seen.add(expected);
    await page(this).keyboard.press('Escape');
    await page(this).waitForSelector('#lightbox', { state: 'hidden' });
  }
  assert.ok(seen.size > 1, 'the "All" page mixes several categories');
});

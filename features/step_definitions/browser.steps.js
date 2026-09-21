import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { ROOT, listBuiltRoutes, listNotFoundRoutes, loadMessages } from '../support/lib.js';
import { open, useDevice } from '../support/browser.js';

const photos = await import(join(ROOT, 'src/config/photos.ts'));

const page = (world) => world.b.page;
const active = (world) => page(world).evaluate(() => {
  const el = document.activeElement;
  return el ? { id: el.id, tag: el.tagName, cls: el.className?.toString?.() ?? '', text: el.textContent.trim(), name: el.getAttribute('name'), href: el.getAttribute('href'), inLightbox: Boolean(el.closest('#lightbox')), caption: el.getAttribute('data-caption') } : null;
});
const htmlLang = (world) => page(world).evaluate(() => document.documentElement.lang);
const messages = async (world) => loadMessages(await htmlLang(world));

async function goto(world, path, waitUntil = 'load') {
  const p = await open(world);
  const response = await p.goto(`${world.b.siteOrigin}${path}`, { waitUntil });
  world.b.lastResponse = response;
  return p;
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- setting the scene ------------------

Given(/^the visitor uses a (phone|laptop|laptop with a sharp screen)$/, function (kind) {
  useDevice(this, kind);
});

Given("the visitor's browser language is {string}", function (locale) {
  this.b.locale = locale;
});

Given('the visitor asks for reduced motion', function () {
  this.b.reducedMotion = 'reduce';
});

Given('JavaScript is switched off', function () {
  this.b.javaScriptEnabled = false;
});

Given('Cloudflare says the visitor is in {string}', function (country) {
  this.b.trace = `loc=${country}`;
});

Given("Cloudflare's location lookup is unavailable", function () {
  this.b.trace = 'not-found';
});

Given("Cloudflare's location lookup fails to connect", function () {
  this.b.trace = 'unreachable';
});

Given("Cloudflare's location lookup never answers", function () {
  this.b.trace = 'timeout';
});

Given("the visitor's browser already remembers the language {string}", function (locale) {
  this.b.remembered = locale;
});

Given('the visitor is a search engine crawler', function () {
  this.b.userAgent = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
});

Given('the browser blocks local storage', function () {
  this.b.initScripts.push(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage is blocked', 'SecurityError'); } });
  });
});

Given(/^Web3Forms (accepts it|rejects it|is unreachable|is slow)$/, function (behaviour) {
  this.b.api = { 'accepts it': 'success', 'rejects it': 'failure', 'is unreachable': 'unreachable', 'is slow': 'slow' }[behaviour];
});

Given('every image takes {int} ms to arrive', function (ms) {
  this.b.imageDelayMs = ms;
});

// ---------------------------------------------------------------- opening pages ------------------------

When('I open {string}', async function (path) {
  await goto(this, path);
});

When('I open {string} and wait for everything to load', async function (path) {
  await goto(this, path, 'networkidle');
  await settle(600);
});

When('I open {string} zoomed to 200 percent', async function (path) {
  // 200% zoom halves the CSS-pixel viewport, which is what layout sees.
  const { width, height } = this.b.device.viewport;
  this.b.viewportOverride = { width: width / 2, height: height / 2 };
  await goto(this, path);
});

When('I open the unknown address {string}', async function (path) {
  await goto(this, path);
});

When('I press the key {string}', async function (key) {
  await page(this).keyboard.press(key);
});

// ---------------------------------------------------------------- lightbox --------------------------------

const tile = (world, n) => page(world).locator('.tile').nth(n - 1);

When('I click photo number {int}', async function (n) {
  await tile(this, n).click();
  this.b.openedTile = n;
});

When('I click the lightbox {string} button', async function (which) {
  const id = { close: '#lightbox-close', next: '#lightbox-next', previous: '#lightbox-prev' }[which];
  await page(this).locator(id).click();
});

When('I click the dark background of the lightbox', async function () {
  await page(this).locator('#lightbox').click({ position: { x: 8, y: 8 } });
});

const captionOfTile = (world, n) => tile(world, n).getAttribute('data-caption');
const shownCaption = (world) => page(world).locator('#lightbox-caption').textContent();

Then('the lightbox should be open showing photo number {int} of the page', async function (n) {
  await page(this).waitForSelector('#lightbox:not([hidden])');
  assert.equal(await shownCaption(this), await captionOfTile(this, n));
});

Then('the lightbox should show photo number {int} of the page', async function (n) {
  assert.equal(await shownCaption(this), await captionOfTile(this, n));
});

Then('the lightbox should show the last photo of the page', async function () {
  const count = await page(this).locator('.tile').count();
  assert.equal(await shownCaption(this), await captionOfTile(this, count));
});

Then('the lightbox photo should be the full-size version', async function () {
  assert.match(await page(this).locator('#lightbox-img').getAttribute('src'), /\/full\.webp$/);
});

Then('the lightbox should be closed', async function () {
  await page(this).waitForSelector('#lightbox', { state: 'hidden' });
});

Then('keyboard focus should be on the lightbox close button', async function () {
  assert.equal((await active(this)).id, 'lightbox-close');
});

Then('keyboard focus should be back on photo number {int}', async function (n) {
  const now = await active(this);
  assert.ok(now.cls.includes('tile'), `focus is on ${now.tag}#${now.id}`);
  assert.equal(now.caption, await captionOfTile(this, n));
});

Then('the page behind the lightbox should not scroll', async function () {
  assert.equal(await page(this).evaluate(() => document.body.style.overflow), 'hidden');
});

Then('the page behind the lightbox should scroll again', async function () {
  assert.equal(await page(this).evaluate(() => document.body.style.overflow), '');
});

Then(/^pressing (Shift\+)?Tab (\d+) times should always leave keyboard focus inside the lightbox$/, async function (shift, times) {
  for (let i = 0; i < Number(times); i++) {
    await page(this).keyboard.press(shift ? 'Shift+Tab' : 'Tab');
    const now = await active(this);
    assert.ok(now.inLightbox, `after press ${i + 1} focus escaped to ${now.tag}#${now.id}`);
  }
});

Then('the lightbox should be a modal dialog labelled by its caption', async function () {
  const dialog = page(this).locator('#lightbox');
  assert.equal(await dialog.getAttribute('role'), 'dialog');
  assert.equal(await dialog.getAttribute('aria-modal'), 'true');
  const labelledBy = await dialog.getAttribute('aria-labelledby');
  assert.equal(labelledBy, 'lightbox-caption');
  assert.ok((await page(this).locator(`#${labelledBy}`).textContent()).trim());
});

Then('the lightbox controls should be labelled in {string}', async function (locale) {
  const { gallery } = loadMessages(locale);
  assert.equal(await page(this).locator('#lightbox-close').getAttribute('aria-label'), gallery.close);
  assert.equal(await page(this).locator('#lightbox-prev').getAttribute('aria-label'), gallery.previous);
  assert.equal(await page(this).locator('#lightbox-next').getAttribute('aria-label'), gallery.next);
});

Then('the lightbox photo should fit inside the screen', async function () {
  const box = await page(this).locator('#lightbox-img').boundingBox();
  const { width, height } = this.b.device.viewport;
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 0.5 && box.y + box.height <= height + 0.5, JSON.stringify(box));
});

// ---------------------------------------------------------------- navigation ---------------------------------

const navHeight = (world) => page(world).locator('#primary-nav').evaluate((el) => el.clientHeight); // content height, without its border

Then('the mobile menu should be collapsed', async function () {
  assert.equal(await page(this).locator('#nav-toggle').getAttribute('aria-expanded'), 'false');
  // It collapses over 250 ms; wait for that to finish (and so prove it really does).
  await page(this).waitForFunction(() => document.querySelector('#primary-nav').clientHeight === 0, undefined, { timeout: 3000 });
  assert.equal(await navHeight(this), 0);
});

When('I open the mobile menu', async function () {
  await page(this).locator('#nav-toggle').click();
  await page(this).waitForFunction(() => document.querySelector('#primary-nav').clientHeight > 40);
});

Then(/^the mobile menu should be open with the (?:"([^"]+)" and "([^"]+)"|About and Contact) links visible$/, async function (a, b) {
  assert.equal(await page(this).locator('#nav-toggle').getAttribute('aria-expanded'), 'true');
  const { nav } = await messages(this);
  for (const name of [a ?? nav.about, b ?? nav.contact]) assert.ok(await page(this).locator('#primary-nav > a', { hasText: name }).isVisible(), `${name} not visible`);
});

When('I open the Work submenu', async function () {
  await page(this).locator('#nav-work-toggle').click();
});

Then('the Work submenu should list {int} categories, all visible', async function (count) {
  const links = page(this).locator('#nav-work-dropdown a');
  assert.equal(await links.count(), count);
  for (let i = 0; i < count; i++) assert.ok(await links.nth(i).isVisible(), `category link ${i} hidden`);
});

Then('keyboard focus should be on the menu button', async function () {
  assert.equal((await active(this)).id, 'nav-toggle');
});

When('I tab until keyboard focus reaches the Work menu', async function () {
  for (let i = 0; i < 12; i++) {
    await page(this).keyboard.press('Tab');
    if ((await active(this))?.id === 'nav-work-toggle') return;
  }
  assert.fail('Tab never reached the Work menu');
});

Then('the Work dropdown should be visible with its {int} category links', async function (count) {
  const dropdown = page(this).locator('#nav-work-dropdown');
  await settle(350); // the dropdown fades in over 150 ms
  assert.equal(await dropdown.evaluate((el) => getComputedStyle(el).opacity), '1', 'dropdown is not shown on keyboard focus');
  assert.equal(await page(this).locator('#nav-work-dropdown a').count(), count);
  assert.ok(await page(this).locator('#nav-work-dropdown a').first().isVisible());
});

const accessibleName = (world) => page(world).evaluate(() => {
  const el = document.activeElement;
  return (el.getAttribute('aria-label') || el.textContent.replace(/\s+/g, ' ').trim() || el.querySelector('img')?.alt || '').trim();
});

Then('tabbing through the page should reach these in order:', async function (table) {
  const { nav } = loadMessages('en');
  const { categories } = loadMessages('en');
  const visible = (await import(join(ROOT, 'src/config/categories.ts'))).VISIBLE_CATEGORIES.map((c) => categories[c.slug].label).sort((a, b) => a.localeCompare(b));
  const expected = table.raw().flat().flatMap((item) => (item === 'skip link' ? [nav.skipToContent] : item === 'home' ? ['Diego Narvaez'] : item === 'each category' ? visible : [item]));
  const seen = [];
  for (let i = 0; i < expected.length; i++) {
    await page(this).keyboard.press('Tab');
    seen.push(await accessibleName(this));
  }
  assert.deepEqual(seen, expected);
});

Then('the skip link should be focused and visible on screen', async function () {
  assert.ok((await active(this)).cls.includes('skip-link'));
  await settle(350); // the link slides into view over 150 ms
  const box = await page(this).locator('.skip-link').boundingBox();
  assert.ok(box && box.y >= 0 && box.x >= 0 && box.height > 0, `skip link is off screen: ${JSON.stringify(box)}`);
});

Then('the address should end with {string}', async function (suffix) {
  assert.ok(page(this).url().endsWith(suffix), page(this).url());
});

Then('the {string} link should be the active one', async function (name) {
  const activeLinks = await page(this).locator('#primary-nav > a.active').allTextContents();
  assert.deepEqual(activeLinks.map((t) => t.trim()), [name]);
});

// ---------------------------------------------------------------- language & location ---------------------------

When('I click the language switcher link {string}', async function (text) {
  await page(this).locator('.lang-switcher a', { hasText: text }).click();
});

When('I tab until keyboard focus reaches the language link {string}', async function (text) {
  for (let i = 0; i < 25; i++) {
    await page(this).keyboard.press('Tab');
    const now = await active(this);
    if (now?.text === text && now.tag === 'A') return;
  }
  assert.fail(`Tab never reached the ${text} link`);
});

Then('the page path should be {string}', async function (expected) {
  await page(this).waitForFunction((p) => location.pathname === p, expected, { timeout: 8000 }).catch(() => {});
  assert.equal(new URL(page(this).url()).pathname, expected);
});

Then('the page language should be {string}', async function (lang) {
  assert.equal(await htmlLang(this), lang);
});

Then('the browser should remember the language {string}', async function (lang) {
  assert.equal(await page(this).evaluate(() => localStorage.getItem('preferred-locale')), lang);
});

Then('the current language {string} should be marked, and {string} should be a link', async function (current, other) {
  assert.equal((await page(this).locator('.lang-switcher [aria-current]').textContent()).trim(), current);
  assert.ok(await page(this).locator('.lang-switcher a', { hasText: other }).isVisible());
});

Then('the visitor should end up on {string}', async function (path) {
  await page(this).waitForFunction((p) => location.pathname === p, path, { timeout: 8000 });
});

Then('the visitor should end up on {string} with the address ending {string}', async function (path, suffix) {
  await page(this).waitForFunction((p) => location.pathname === p, path, { timeout: 8000 });
  assert.ok(page(this).url().endsWith(suffix), page(this).url());
});

Then('the visitor should stay on {string} once location detection has had time to run', async function (path) {
  // Detection gives up after its own 2.5 s timeout, so wait past that when Cloudflare never answers.
  await settle(this.b.trace === 'timeout' ? 3300 : 900);
  assert.equal(new URL(page(this).url()).pathname, path);
});

Then("Cloudflare's location should not have been asked", function () {
  assert.equal(this.b.traceRequests, 0, 'the page asked Cloudflare where the visitor is');
});

// ---------------------------------------------------------------- contact form ----------------------------------

const CONTACT_SELECT = 'select[name="category"]';

When('I fill in the contact form with name {string}, email {string}, interest {string} and message {string}', async function (name, email, interest, message) {
  const p = page(this);
  await p.locator('input[name="name"]').fill(name);
  await p.locator('input[name="email"]').fill(email);
  // The interest is given as the visible label ("Naturaleza") or the value that is sent ("Nature", "Other").
  const value = await p.locator(`${CONTACT_SELECT} option`).evaluateAll((options, wanted) => options.find((o) => o.textContent.trim() === wanted || o.value === wanted)?.value, interest);
  assert.ok(value, `No interest "${interest}" in the form`);
  await p.locator(CONTACT_SELECT).selectOption(value);
  await p.locator('textarea[name="message"]').fill(message);
  // Read now: a plain (no-JavaScript) post navigates away from this page.
  this.b.pageKey = await p.locator('input[name="access_key"]').getAttribute('value');
});

When('I send the message', async function () {
  const p = page(this);
  if (this.b.javaScriptEnabled) await p.locator('button[type="submit"]').click();
  else await Promise.all([p.waitForURL(/thanks|web3forms/i, { timeout: 5000 }).catch(() => {}), p.locator('button[type="submit"]').click()]);
});

const statusText = (world) => page(world).locator('#form-status').textContent();

Then('the form status should show the {string} message', async function (kind) {
  const expected = (await messages(this)).contact[kind];
  await page(this).waitForFunction((text) => document.querySelector('#form-status').textContent === text, expected, { timeout: 8000 });
});

Then('the form status should eventually show the {string} message', async function (kind) {
  const expected = (await messages(this)).contact[kind];
  await page(this).waitForFunction((text) => document.querySelector('#form-status').textContent === text, expected, { timeout: 8000 });
});

Then('the form should be empty again', async function () {
  const p = page(this);
  for (const selector of ['input[name="name"]', 'input[name="email"]', 'textarea[name="message"]']) assert.equal(await p.locator(selector).inputValue(), '', selector);
});

Then('the form should still contain what the visitor typed', async function () {
  const p = page(this);
  assert.equal(await p.locator('input[name="name"]').inputValue(), 'Ana');
  assert.equal(await p.locator('textarea[name="message"]').inputValue(), 'Hello');
});

Then('the send button should be enabled again', async function () {
  await page(this).waitForFunction(() => !document.querySelector('button[type="submit"]').disabled, undefined, { timeout: 5000 });
});

Then('the send button should be disabled and the form should say it is sending', async function () {
  await page(this).waitForFunction(() => document.querySelector('button[type="submit"]').disabled, undefined, { timeout: 3000 });
  assert.equal(await statusText(this), (await messages(this)).contact.sending);
});

/** Field values from a multipart or url-encoded body. */
function fields(request) {
  if (request.contentType.includes('multipart')) {
    return Object.fromEntries([...request.body.matchAll(/name="([^"]+)"\r?\n\r?\n([\s\S]*?)\r?\n--/g)].map((m) => [m[1], m[2]]));
  }
  return Object.fromEntries(new URLSearchParams(request.body));
}

Then('Web3Forms should have received exactly one submission carrying:', async function (table) {
  assert.equal(this.b.apiRequests.length, 1);
  const [request] = this.b.apiRequests;
  assert.equal(request.method, 'POST');
  const sent = fields(request);
  for (const [key, value] of table.rowsHash ? Object.entries(table.rowsHash()) : []) assert.equal(sent[key], value, `field ${key}`);
  this.b.lastSubmission = sent;
});

Then('Web3Forms should have received {int} submissions', function (count) {
  assert.equal(this.b.apiRequests.length, count);
});

Then("the submission should use this page's own access key", async function () {
  const sent = this.b.lastSubmission ?? fields(this.b.apiRequests[0]);
  const key = this.b.pageKey;
  assert.match(key, /^[0-9a-f-]{36}$/i);
  assert.equal(sent.access_key, key);
});

Then('no message should have been sent', async function () {
  await settle(300);
  assert.equal(this.b.apiRequests.length, 0);
});

Then('the first required field should be focused and marked invalid', async function () {
  const now = await active(this);
  assert.equal(now.name, 'name');
  assert.equal(await page(this).locator('input[name="name"]').evaluate((el) => el.validity.valueMissing), true);
});

Then('the spam-trap checkbox should be visually hidden, out of the tab order and hidden from assistive technology', async function () {
  const trap = page(this).locator('input[name="botcheck"]');
  assert.equal(await trap.getAttribute('tabindex'), '-1');
  assert.equal(await trap.getAttribute('aria-hidden'), 'true');
  const box = await trap.evaluate((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  assert.ok(box.w <= 1 && box.h <= 1, `the trap is visible: ${JSON.stringify(box)}`);
});

Then('tabbing through the form should never land on the spam-trap checkbox', async function () {
  await page(this).locator('input[name="name"]').focus();
  for (let i = 0; i < 8; i++) {
    await page(this).keyboard.press('Tab');
    assert.notEqual((await active(this)).name, 'botcheck');
  }
});

Then('Web3Forms should have received a plain form post carrying the name, email and message', async function () {
  assert.equal(this.b.apiRequests.length, 1, 'the browser should have posted the form natively');
  const [request] = this.b.apiRequests;
  assert.equal(request.method, 'POST');
  const sent = fields(request);
  assert.equal(sent.name, 'Ana');
  assert.equal(sent.email, 'ana@example.com');
  assert.equal(sent.message, 'Hello');
  this.b.lastSubmission = sent;
});

// ---------------------------------------------------------------- console / CSP -----------------------------

Then('no script error should have been logged', function () {
  assert.deepEqual(this.b.consoleErrors, []);
});

Then('no Content-Security-Policy violation should have been reported', function () {
  assert.deepEqual(this.b.csp, []);
});

// ---------------------------------------------------------------- accessibility ------------------------------

async function everyRoute() {
  return [...(await listBuiltRoutes()), ...(await listNotFoundRoutes())];
}

Then('every page and both error pages should pass the automated accessibility audit', { timeout: 300_000 }, async function () {
  const problems = [];
  for (const route of await everyRoute()) {
    const p = await goto(this, route);
    const { violations } = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    for (const v of violations) problems.push(`${route}: ${v.id} (${v.impact}) x${v.nodes.length} — ${v.help} — ${v.nodes[0].target.join(' ')}`);
  }
  assert.deepEqual(problems, []);
});

Then('no page and neither error page should scroll sideways', { timeout: 300_000 }, async function () {
  const problems = [];
  for (const route of await everyRoute()) {
    const p = await goto(this, route);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) problems.push(`${route}: ${overflow}px wider than the screen`);
  }
  assert.deepEqual(problems, []);
});

const transitionSeconds = (world) => page(world).locator('.tile img').first().evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));

Then('transitions on the gallery should be effectively instant', async function () {
  assert.ok((await transitionSeconds(this)) <= 0.001);
});

Then('transitions on the gallery should take a visible amount of time', async function () {
  assert.ok((await transitionSeconds(this)) >= 0.1);
});

Then('the focused element should have a clearly visible outline', async function () {
  const outline = await page(this).evaluate(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), color: s.outlineColor }; });
  assert.notEqual(outline.style, 'none');
  assert.ok(outline.width >= 2, `outline is ${outline.width}px`);
});

Then('every form field should have a visible label', async function () {
  const fieldsWithoutLabel = await page(this).evaluate(() =>
    [...document.querySelectorAll('.contact-form input:not([type="hidden"]):not([name="botcheck"]), .contact-form select, .contact-form textarea')]
      .filter((el) => !(el.closest('label')?.textContent.replace(el.textContent, '').trim()))
      .map((el) => el.name)
  );
  assert.deepEqual(fieldsWithoutLabel, []);
});

Then("every text field's border should stand out from the page by at least 3:1", async function () {
  const ratios = await page(this).evaluate(() => {
    const parse = (c) => c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    const lum = (rgb) => { const [r, g, b] = rgb.map((v) => v / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    const page = parse(getComputedStyle(document.body).backgroundColor);
    return [...document.querySelectorAll('.contact-form input[type="text"], .contact-form input[type="email"], .contact-form select, .contact-form textarea')].map((el) => {
      const s = getComputedStyle(el);
      const border = parse(s.borderTopColor);
      return { name: el.name, vsPage: ratio(border, page), vsField: ratio(border, parse(s.backgroundColor)) };
    });
  });
  assert.equal(ratios.length, 4);
  for (const r of ratios) assert.ok(r.vsPage >= 3 && r.vsField >= 3, `${r.name}: ${r.vsPage.toFixed(2)} / ${r.vsField.toFixed(2)}`);
});

Then('the contact form should still be fully visible without sideways scrolling', async function () {
  const p = page(this);
  assert.ok((await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);
  await p.locator('button[type="submit"]').scrollIntoViewIfNeeded();
  assert.ok(await p.locator('button[type="submit"]').isVisible());
  const box = await p.locator('.contact-form').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= this.b.viewportOverride.width + 1);
});

// ---------------------------------------------------------------- security & performance --------------------------

Then('every page and both error pages should load with no Content-Security-Policy violation, no script error and no blocked request', { timeout: 300_000 }, async function () {
  const problems = [];
  for (const route of await everyRoute()) {
    const p = await goto(this, route, 'networkidle');
    await settle(150);
    if (!this.b.lastResponse.headers()['content-security-policy']) problems.push(`${route}: served without a CSP header`);
    if (this.b.csp.length) problems.push(`${route}: CSP ${this.b.csp.splice(0).join(', ')}`);
    if (this.b.consoleErrors.length) problems.push(`${route}: console ${this.b.consoleErrors.splice(0).join(', ')}`);
    if (this.b.blocked.length) problems.push(`${route}: blocked ${this.b.blocked.splice(0).join(', ')}`);
    void p;
  }
  assert.deepEqual(problems, []);
});

Then('the page should have been served with a Content-Security-Policy', function () {
  assert.match(this.b.lastResponse.headers()['content-security-policy'] ?? '', /script-src 'self'/);
});

Then('an inline script injected into the page should be blocked and reported', async function () {
  const ran = await page(this).evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__injected = true';
    document.head.appendChild(script);
    return window.__injected === true;
  });
  await settle(200);
  assert.equal(ran, false, 'an injected inline script ran: the policy is not being enforced');
  assert.ok(this.b.csp.some((m) => m.startsWith('script-src')), `no script-src violation reported: ${JSON.stringify(this.b.csp)}`);
  this.b.csp.length = 0; // deliberate violation; the scenario is about proving enforcement
});

Then('the first gallery photo should have loaded the {string} size', async function (size) {
  const img = page(this).locator('.tile img').first();
  await img.evaluate((el) => (el.complete ? true : new Promise((resolve) => el.addEventListener('load', resolve, { once: true }))));
  const current = await img.evaluate((el) => el.currentSrc);
  assert.match(current, new RegExp(`/${size}\\.webp$`), `picked ${current}`);
});

Then('the first {int} gallery photos should have been requested', async function (count) {
  await settle(400);
  const ids = await page(this).evaluate((n) => [...document.querySelectorAll('.tile img')].slice(0, n).map((img) => img.src.match(/\/photos\/([0-9a-f]{16})\//)[1]), count);
  for (const id of ids) assert.ok(this.b.photoRequests.some((url) => url.includes(`/photos/${id}/`)), `photo ${id} was not requested up front`);
});

When('I scroll to the category cards', async function () {
  await page(this).locator('.category-grid').scrollIntoViewIfNeeded();
  await page(this).waitForLoadState('networkidle');
  await settle(300);
});

Then('the category card images should have loaded a size between {int} and {int} pixels wide', async function (min, max) {
  const sources = await page(this).evaluate(() => [...document.querySelectorAll('.category-card img')].map((img) => img.currentSrc).filter(Boolean));
  assert.ok(sources.length >= 5);
  for (const src of sources) {
    const variant = src.match(/\/([A-Za-z0-9]+)\.webp$/)[1];
    const width = photos.PHOTO_VARIANTS[variant];
    assert.ok(width >= min && width <= max, `${src} is ${width}px wide`);
  }
});

const logoBoxes = (world) => page(world).evaluate(() => Object.fromEntries(['.brand-logo', '.aperture-logo'].map((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [sel, { x: r.x, width: r.width, height: r.height }]; })));

When('I open {string} and measure the header logos before they have loaded', async function (path) {
  await goto(this, path, 'domcontentloaded');
  this.b.logosBefore = await logoBoxes(this);
  const loaded = await page(this).evaluate(() => [...document.querySelectorAll('.brand-logo, .aperture-logo')].every((img) => img.complete));
  assert.equal(loaded, false, 'the logos had already loaded, so this measured nothing');
});

Then('the header logos should occupy exactly the same space after they have loaded', async function () {
  await page(this).waitForLoadState('networkidle');
  const after = await logoBoxes(this);
  for (const [selector, before] of Object.entries(this.b.logosBefore)) {
    for (const key of ['x', 'width', 'height']) assert.ok(Math.abs(before[key] - after[selector][key]) < 0.5, `${selector} ${key}: ${before[key]} before, ${after[selector][key]} after loading`);
  }
});

Then('the layout shift score should be at most {float}', async function (limit) {
  const score = await page(this).evaluate(() => window.__cls);
  assert.ok(Number.isFinite(score), 'layout shifts could not be measured');
  assert.ok(score <= limit, `layout shift ${score.toFixed(4)} > ${limit}`);
});

Then('the header should be as tall before the logos arrive as after', async function () {
  const p = page(this);
  await goto(this, '/', 'domcontentloaded');
  const before = await p.locator('.site-header').evaluate((el) => el.getBoundingClientRect().height);
  await p.waitForLoadState('networkidle');
  const after = await p.locator('.site-header').evaluate((el) => el.getBoundingClientRect().height);
  assert.ok(Math.abs(before - after) < 1, `header grew from ${before}px to ${after}px as images loaded`);
});

// ---------------------------------------------------------------- 404 -------------------------------------------------

Then('the response status should be {int}', function (status) {
  assert.equal(this.b.lastStatus, status);
});

Then('the page should show the {string} 404 message', async function (locale) {
  assert.equal((await page(this).locator('h1').textContent()).trim(), loadMessages(locale).notFound.heading);
});

Then('the page should ask search engines not to index it', async function () {
  assert.equal(await page(this).locator('meta[name="robots"]').getAttribute('content'), 'noindex');
});

When('I click the link {string}', async function (name) {
  await page(this).getByRole('link', { name, exact: true }).first().click();
  await page(this).waitForLoadState('load');
});

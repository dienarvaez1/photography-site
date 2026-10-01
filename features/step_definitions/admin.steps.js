import { Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIST_DIR, ROOT, pageLocale } from '../support/lib.js';

const text = (el) => el.text.replace(/\s+/g, ' ').trim();
const root = (world) => world.data.page.root;

Then('the page heading should be {string} in the language {string}', function (heading, language) {
  assert.equal(pageLocale(this.data.page), language);
  assert.equal(text(root(this).querySelector('h1')), heading);
});

Then('the header links after the Portfolio menu should be, in order: {string}', function (expected) {
  const links = root(this).querySelectorAll('#primary-nav > a').map(text);
  assert.deepEqual(links, expected.split(',').map((l) => l.trim()));
});

Then('the {string} link should lead to {string}', function (name, path) {
  const link = root(this).querySelectorAll('#primary-nav > a').find((a) => text(a) === name);
  assert.ok(link, `no ${name} link`);
  assert.equal(link.getAttribute('href'), path);
  assert.ok(readdirSync(join(DIST_DIR, path)).includes('index.html'), `${path} must be a built page`);
});

Then('the active header link should be {string}', function (name) {
  assert.deepEqual(root(this).querySelectorAll('#primary-nav > a.active').map(text), [name]);
});

const tabs = (world) => root(world).querySelectorAll('[role="tab"]');
const panels = (world) => root(world).querySelectorAll('[role="tabpanel"]');

Then('the page should have one tab list labelled {string} holding exactly these tabs, in order: {string}', function (label, expected) {
  const lists = root(this).querySelectorAll('[role="tablist"]');
  assert.equal(lists.length, 1);
  assert.equal(lists[0].getAttribute('aria-label'), label);
  const inList = lists[0].querySelectorAll('[role="tab"]').map(text);
  const names = expected.split(',').map((t) => t.trim());
  assert.deepEqual(inList, names);
  assert.equal(tabs(this).length, names.length, `exactly ${names.length} tabs on the page`);
  assert.ok(lists[0].querySelectorAll('button[role="tab"]').length === names.length, 'tabs are real buttons');
});

Then('each tab should control its own panel, and each panel should be labelled by its tab', function () {
  const controlled = tabs(this).map((tab) => tab.getAttribute('aria-controls'));
  assert.equal(new Set(controlled).size, tabs(this).length, 'one panel per tab');
  tabs(this).forEach((tab) => {
    const panel = root(this).querySelector(`#${tab.getAttribute('aria-controls')}`);
    assert.ok(panel, `panel for ${tab.id}`);
    assert.equal(panel.getAttribute('role'), 'tabpanel');
    assert.equal(panel.getAttribute('aria-labelledby'), tab.id);
  });
  assert.equal(panels(this).length, tabs(this).length);
});

Then("the first tab should be selected and reachable by keyboard, the rest selected-off and out of the tab order", function () {
  const [first, ...rest] = tabs(this);
  assert.deepEqual([first.getAttribute('aria-selected'), first.getAttribute('tabindex')], ['true', '0']);
  rest.forEach((tab) => assert.deepEqual([tab.getAttribute('aria-selected'), tab.getAttribute('tabindex')], ['false', '-1']));
});

Then("the first panel should be visible and the rest hidden, each headed by its tab's name", function () {
  const [first, ...rest] = panels(this);
  assert.equal(first.getAttribute('hidden') ?? null, null, 'first panel must be visible');
  rest.forEach((panel, i) => assert.notEqual(panel.getAttribute('hidden') ?? null, null, `panel ${i + 2} must start hidden`));
  tabs(this).forEach((tab, i) => assert.equal(text(panels(this)[i].querySelector('h2')), text(tab)));
});

Then('the tab list should be laid out horizontally in the built styles', function () {
  const dir = join(DIST_DIR, '_astro');
  const css = readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(dir, f), 'utf-8')).join('\n');
  const inline = ['admin/index.html'].map((f) => readFileSync(join(DIST_DIR, f), 'utf-8')).join('\n');
  const rule = (css + inline).match(/\.tablist[^{]*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(rule, /display:\s*flex/);
  assert.match(rule, /flex-direction:\s*row/);
});

Then('the tabs should be hidden in the built page, with only the token box shown before them', function () {
  const tabs = root(this).querySelector('[data-tabs]');
  assert.ok(tabs?.hasAttribute('hidden'), 'the tabs carry `hidden` in the HTML itself (revealed by script only after the token is accepted)');
  const gate = root(this).querySelector('[data-admin-gate]');
  assert.ok(gate && !gate.hasAttribute('hidden'), 'the token box is there');
  // Nothing in the page shows the panels without JavaScript any more (the old <noscript> style that did is gone).
  assert.ok(!root(this).querySelectorAll('noscript').some((n) => /tabpanel/.test(n.text)), 'no fallback that shows the panels');
});

Then('without JavaScript the token box should say {string}', function (message) {
  assert.equal(root(this).querySelector('[data-admin-gate] noscript')?.text.trim().replace(/<[^>]+>/g, ''), message);
});

Then('the page should ask search engines not to index it, and declare no canonical or alternate URLs', function () {
  assert.equal(root(this).querySelector('meta[name="robots"]')?.getAttribute('content'), 'noindex');
  assert.equal(root(this).querySelector('link[rel="canonical"]'), null);
  assert.equal(root(this).querySelectorAll('link[rel="alternate"]').length, 0);
});

Then('the sitemap should not list {string}', function (route) {
  const xml = readdirSync(DIST_DIR).filter((f) => /^sitemap-\d+\.xml$/.test(f)).map((f) => readFileSync(join(DIST_DIR, f), 'utf-8')).join('');
  assert.ok(xml.includes('<loc>'), 'the sitemap lists pages');
  assert.ok(!xml.includes(route), `${route} must not be in the sitemap`);
});

// --- Signing out when left alone -----------------------------------------------------------------------------------------

const adminConfig = await import(join(ROOT, 'src/config/admin.ts'));

Then('the idle timeout in the site configuration should be {int} minutes', function (minutes) {
  assert.equal(adminConfig.ADMIN_IDLE_TIMEOUT_MINUTES, minutes);
});

Then('the README should say the Admin page signs out after {int} minutes of inactivity', function (minutes) {
  assert.match(readFileSync(join(ROOT, 'README.md'), 'utf-8'), new RegExp(`signs? out after ${minutes} minutes of inactivity`, 'i'));
});

Then('the idle timeout should be restarted by a click, pointer movement, key press, scroll and touch, and by nothing the page does by itself', function () {
  const code = readFileSync(join(ROOT, 'src/lib/admin-session.ts'), 'utf-8');
  const listed = /const ACTIVITY = \[([^\]]*)\]/.exec(code)[1].match(/'(\w+)'/g).map((s) => s.slice(1, -1));
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart']) assert.ok(listed.includes(type), `${type} counts as being there`);
  assert.doesNotMatch(code, /fetch\(|setTimeout\([^)]*touch|AUTH_EVENT|REFRESH_EVENT/, 'requests and the page\'s own events do not count');
  const common = readFileSync(join(ROOT, 'src/lib/admin-common.ts'), 'utf-8');
  assert.equal([...common.matchAll(/remembered\.touch\(\)/g)].length, 0, 'only the session module touches the clock');
  assert.match(common, /IDLE_LIMIT_MS = ADMIN_IDLE_TIMEOUT_MINUTES \* 60 \* 1000/);
});

Then('the {string} reminder shown after an idle sign-out should contain the placeholder for the minutes and no fixed number', function (locale) {
  const message = JSON.parse(readFileSync(join(ROOT, 'src/i18n', `${locale}.json`), 'utf-8')).admin.results.gate.timedOut;
  assert.match(message, /\{minutes\}/);
  assert.doesNotMatch(message, /\d/);
});

Then('the scripts of the built page {string} should contain the idle sign-out', function (_page) {
  const dir = join(DIST_DIR, '_astro');
  const scripts = readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dir, f), 'utf-8')).join('\n');
  assert.match(scripts, /admin-token-seen/);
  assert.match(scripts, /visibilitychange/);
  assert.match(scripts, /admin-timed-out/);
});

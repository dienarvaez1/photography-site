import { Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { allBuiltCss, DIST_DIR, loadLocaleConfig, loadMessages, ROOT } from '../support/lib.js';

// Matches the modern CSS Media Queries Level 4 "range" syntax, e.g.
// "@media (width<=720px)" or "@media (400px <= width <= 700px)" — this is
// what Safari <16.4 and legacy Edge/IE fail to parse, silently dropping the
// whole rule instead of degrading (see astro.config.mjs cssTarget comment).
const RANGE_MEDIA_QUERY = /@media[^{]*\d[^{]*[<>]=?[^{]*/;

Then('no built CSS should use range media-query syntax', async function () {
  const violations = (await allBuiltCss())
    .filter((chunk) => RANGE_MEDIA_QUERY.test(chunk.css))
    .map((chunk) => chunk.source);
  assert.deepEqual(violations, [], 'Found CSS using unsupported range media-query syntax');
});

Then('the {string} menu trigger should be a real button element on every page', function (menuName) {
  assert.equal(menuName, 'Work');
  for (const { route, page } of this.data.pages) {
    const trigger = page.root.querySelector('#nav-work-toggle');
    assert.ok(trigger, `${route}: could not find the "Work" menu trigger element`);
    assert.equal(trigger.tagName, 'BUTTON', `${route}: the "Work" menu trigger is not a real <button> — keyboard users cannot reach the dropdown`);
  }
});

Then('the language switcher on every page should be a group labelled in its language', function () {
  for (const { route, locale, page } of this.data.pages) {
    const group = page.root.querySelector('.lang-switcher');
    assert.ok(group, `${route}: no language switcher`);
    assert.equal(group.getAttribute('role'), 'group', `${route}: language switcher is missing role="group"`);
    assert.equal(group.getAttribute('aria-label'), loadMessages(locale).nav.language, `${route}: switcher label is not in ${locale}`);
    for (const el of group.querySelectorAll('a, span')) {
      assert.ok(el.getAttribute('lang'), `${route}: switcher entry "${el.text.trim()}" is missing a lang attribute`);
    }
  }
});

Then('every page with a gallery should have a lightbox with dialog semantics and controls labelled in its language', function () {
  const galleryPages = this.data.pages.filter(({ page }) => page.root.querySelector('.gallery'));
  assert.ok(galleryPages.length >= 2 * 6, 'Expected gallery pages in every locale to test against');
  for (const { route, locale, page } of galleryPages) {
    const lightbox = page.root.querySelector('#lightbox');
    assert.ok(lightbox, `${route}: could not find the #lightbox element`);
    assert.equal(lightbox.getAttribute('role'), 'dialog', `${route}: lightbox is missing role="dialog"`);
    assert.equal(lightbox.getAttribute('aria-modal'), 'true', `${route}: lightbox is missing aria-modal="true"`);
    assert.ok(lightbox.getAttribute('aria-labelledby'), `${route}: lightbox is missing aria-labelledby`);
    const { gallery } = loadMessages(locale);
    assert.equal(page.root.querySelector('#lightbox-close')?.getAttribute('aria-label'), gallery.close, `${route}: close label`);
    assert.equal(page.root.querySelector('#lightbox-prev')?.getAttribute('aria-label'), gallery.previous, `${route}: previous label`);
    assert.equal(page.root.querySelector('#lightbox-next')?.getAttribute('aria-label'), gallery.next, `${route}: next label`);
    for (const tile of page.root.querySelectorAll('.tile')) {
      const expected = gallery.openPhoto.replace('{title}', tile.getAttribute('data-title'));
      assert.equal(tile.getAttribute('aria-label'), expected, `${route}: tile aria-label is not in ${locale}`);
    }
  }
});

Then('every image on every page should have an alt attribute', function () {
  for (const { route, page } of this.data.pages) {
    const images = page.root.querySelectorAll('img');
    assert.ok(images.length > 0, `${route}: expected at least one image on the page`);
    const violations = images.filter((img) => img.getAttribute('alt') === null).map((img) => img.getAttribute('src'));
    assert.deepEqual(violations, [], `${route}: found <img> elements with no alt attribute at all`);
  }
});

Then('every link that opens in a new tab on every page should set rel to noopener and noreferrer', function () {
  for (const { route, page } of this.data.pages) {
    const violations = page.root
      .querySelectorAll('a[target="_blank"]')
      .filter((a) => {
        const rel = a.getAttribute('rel') ?? '';
        return !rel.includes('noopener') || !rel.includes('noreferrer');
      })
      .map((a) => a.getAttribute('href'));
    assert.deepEqual(violations, [], `${route}: found target="_blank" links missing rel="noopener noreferrer"`);
  }
});

Then('the deployment headers file should declare the baseline security headers', function () {
  const headers = readFileSync(join(ROOT, 'public/_headers'), 'utf-8');
  const required = [
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Referrer-Policy',
    'Permissions-Policy',
  ];
  const missing = required.filter((name) => !headers.includes(name));
  assert.deepEqual(missing, [], 'public/_headers is missing required security headers');
});

Then("every page should declare an html lang attribute matching its URL's locale", async function () {
  const { LOCALES, DEFAULT_LOCALE } = await loadLocaleConfig();
  for (const { route, page } of this.data.pages) {
    const prefix = LOCALES.find((l) => l !== DEFAULT_LOCALE && (route === `/${l}/` || route.startsWith(`/${l}/`)));
    const expected = prefix ?? DEFAULT_LOCALE;
    const lang = page.root.querySelector('html')?.getAttribute('lang');
    assert.equal(lang, expected, `${route}: <html lang> should be "${expected}", got "${lang}"`);
  }
});

// --- Contrast ---------------------------------------------------------------------------------------

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Every CSS custom property declared in the theme (global.css) and the header (--lang-switch). */
function cssColours() {
  const sources = [readFileSync(join(ROOT, 'src/styles/global.css'), 'utf-8'), readFileSync(join(ROOT, 'src/components/Header.astro'), 'utf-8')];
  const colours = {};
  for (const text of sources) for (const [, name, value] of text.matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) colours[name] = value;
  return colours;
}

Then('the colour {string} on {string} should have at least {float}:1 contrast', function (fg, bg, minimum) {
  const colours = cssColours();
  assert.ok(colours[fg] && colours[bg], `Unknown colour variable: ${fg} / ${bg}`);
  const ratio = contrast(colours[fg], colours[bg]);
  assert.ok(ratio >= minimum, `${fg} ${colours[fg]} on ${bg} ${colours[bg]} is ${ratio.toFixed(2)}:1, needs ${minimum}:1`);
});

Then("the contact form's fields should use the high-contrast border colour", function () {
  const css = readFileSync(join(ROOT, 'src/pages/[...lang]/contact.astro'), 'utf-8');
  const rule = css.match(/\.contact-form input\[type='text'\][\s\S]*?\{([\s\S]*?)\}/)?.[1] ?? '';
  assert.match(rule, /border:\s*1px solid var\(--field-border\)/, 'inputs, selects and textareas must use --field-border');
  for (const control of ['input[type=\'email\']', 'select', 'textarea']) assert.ok(css.includes(`.contact-form ${control}`), `${control} shares the rule`);
});

Then('the keyboard focus outline should use a colour with enough contrast against the page', function () {
  const css = readFileSync(join(ROOT, 'src/styles/global.css'), 'utf-8');
  const outline = css.match(/:focus-visible\s*\{[^}]*outline:\s*\d+px solid var\((--[a-z-]+)\)/)?.[1];
  assert.ok(outline, 'global.css needs a :focus-visible outline that uses a colour variable');
  const colours = cssColours();
  for (const surface of ['--bg', '--bg-elevated']) assert.ok(contrast(colours[outline], colours[surface]) >= 3, `focus outline ${outline} on ${surface}`);
});

Then('the built styles should switch off transitions and animations for visitors who ask for reduced motion', function () {
  const css = allBuiltCssSync();
  const block = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]{0,500})/)?.[1] ?? '';
  assert.ok(block, 'no prefers-reduced-motion rule in the built CSS');
  // The minifier writes 0.01ms as .01ms.
  assert.match(block, /transition-duration:\s*0?\.01ms/);
  assert.match(block, /animation-duration:\s*0?\.01ms/);
});

function allBuiltCssSync() {
  const dir = join(DIST_DIR, '_astro');
  return readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(dir, f), 'utf-8')).join('\n');
}

Then('the contact form should post to the Web3Forms API with the POST method', function () {
  const form = this.data.page.root.querySelector('#contact-form');
  assert.equal(form.getAttribute('action'), 'https://api.web3forms.com/submit');
  assert.equal(form.getAttribute('method')?.toUpperCase(), 'POST');
});

Then('every contact form control should have a name so a plain submit carries the message', function () {
  const form = this.data.page.root.querySelector('#contact-form');
  const names = form.querySelectorAll('input, select, textarea').map((c) => c.getAttribute('name'));
  assert.ok(names.every(Boolean), `unnamed control in ${names}`);
  for (const required of ['access_key', 'name', 'email', 'category', 'message', 'botcheck']) assert.ok(names.includes(required), `missing ${required}`);
});

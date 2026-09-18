import { Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allBuiltCss, ROOT } from '../support/lib.js';

// Matches the modern CSS Media Queries Level 4 "range" syntax, e.g.
// "@media (width<=720px)" or "@media (400px <= width <= 700px)" — this is
// what Safari <16.4 and legacy Edge/IE fail to parse, silently dropping the
// whole rule instead of degrading (see astro.config.mjs cssTarget comment).
const RANGE_MEDIA_QUERY = /@media[^{]*\d[^{]*[<>]=?[^{]*/;

Then('no built CSS should use range media-query syntax', function () {
  const violations = allBuiltCss()
    .filter((chunk) => RANGE_MEDIA_QUERY.test(chunk.css))
    .map((chunk) => chunk.source);
  assert.deepEqual(violations, [], 'Found CSS using unsupported range media-query syntax');
});

Then('the {string} menu trigger should be a real button element', function (menuName) {
  assert.equal(menuName, 'Work');
  const trigger = this.data.page.root.querySelector('#nav-work-toggle');
  assert.ok(trigger, 'Could not find the "Work" menu trigger element');
  assert.equal(trigger.tagName, 'BUTTON', 'The "Work" menu trigger is not a real <button> — keyboard users cannot reach the dropdown');
});

Then('the lightbox should declare dialog role and modal attributes', function () {
  const lightbox = this.data.page.root.querySelector('#lightbox');
  assert.ok(lightbox, 'Could not find the #lightbox element');
  assert.equal(lightbox.getAttribute('role'), 'dialog', 'Lightbox is missing role="dialog"');
  assert.equal(lightbox.getAttribute('aria-modal'), 'true', 'Lightbox is missing aria-modal="true"');
  assert.ok(lightbox.getAttribute('aria-labelledby'), 'Lightbox is missing aria-labelledby');
});

Then('every image on the page should have an alt attribute', function () {
  const images = this.data.page.root.querySelectorAll('img');
  assert.ok(images.length > 0, 'Expected at least one image on the page to test against');
  const violations = images
    .filter((img) => img.getAttribute('alt') === null)
    .map((img) => img.getAttribute('src'));
  assert.deepEqual(violations, [], 'Found <img> elements with no alt attribute at all');
});

Then('every link that opens in a new tab should set rel to noopener and noreferrer', function () {
  const links = this.data.page.root.querySelectorAll('a[target="_blank"]');
  const violations = links
    .filter((a) => {
      const rel = a.getAttribute('rel') ?? '';
      return !rel.includes('noopener') || !rel.includes('noreferrer');
    })
    .map((a) => a.getAttribute('href'));
  assert.deepEqual(violations, [], 'Found target="_blank" links missing rel="noopener noreferrer"');
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

Then('the page should declare a non-empty html lang attribute', function () {
  const lang = this.data.page.root.querySelector('html')?.getAttribute('lang');
  assert.ok(lang && lang.trim(), 'Page is missing a non-empty <html lang="...">');
});

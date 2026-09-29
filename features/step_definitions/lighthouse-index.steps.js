import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { parse } from 'node-html-parser';
import { renderIndex } from '../support/lighthouse-index.js';
import { checked, fakeResult } from '../support/lighthouse-fixtures.js';

const DEVICES = { phone: 'mobile', laptop: 'desktop' };
const NAMES = { phone: 'Phone', laptop: 'Laptop' };
const state = (world) => (world.data.lighthouseIndex ??= { results: [] });

Given(/^Lighthouse measured "([^"]+)" on a (phone|laptop) with performance (\d+) and a Largest Contentful Paint of (\d+) ms$/, function (path, name, performance, lcp) {
  state(this).results.push(fakeResult(path, DEVICES[name], { performance: Number(performance) / 100, lcp: Number(lcp) }));
});

Given('that measurement logged the browser error {string}', function (message) {
  state(this).results.at(-1).lhr.audits['errors-in-console'].details.items.push({ source: 'security', description: message });
});

When('the index page is written', function () {
  state(this).html = renderIndex({ baseUrl: 'https://example.org', runs: 3, generatedAt: new Date('2026-09-29T12:34:56Z'), results: checked(state(this).results) });
  state(this).root = parse(state(this).html);
});

const root = (world) => state(world).root;
const rows = (world) => root(world).querySelectorAll('tbody tr');
const rowFor = (world, path, name) => {
  const found = rows(world).find((tr) => tr.querySelector('th').text.trim() === path && tr.querySelectorAll('td')[0].text.trim() === NAMES[name]);
  assert.ok(found, `no row for ${path} on a ${name}`);
  return found;
};
const missedSection = (world) => root(world).querySelector('section[aria-labelledby="missed-heading"]');

Then('it should list {int} measurements, in this order: {string}', function (count, order) {
  const shown = rows(this).map((tr) => `${tr.querySelector('th').text.trim()} ${tr.querySelectorAll('td')[0].text.trim()}`);
  assert.equal(shown.length, count);
  assert.deepEqual(shown, order.split(', '));
});

Then('the row for {string} on a {word} should show performance {string} and a Largest Contentful Paint of {string}', function (path, name, performance, lcp) {
  const cells = rowFor(this, path, name).querySelectorAll('td').map((td) => td.text.trim());
  // Device, then the four scores (performance first), then the four timings (FCP, LCP, TBT, CLS).
  assert.equal(cells[1], performance);
  assert.equal(cells[6], lcp);
});

Then('every row should link to its full report and to the page itself', function () {
  for (const tr of rows(this)) {
    const links = tr.querySelectorAll('a').map((a) => a.getAttribute('href'));
    const path = tr.querySelector('th').text.trim();
    assert.ok(links.includes(`https://example.org${path}`), `${path}: no link to the page (${links})`);
    assert.ok(links.some((href) => /^(mobile|desktop)-[a-z0-9-]+\.html$/.test(href)), `${path}: no link to its report (${links})`);
  }
});

Then('it should say {string}', function (text) {
  assert.ok(root(this).querySelector('.summary').text.includes(text), root(this).querySelector('.summary').text);
});

Then('it should have no {string} section', function (heading) {
  assert.equal(missedSection(this), null, `unexpected "${heading}" section`);
});

Then('the row for {string} on a {word} should be marked over budget', function (path, name) {
  const tr = rowFor(this, path, name);
  assert.ok(tr.classList.contains('missed'));
  assert.equal(tr.querySelector('.pill').text.trim(), 'Over budget');
});

Then('the row for {string} on a {word} should be marked within budget', function (path, name) {
  const tr = rowFor(this, path, name);
  assert.ok(!tr.classList.contains('missed'));
  assert.equal(tr.querySelector('.pill').text.trim(), 'Within budget');
});

const problems = (world) => {
  const section = missedSection(world);
  assert.ok(section, 'no "What was over budget" section');
  return section.querySelectorAll('.misses > li').map((li) => ({ miss: li.querySelector('.miss').text.trim(), where: li.querySelector('.where').text.trim() }));
};

Then('its "What was over budget" section should list {string} for {string}', function (miss, where) {
  const found = problems(this).find((p) => p.miss === miss);
  assert.ok(found, `"${miss}" not listed: ${JSON.stringify(problems(this))}`);
  assert.equal(found.where, where);
});

Then('its "What was over budget" section should list {int} problem(s)', function (count) {
  assert.equal(problems(this).length, count, JSON.stringify(problems(this)));
});

Then('the page should show that text as text, never as markup', function () {
  assert.equal(root(this).querySelectorAll('script').length, 0);
  assert.ok(state(this).html.includes('&lt;script src=x&gt;'));
});

Then('it should contain no scripts and load nothing from anywhere', function () {
  const r = root(this);
  assert.equal(r.querySelectorAll('script, link[rel="stylesheet"], img, iframe, object, embed').length, 0);
  assert.ok(!/@import|url\(/i.test(r.querySelector('style').text), 'the styles load nothing');
});

Then('it should name the site measured, when, and how many runs per page', function () {
  const meta = root(this).querySelector('.meta').text.replace(/\s+/g, ' ');
  assert.ok(meta.includes('https://example.org'), meta);
  assert.ok(meta.includes('2026-09-29 12:34 UTC'), meta);
  assert.ok(meta.includes('3 runs per page'), meta);
});

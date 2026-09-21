import { Then, Given } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIST_DIR, ROOT, loadMessages, readBuiltPage } from '../support/lib.js';

const view = await import(join(ROOT, 'src/lib/results-view.ts'));
const { RESULTS_API_URL } = await import(join(ROOT, 'src/config/results.ts'));


Then('the address {string} should show {}', function (hash, expected) {
  const route = view.parseRoute(hash);
  if (expected === 'another tab') assert.equal(route, null);
  else if (expected === 'the list of runs') assert.deepEqual(route, { view: 'list' });
  else assert.deepEqual(route, { view: 'run', runId: /^the run "(.+)"$/.exec(expected)[1] });
});

Then('the link to the run {string} should be shown as that same run again', function (runId) {
  assert.deepEqual(view.parseRoute(view.runHash(runId)), { view: 'run', runId });
  assert.equal(view.runHash(runId), `#test-results/run/${runId}`);
});

Then('{int} milliseconds should be shown as {string}', function (ms, text) {
  assert.equal(view.formatDuration(ms), text);
});

Then('the moment {string} in {string} should read {string}', function (value, locale, text) {
  assert.equal(view.formatDate(value, locale), text);
});

Then('the message {string} with passed {int} and scenarios {int} should read {string}', function (template, passed, scenarios, text) {
  assert.equal(view.formatMessage(template, { passed, scenarios }), text);
});

Then('the message {string} with no values should read {string}', function (template, text) {
  assert.equal(view.formatMessage(template), text);
});

Then('totals of {int} scenarios, {int} passed, {int} failed and {int} skipped should read {string}', function (scenarios, passed, failed, skipped, text) {
  const messages = loadMessages('en').admin.results.totals;
  assert.equal(view.describeTotals({ scenarios, passed, failed, skipped }, messages), text);
});

Then('with the page on {string} and the query {string}, the results address should be {string}', function (host, query, address) {
  assert.equal(view.resolveApiUrl('https://api.configured.test', query, host), address);
});

Then('the link {string} should be {word} for the API {string}', function (link, verdict, api) {
  assert.equal(view.isApiLink(link, api), verdict === 'followed');
});

// --- Sorting a run's files -------------------------------------------------------------------------------

const link = (path) => `https://api.test/files/run/${path}?exp=1&sig=x`;
Given('the links of a run with reports, smoke data and evidence for two failed scenarios', function () {
  const paths = ['smoke.json', 'browser.json', 'offline.json', 'offline.html', 'browser.html', 'summary.json', 'artifacts/browser/b-fails.png', 'artifacts/browser/a-fails.txt', 'artifacts/browser/a-fails.zip', 'artifacts/browser/a-fails.png'];
  this.data.links = Object.fromEntries(paths.map((p) => [p, link(p)]));
});

Then('the reports should be listed as: {string}', function (expected) {
  assert.deepEqual(view.listReports(this.data.links).map((r) => r.path), expected.split(', '));
});

Then('the failure evidence should be grouped per failed scenario as: {string}', function (expected) {
  const text = view.groupArtifacts(this.data.links).map((a) => `${a.suite}/${a.slug} (${['screenshot', 'trace', 'log'].filter((k) => a[k]).join(', ')})`).join(', ');
  assert.equal(text, expected);
});

Then('no file link should be lost or listed twice', function () {
  const listed = [...view.listReports(this.data.links).map((r) => r.link), ...view.groupArtifacts(this.data.links).flatMap((a) => [a.screenshot, a.trace, a.log].filter(Boolean))];
  const expected = Object.entries(this.data.links).filter(([path]) => path !== 'summary.json').map(([, l]) => l);
  assert.deepEqual([...listed].sort(), [...expected].sort());
});

// --- What is built -----------------------------------------------------------------------------------------------

Then('the built page {string} should hold the results viewer for the configured API with {string} messages', function (page, locale) {
  const { root } = readBuiltPage(page);
  const container = root.querySelector('[data-results]');
  assert.ok(container, 'the Test Results panel holds the viewer container');
  assert.equal(container.getAttribute('data-api'), RESULTS_API_URL);
  assert.equal(container.getAttribute('data-locale'), locale);
  assert.ok(container.closest('#panel-test-results'), 'the viewer is inside the Test Results panel');
  const messages = JSON.parse(container.getAttribute('data-messages'));
  assert.deepEqual(messages, loadMessages(locale).admin.results);
  assert.equal(container.querySelector('[data-results-root]').getAttribute('aria-live'), 'polite');
});

const builtScripts = () => readdirSync(join(DIST_DIR, '_astro')).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(DIST_DIR, '_astro', f), 'utf-8'));

Then('the built page {string} and its scripts should contain no admin token, no bucket credentials and no bucket address', function (page) {
  const text = [readBuiltPage(page).html, ...builtScripts()].join('\n');
  assert.doesNotMatch(text, /ADMIN_TOKEN\s*[:=]\s*["'`][^"'`]{8,}/);
  assert.doesNotMatch(text, /Bearer [A-Za-z0-9._~+/-]{12,}/);
  assert.doesNotMatch(text, /r2\.cloudflarestorage\.com/);
  assert.doesNotMatch(text, /CLOUDFLARE_API_TOKEN\s*[:=]/);
  assert.doesNotMatch(text, /photography-site-test/, 'the private bucket is only reachable through the API');
});

Then('the built page {string} should tell visitors without JavaScript that the viewer needs it', function (page) {
  const { root } = readBuiltPage(page);
  const message = root.querySelector('#panel-test-results noscript');
  assert.ok(message);
  assert.match(message.text, new RegExp(loadMessages('en').admin.results.needsJs.slice(0, 30)));
});

Then('the built page {string} should have {string} and {string} buttons in the header beside its title, hidden until script shows them, and none inside the tabs', function (page, refresh, signOut) {
  const { root } = readBuiltPage(page);
  const head = root.querySelector('.admin-head');
  assert.ok(head?.querySelector('h1'), 'the header holds the title');
  const actions = head.querySelector('[data-admin-actions]');
  assert.ok(actions, 'and the buttons');
  assert.ok(actions.hasAttribute('hidden'), 'hidden until script shows them');
  assert.deepEqual(actions.querySelectorAll('button').map((b) => b.text.trim()), [refresh, signOut]);
  assert.equal(actions.getAttribute('role'), 'group');
  assert.ok(actions.getAttribute('aria-label'));
  for (const panel of root.querySelectorAll('[role="tabpanel"]')) assert.equal(panel.querySelectorAll('button').length, 0, 'no button is built into a panel');
});

Then('no viewer should build a Refresh or Sign out button of its own, and the top buttons should only ask the viewers to reload or forget the token', function () {
  for (const file of ['results-viewer.ts', 'pics-viewer.ts']) {
    const code = readFileSync(join(ROOT, 'src/lib', file), 'utf-8');
    assert.doesNotMatch(code, /m\('refresh'\)|m\('signOut'\)/, `${file} builds its own button`);
    assert.match(code, /REFRESH_EVENT/, `${file} answers the page's Refresh`);
  }
  const actions = readFileSync(join(ROOT, 'src/lib/admin-actions.ts'), 'utf-8');
  assert.match(actions, /dispatchEvent\(new Event\(REFRESH_EVENT\)\)/);
  assert.match(actions, /remembered\.set\(''\)/);
  assert.doesNotMatch(actions, /fetch\(|api</);
});

const viewerCode = () => ['results-viewer.ts', 'admin-common.ts', 'pics-viewer.ts'].map((f) => readFileSync(join(ROOT, 'src/lib', f), 'utf-8')).join('\n');

Then("the viewer's code should never use innerHTML, outerHTML, insertAdjacentHTML, document.write, eval or new Function", function () {
  assert.doesNotMatch(viewerCode(), /\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function)\b/);
});

Then("the viewer's code should keep the token in sessionStorage only and send it only in the Authorization header to the results API", function () {
  const code = viewerCode();
  assert.doesNotMatch(code, /localStorage|document\.cookie|indexedDB/);
  assert.match(code, /sessionStorage/);
  assert.equal([...code.matchAll(/fetch\(/g)].length, 1, 'one place makes requests');
  assert.match(code, /fetch\(`\$\{apiUrl\}\$\{path\}`, \{ headers: \{ Authorization: `Bearer \$\{token\}` \} \}\)/);
  assert.doesNotMatch(readFileSync(join(ROOT, 'src/lib/pics-viewer.ts'), 'utf-8'), /localStorage|sessionStorage|fetch\(/, 'the pics viewer uses the shared token and request code');
  assert.doesNotMatch(code, /\?token=|&token=|href.*token/);
});

import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { DIST_DIR, ROOT, listBuiltRoutes, loadMessages, readBuiltPage } from '../support/lib.js';

const buildEnv = await import(join(ROOT, 'scripts/lib/build-env.mjs'));
const site = (await import(join(ROOT, 'src/config/site.ts'))).SITE;
const photos = await import(join(ROOT, 'src/config/photos.ts'));
const resultsConfig = await import(join(ROOT, 'src/config/results.ts'));

const GOOD = { GOOD_A: '11111111-1111-4111-8111-111111111111', GOOD_B: '22222222-2222-4222-8222-222222222222' };
const value = (raw) => (raw === 'missing' ? undefined : GOOD[raw] ?? raw);
const parseEnv = (text) =>
  text === 'none' ? {} : Object.fromEntries(text.split(';').map((pair) => { const [k, v] = pair.split('='); return [k, value(v)]; }));
const args = (text) => text.split(/\s+/).filter(Boolean);
const pkg = () => JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const readme = () => readFileSync(join(ROOT, 'README.md'), 'utf-8');

// --- The guard ----------------------------------------------------------------------

Then('a build with environment {string} and arguments {string} should count as a release build: {string}', function (env, argv, expected) {
  assert.equal(buildEnv.isReleaseBuild(parseEnv(env), args(argv)), expected === 'yes');
});

Then('the contact-form keys {string} and {string} should have this problem: {string}', function (english, spanish, problem) {
  const problems = buildEnv.keyProblems({ PUBLIC_WEB3FORMS_KEY: value(english), PUBLIC_WEB3FORMS_KEY_ES: value(spanish) });
  if (problem === 'none') assert.deepEqual(problems, []);
  else assert.ok(problems.some((p) => p.includes(problem)), `Expected a problem mentioning "${problem}", got: ${JSON.stringify(problems)}`);
});

Given(/^a copy of the build guard in a folder with (no \.env file|both keys)$/, function (dotenv) {
  // The script finds its project root from its own location, so run a copy in a scratch folder.
  const dir = mkdtempSync(join(tmpdir(), 'guard-'));
  mkdirSync(join(dir, 'scripts', 'lib'), { recursive: true });
  cpSync(join(ROOT, 'scripts/check-build-env.mjs'), join(dir, 'scripts/check-build-env.mjs'));
  cpSync(join(ROOT, 'scripts/lib/build-env.mjs'), join(dir, 'scripts/lib/build-env.mjs'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  if (dotenv === 'both keys') writeFileSync(join(dir, '.env'), `PUBLIC_WEB3FORMS_KEY=${GOOD.GOOD_A}\nPUBLIC_WEB3FORMS_KEY_ES=${GOOD.GOOD_B}\n`);
  this.data.guardDir = dir;
});

When('the build guard runs with environment {string} and arguments {string}', function (env, argv) {
  // A clean environment: only what the scenario names, so the developer's own variables can't leak in.
  const result = spawnSync(process.execPath, [join(this.data.guardDir, 'scripts/check-build-env.mjs'), ...args(argv)], {
    env: { PATH: process.env.PATH, ...parseEnv(env) },
    encoding: 'utf-8',
  });
  this.data.guard = result;
  rmSync(this.data.guardDir, { recursive: true, force: true });
});

Then('the build guard should {}', function (outcome) {
  const { status, stdout, stderr } = this.data.guard;
  if (outcome.startsWith('fail')) {
    assert.equal(status, 1, `Expected the guard to fail. ${stdout}${stderr}`);
    for (const name of ['PUBLIC_WEB3FORMS_KEY', 'PUBLIC_WEB3FORMS_KEY_ES', 'Cloudflare']) assert.ok(stderr.includes(name), `Error output should mention ${name}:\n${stderr}`);
  } else {
    assert.equal(status, 0, stderr);
    if (outcome.includes('confirm')) assert.match(stdout, /keys present/);
    else assert.equal(stdout.trim() + stderr.trim(), '', 'A normal local build should not print anything');
  }
});

// --- npm scripts ---------------------------------------------------------------------

Then('the {string} script should be preceded by the {string} script running the build guard', function (main, pre) {
  const { scripts } = pkg();
  assert.ok(scripts[main], `no ${main} script`);
  assert.match(scripts[pre] ?? '', /scripts\/check-build-env\.mjs/, `${pre} must run the build guard (npm runs it automatically before ${main})`);
});

Then('the {string} script should build, then deploy with wrangler, then smoke-check the live site, in that order', function (name) {
  const command = pkg().scripts[name];
  const at = (needle) => command.indexOf(needle);
  assert.ok(at('build') >= 0 && at('wrangler deploy') > at('build') && at('smoke') > at('wrangler deploy'), `unexpected order: ${command}`);
});

Then('the {string} script should require the keys, run the tests and verify the photos before anything is deployed', function (name) {
  const command = pkg().scripts[name];
  const at = (needle) => command.indexOf(needle);
  assert.ok(at('check-build-env.mjs --require') >= 0, 'must require the keys');
  assert.ok(at('npm test') > at('check-build-env.mjs'), 'must run the tests after the key check');
  assert.ok(at('photos:verify') > at('npm test'), 'must verify the photos after the tests');
});

Then('the {string} script should exist as an explicit way around the checks', function (name) {
  const { scripts } = pkg();
  assert.ok(scripts[name]?.includes('wrangler deploy'));
  assert.ok(!scripts[name].includes('smoke'), 'the unchecked deploy skips the checks');
});

Then('the {string} and {string} scripts should exist', function (a, b) {
  const { scripts } = pkg();
  assert.ok(scripts[a] && scripts[b]);
});

Then('the README should name both build variables and the Cloudflare settings page they go in', function () {
  const text = readme();
  for (const needle of ['PUBLIC_WEB3FORMS_KEY', 'PUBLIC_WEB3FORMS_KEY_ES', 'Settings', 'Builds', 'Variables and secrets']) {
    assert.ok(text.includes(needle), `README should mention "${needle}"`);
  }
});

// --- GitHub workflows ------------------------------------------------------------------

const workflow = (name) => yaml.load(readFileSync(join(ROOT, '.github/workflows', name), 'utf-8'));
const stepsOf = (job) => job.steps.map((s) => `${s.name ?? ''} ${s.run ?? ''} ${s.uses ?? ''}`);

Then('the CI workflow should run on pushes to main and on pull requests', function () {
  const { on } = workflow('ci.yml');
  assert.deepEqual(on.push.branches, ['main']);
  assert.ok('pull_request' in on);
});

Then('the CI workflow should type-check, run the tests, run the browser tests and audit dependencies', function () {
  const runs = stepsOf(workflow('ci.yml').jobs.test).join('\n');
  for (const command of ['npm ci', 'astro check', 'npm test', 'npm run test:browser', 'npm audit', 'playwright install']) {
    assert.ok(runs.includes(command), `CI should run "${command}"`);
  }
});

Then("the CI workflow's placeholder keys should satisfy the release-build guard", function () {
  const env = workflow('ci.yml').jobs.test.env;
  assert.deepEqual(buildEnv.keyProblems(env), [], 'CI sets CI=true, so the guard requires valid, distinct keys');
});

Then('the CI workflow should smoke-check the live site only for pushes to main, after the tests pass and after waiting for Cloudflare', function () {
  const job = workflow('ci.yml').jobs['live-smoke'];
  assert.match(job.if, /push/);
  assert.match(job.if, /refs\/heads\/main/);
  assert.equal(job.needs, 'test');
  const runs = stepsOf(job);
  assert.ok(runs.findIndex((s) => s.includes('sleep')) < runs.findIndex((s) => s.includes('smoke.mjs')), 'must wait before checking');
});

Then('the smoke workflow should run every few hours and on demand', function () {
  const { on, jobs } = workflow('smoke.yml');
  assert.ok(on.workflow_dispatch !== undefined);
  const cron = on.schedule[0].cron;
  assert.match(cron, /\*\/([1-9]|1[0-2]) \* \* \*$/, `cron "${cron}" should repeat within 12 hours`);
  assert.ok(stepsOf(jobs.smoke).join('\n').includes('smoke.mjs'));
});

Then("the workflows' Node version should satisfy the package's engines requirement", function () {
  const minimum = Number(pkg().engines.node.match(/(\d+)/)[1]);
  for (const file of ['ci.yml', 'smoke.yml']) {
    for (const job of Object.values(workflow(file).jobs)) {
      const setup = job.steps.find((s) => s.uses?.startsWith('actions/setup-node'));
      assert.ok(Number(setup.with['node-version']) >= minimum, `${file}: Node ${setup.with['node-version']} < ${minimum}`);
    }
  }
});

Then('the engines requirement should allow native TypeScript imports', function () {
  // The tests and scripts import .ts files directly; Node runs them without a flag from 22.18.
  const [major, minor] = pkg().engines.node.match(/(\d+)\.(\d+)/).slice(1).map(Number);
  assert.ok(major > 22 || (major === 22 && minor >= 18), `engines.node ${pkg().engines.node} is older than 22.18`);
});

// --- robots.txt --------------------------------------------------------------------------

Then('the built robots.txt should allow crawling and point at the sitemap on the configured site URL', function () {
  const robots = readFileSync(join(DIST_DIR, 'robots.txt'), 'utf-8');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.equal(robots.match(/^Sitemap:\s*(\S+)/m)?.[1], new URL('sitemap-index.xml', site.url).href);
  assert.ok(existsSync(join(DIST_DIR, 'sitemap-index.xml')), 'the advertised sitemap must exist');
});

Then('no hand-written robots.txt should exist in public', function () {
  assert.ok(!existsSync(join(ROOT, 'public/robots.txt')), 'public/robots.txt would shadow the generated one and can drift from SITE.url');
});

// --- 404 pages ----------------------------------------------------------------------------

Given('the built error page {string}', function (route) {
  this.data.route = route;
  this.data.page = readBuiltPage(route);
});

const localeOf = (world) => world.data.route.startsWith('/es/') ? 'es' : 'en';

Then('it should be in the language {string} with the localized 404 heading', function (language) {
  const { root } = this.data.page;
  assert.equal(root.querySelector('html').getAttribute('lang'), language);
  assert.equal(root.querySelector('h1').text.trim(), loadMessages(language).notFound.heading);
  assert.equal(root.querySelector('.eyebrow').text.trim(), loadMessages(language).notFound.eyebrow);
});

Then('it should ask search engines not to index it and declare no canonical or alternate URL', function () {
  const { root } = this.data.page;
  assert.equal(root.querySelector('meta[name="robots"]')?.getAttribute('content'), 'noindex');
  assert.equal(root.querySelector('link[rel="canonical"]'), null);
  assert.deepEqual(root.querySelectorAll('link[rel="alternate"]').length, 0);
});

Then('its links should stay in the {string} version of the site', function (language) {
  const links = this.data.page.root.querySelectorAll('main a[href^="/"]').map((a) => a.getAttribute('href'));
  assert.ok(links.length >= 3, 'the 404 page should offer ways back');
  for (const href of links) assert.equal(href.startsWith('/es/'), language === 'es', `${href} is in the wrong language`);
});

Then("its language switcher should lead to the other language's home page, never to a page that does not exist", function () {
  const links = this.data.page.root.querySelectorAll('.lang-switcher a').map((a) => a.getAttribute('href'));
  assert.deepEqual(links, [localeOf(this) === 'es' ? '/' : '/es/']);
  for (const href of links) assert.ok(existsSync(join(DIST_DIR, href, 'index.html')), `${href} must be a built page`);
});

Then('it should have the site header and footer', function () {
  const { root } = this.data.page;
  assert.ok(root.querySelector('header.site-header') && root.querySelector('footer.site-footer'));
  assert.ok(root.querySelector('.lang-switcher'));
});

Then('wrangler.jsonc should serve the nearest 404 page for unknown URLs', function () {
  const text = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf-8');
  assert.match(text, /"not_found_handling":\s*"404-page"/);
});

Then('the generated deploy configuration should keep that setting', function () {
  const config = JSON.parse(readFileSync(join(DIST_DIR, 'wrangler.json'), 'utf-8'));
  assert.equal(config.assets.not_found_handling, '404-page', 'the adapter must not drop the setting when it generates the deploy config');
});

Then('the sitemap should not list any 404 page', function () {
  const sitemap = readdirSync(DIST_DIR).filter((f) => /^sitemap-\d+\.xml$/.test(f)).map((f) => readFileSync(join(DIST_DIR, f), 'utf-8')).join('');
  assert.ok(sitemap.includes('<loc>'), 'sitemap should list pages');
  assert.ok(!/404/.test(sitemap));
});

Then('no {string} directory should be built, so only the .html error pages exist', function (name) {
  for (const dir of ['', 'es']) assert.ok(!existsSync(join(DIST_DIR, dir, name)), `/${dir}/${name}/ would answer 200 for an error page`);
  for (const file of ['404.html', 'es/404.html']) assert.ok(existsSync(join(DIST_DIR, file)));
});

// --- Content-Security-Policy ---------------------------------------------------------------

function csp() {
  const headers = readFileSync(join(ROOT, 'public/_headers'), 'utf-8');
  const line = headers.split('\n').find((l) => l.trim().toLowerCase().startsWith('content-security-policy:'));
  assert.ok(line, 'public/_headers has no Content-Security-Policy');
  return Object.fromEntries(
    line.replace(/^\s*content-security-policy:\s*/i, '').split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [name, ...values] = d.split(/\s+/); return [name, values]; })
  );
}

Then('the deployment headers file should declare a Content-Security-Policy in addition to the baseline headers', function () {
  const headers = readFileSync(join(ROOT, 'public/_headers'), 'utf-8');
  for (const name of ['Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Content-Security-Policy']) {
    assert.ok(headers.includes(name), `missing ${name}`);
  }
});

Then('the Content-Security-Policy should allow scripts only from the site itself', function () {
  const policy = csp();
  assert.deepEqual(policy['script-src'], ["'self'"], "script-src must be exactly 'self' — no 'unsafe-inline', no 'unsafe-eval', no other hosts");
  assert.deepEqual(policy['default-src'], ["'self'"]);
});

Then('the Content-Security-Policy should forbid plugins, framing and foreign base URLs', function () {
  const policy = csp();
  assert.deepEqual(policy['object-src'], ["'none'"]);
  assert.deepEqual(policy['frame-ancestors'], ["'none'"]);
  assert.deepEqual(policy['base-uri'], ["'self'"]);
  assert.ok('upgrade-insecure-requests' in policy);
});

Then('the Content-Security-Policy should allow the photo host configured in the site', function () {
  assert.ok(csp()['img-src'].includes(new URL(photos.PHOTOS_BASE_URL).origin), 'img-src must list the R2 host from src/config/photos.ts');
});

Then("the Content-Security-Policy should allow the contact form's API in connect-src and form-action", function () {
  const policy = csp();
  assert.ok(policy['connect-src'].includes('https://api.web3forms.com'));
  assert.ok(policy['form-action'].includes('https://api.web3forms.com'));
});

Then('the Content-Security-Policy should allow the results API configured in the site in connect-src and img-src, and nothing broader', function () {
  const policy = csp();
  const origin = new URL(resultsConfig.RESULTS_API_URL).origin;
  assert.equal(origin, resultsConfig.RESULTS_API_URL, 'the configured address is a bare origin');
  for (const directive of ['connect-src', 'img-src']) assert.ok(policy[directive].includes(origin), `${directive} must list the results API`);
  // Only that exact origin: no wildcards, and not allowed to load scripts, frames or forms.
  for (const [directive, sources] of Object.entries(policy)) {
    assert.ok(!sources.some((source) => source.includes('*') || source === 'https:'), `${directive} must not use wildcards`);
    if (!['connect-src', 'img-src'].includes(directive)) assert.ok(!sources.includes(origin), `${directive} must not allow the results API`);
  }
});

Then('every external address the built pages and scripts load should be allowed by the policy', async function () {
  const policy = csp();
  const allowed = (directive) => new Set([...(policy[directive] ?? policy['default-src'])]);
  const problems = [];
  const origin = (url) => new URL(url).origin;

  for (const route of await listBuiltRoutes()) {
    const { root } = readBuiltPage(route);
    for (const img of root.querySelectorAll('img')) {
      const urls = [img.getAttribute('src'), ...(img.getAttribute('srcset') ?? '').split(',').map((s) => s.trim().split(/\s+/)[0])].filter((u) => /^https?:/.test(u ?? ''));
      for (const url of urls) if (!allowed('img-src').has(origin(url))) problems.push(`${route}: img ${origin(url)}`);
    }
    for (const form of root.querySelectorAll('form[action]')) {
      if (!allowed('form-action').has(origin(form.getAttribute('action')))) problems.push(`${route}: form-action ${form.getAttribute('action')}`);
    }
    for (const tag of root.querySelectorAll('script[src], link[rel="stylesheet"]')) {
      const url = tag.getAttribute('src') ?? tag.getAttribute('href');
      if (/^https?:/.test(url) && origin(url) !== new URL(site.url).origin) problems.push(`${route}: script/style from ${origin(url)}`);
    }
  }
  // Addresses the scripts fetch at runtime.
  const dir = join(DIST_DIR, '_astro');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    for (const url of readFileSync(join(dir, file), 'utf-8').match(/https:\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'`)]*/gi) ?? []) {
      if (!allowed('connect-src').has(origin(url)) && !url.includes('w3.org') && !url.includes('reactjs.org')) problems.push(`${file}: ${origin(url)}`);
    }
  }
  assert.deepEqual([...new Set(problems)], [], 'The policy would block these');
});

Then('no built page should contain an inline script, an inline event handler or a style attribute', async function () {
  const problems = [];
  for (const route of [...(await listBuiltRoutes()), '/404.html', '/es/404.html']) {
    const { html, root } = readBuiltPage(route);
    const inline = root.querySelectorAll('script').filter((s) => !s.getAttribute('src') && s.getAttribute('type') !== 'application/ld+json');
    if (inline.length) problems.push(`${route}: ${inline.length} inline script(s)`);
    if (/\s(on[a-z]+)="/i.test(html)) problems.push(`${route}: inline event handler`);
    if (/\sstyle="/i.test(html)) problems.push(`${route}: style attribute`);
    if (/href="javascript:/i.test(html)) problems.push(`${route}: javascript: URL`);
  }
  assert.deepEqual(problems, []);
});

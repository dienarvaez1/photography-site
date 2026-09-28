import { After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInfo } from '../../scripts/lib/build-info.mjs';
import { ROOT } from '../support/lib.js';

// Each scenario works in a throwaway folder of its own, never in this repository.
const state = (world) => (world.data.buildInfo ??= { env: {} });
const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false'];

async function commit(dir, n) {
  await writeFile(join(dir, 'file.txt'), `change ${n}\n`);
  git(dir, 'add', 'file.txt');
  git(dir, ...IDENTITY, 'commit', '-q', '-m', `change ${n}`);
}

const info = (world) => buildInfo({ cwd: state(world).dir, env: state(world).env, now: state(world).now });
const shortHash = (world) => git(state(world).dir, 'rev-parse', '--short', 'HEAD');

After(async function () {
  if (this.data?.buildInfo?.dir) await rm(this.data.buildInfo.dir, { recursive: true, force: true });
});

// --- Working out the version ------------------------------------------------------------------------------------

Given('a git repository with one commit', async function () {
  const dir = await mkdtemp(join(tmpdir(), 'build-info-'));
  state(this).dir = dir;
  git(dir, 'init', '-q');
  await commit(dir, 1);
});

Given('a folder that is not a git repository', async function () {
  const dir = await mkdtemp(join(tmpdir(), 'build-info-'));
  state(this).dir = dir;
  // The system's temp folder is never inside a checkout, so git finds no repository here at all.
  assert.throws(() => git(dir, 'rev-parse', '--git-dir'), 'the temp folder is not inside a git repository');
});

Given('its latest commit is tagged {string}', function (tag) {
  git(state(this).dir, ...IDENTITY, 'tag', tag);
});

Given('{int} more commits are made', async function (count) {
  for (let i = 0; i < count; i++) await commit(state(this).dir, 100 + i);
});

Given('one of its files is changed without committing', async function () {
  await writeFile(join(state(this).dir, 'file.txt'), 'not committed\n');
});

When('it is built with BUILD_VERSION {string} and BUILD_COMMIT {string}', function (version, commitHash) {
  Object.assign(state(this).env, { BUILD_VERSION: version, BUILD_COMMIT: commitHash });
});

When('it is built at {string}', function (time) {
  state(this).now = new Date(time);
});

Then('its build version should be {string}', function (version) {
  assert.equal(info(this).version, version);
});

Then('its build version should be the short hash of its latest commit', function () {
  assert.equal(info(this).version, shortHash(this));
});

Then('its build version should be the short hash of its latest commit, followed by {string}', function (suffix) {
  assert.equal(info(this).version, `${shortHash(this)}${suffix}`);
});

Then('its build version should be {string} followed by the short hash of its latest commit', function (prefix) {
  assert.equal(info(this).version, `${prefix}${shortHash(this)}`);
});

Then('its build commit should be the full hash of its latest commit', function () {
  assert.equal(info(this).commit, git(state(this).dir, 'rev-parse', 'HEAD'));
});

Then('its build commit should be {string}', function (commitHash) {
  assert.equal(info(this).commit, commitHash);
});

Then('its build commit should be none', function () {
  assert.equal(info(this).commit, null);
});

Then('its build should not be marked dirty', function () {
  assert.equal(info(this).dirty, false);
});

Then('its build should be marked dirty', function () {
  assert.equal(info(this).dirty, true);
});

Then('its build time should be {string}', function (time) {
  assert.equal(info(this).builtAt, time);
});

// --- Showing it (on the pages the test run built from this checkout) -----------------------------------------------

const buildLine = (world) => world.data.page.root.querySelector('.site-footer .build-info');
// What this checkout's build would be called now — the same code the site's own build ran moments ago.
const thisCheckout = () => buildInfo({ cwd: ROOT, env: {} });

Then('its footer should say {string} followed by this checkout\'s build version', function (word) {
  const line = buildLine(this);
  assert.ok(line, `${this.data.route}: no build line in the footer`);
  assert.ok(line.text.replace(/\s+/g, ' ').trim().startsWith(`${word}${thisCheckout().version},`), line.text);
  assert.equal(line.getAttribute('data-version'), thisCheckout().version);
});

Then('its footer should give this checkout\'s full commit hash', function () {
  assert.equal(buildLine(this).getAttribute('data-commit'), thisCheckout().commit);
});

Then('its footer should give when the site was built, as a machine-readable UTC time', function () {
  const time = buildLine(this).querySelector('time');
  const iso = time.getAttribute('datetime');
  assert.equal(new Date(iso).toISOString(), iso, 'an ISO 8601 UTC time');
  assert.ok(Date.now() - Date.parse(iso) < 6 * 60 * 60 * 1000, `built recently: ${iso}`);
  assert.equal(time.text.trim(), `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`);
});

Then('its footer should not mention the build', function () {
  assert.equal(buildLine(this), null, `${this.data.route} shows the build`);
});

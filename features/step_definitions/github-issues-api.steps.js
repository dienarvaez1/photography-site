import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../support/lib.js';
import { fakeGitHub, gitHubIssue } from '../support/github-fixtures.js';

const { handle } = await import(join(ROOT, 'workers/results-api/src/index.mjs'));

const API = 'https://api.test';
const state = (world) => world.data.issuesApi;

Given('a results API with the admin token {string} for the repository {string}, where GitHub has:', function (token, repo, table) {
  this.data.issuesApi = { token, env: { ADMIN_TOKEN: token, ALLOWED_ORIGINS: 'https://site.test', GITHUB_REPO: repo }, github: fakeGitHub(table.hashes(), { repo }) };
});

Given('the results API has the GitHub token {string}', function (githubToken) {
  state(this).env.GITHUB_TOKEN = githubToken;
});

Given('the results API has no admin token set for the issues', function () {
  delete state(this).env.ADMIN_TOKEN;
});

Given('the results API has no repository configured', function () {
  delete state(this).env.GITHUB_REPO;
});

Given('GitHub has {int} more open issues', function (count) {
  const { github, env } = state(this);
  for (let i = 0; i < count; i++) github.issues.push(gitHubIssue({ number: 100 + i, title: `Issue ${i}`, state: 'open', updated: '2026-09-01T10:00:00Z' }, env.GITHUB_REPO));
});

Given(/^GitHub is (answering|rate-limited|down|unreachable)$/, function (mode) {
  state(this).github.mode = mode === 'answering' ? 'ok' : mode;
});

When(/^I call the issues route "([^"]*)" with (the admin token|no token|the token "[^"]*")$/, async function (route, how) {
  const s = state(this);
  const given = /^the token "(.*)"$/.exec(how)?.[1];
  const headers = how === 'the admin token' ? { Authorization: `Bearer ${s.token}` } : how === 'no token' ? {} : { Authorization: `Bearer ${given}` };
  const response = await handle(new Request(`${API}${route}`, { headers }), s.env, Date.now(), s.github.fetcher);
  const text = await response.text();
  s.last = { status: response.status, text, body: JSON.parse(text) };
});

const body = (world) => state(world).last.body;
const issue = (world, number) => body(world).issues.find((i) => i.number === number);

Then('the issues response should be {int}, for the repository {string}, listing issues {string}', function (status, repo, numbers) {
  assert.equal(state(this).last.status, status, state(this).last.text);
  assert.equal(body(this).repo, repo);
  assert.deepEqual(body(this).issues.map((i) => i.number), numbers.split(', ').map(Number));
});

Then(/^the issues list should (not )?be complete$/, function (not) {
  assert.equal(body(this).complete, !not);
});

Then('issue {int} should be passed on as open, by {string}, with {int} comments, the labels {string} and a link to {string}', function (number, author, comments, labels, url) {
  const found = issue(this, number);
  assert.equal(found.state, 'open');
  assert.equal(found.author, author);
  assert.equal(found.comments, comments);
  assert.deepEqual(found.labels.map((l) => l.name), labels.split(', '));
  for (const label of found.labels) assert.match(label.color, /^[0-9a-f]{6}$/);
  assert.equal(found.url, url);
});

Then('issue {int} should be passed on as closed, not planned', function (number) {
  const found = issue(this, number);
  assert.equal(found.state, 'closed');
  assert.equal(found.stateReason, 'not_planned');
  assert.ok(found.closedAt);
});

Then('no issue should carry its body', function () {
  const allowed = ['number', 'title', 'state', 'stateReason', 'url', 'author', 'labels', 'comments', 'createdAt', 'updatedAt', 'closedAt'];
  for (const found of body(this).issues) assert.deepEqual(Object.keys(found).sort(), [...allowed].sort());
});

Then('GitHub should have been asked once for {string}', function (url) {
  const { calls } = state(this).github;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, url);
  assert.equal(calls[0].headers.Accept, 'application/vnd.github+json');
  assert.ok(calls[0].headers['User-Agent'], 'GitHub refuses requests without a User-Agent');
});

Then('GitHub should have been asked without a GitHub token', function () {
  assert.equal(state(this).github.calls[0].headers.Authorization, undefined);
});

Then('GitHub should have been asked with the GitHub token {string}', function (githubToken) {
  assert.equal(state(this).github.calls[0].headers.Authorization, `Bearer ${githubToken}`);
});

Then('GitHub should not have been asked', function () {
  assert.deepEqual(state(this).github.calls, []);
});

Then('the issues response should be {int} with the error {string}', function (status, error) {
  assert.equal(state(this).last.status, status, state(this).last.text);
  assert.equal(body(this).error, error);
});

Then("the results Worker's configuration should read the issues of {string}", function (repo) {
  const text = readFileSync(join(ROOT, 'workers/results-api/wrangler.jsonc'), 'utf-8');
  const config = JSON.parse(text.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n'));
  assert.equal(config.vars.GITHUB_REPO, repo);
});

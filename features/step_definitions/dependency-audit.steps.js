import { Given, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../support/lib.js';

const audit = await import(join(ROOT, 'scripts/audit.mjs'));
const report = (world) => (world.data.audit ??= { vulnerabilities: {} });

function add(world, id, severity, pkg, { dependent, fixable = false } = {}) {
  const r = report(world);
  r.vulnerabilities[pkg] = {
    name: pkg,
    severity,
    via: [{ source: 1, name: pkg, title: `a ${severity} problem in ${pkg}`, url: `https://github.com/advisories/${id}`, severity }],
    fixAvailable: fixable ? { name: pkg, version: '9.9.9', isSemVerMajor: false } : { name: 'astro', version: '2.10.9', isSemVerMajor: true },
  };
  if (dependent) r.vulnerabilities[dependent] = { name: dependent, severity, via: [pkg], fixAvailable: false };
}

Given('an audit report with the advisory {string} of {string} severity in {string}', function (id, severity, pkg) {
  add(this, id, severity, pkg);
});
Given('the advisory {string} of {string} severity in {string}', function (id, severity, pkg) {
  add(this, id, severity, pkg);
});
Given('an audit report with the advisory {string} of {string} severity in {string}, which {string} depends on', function (id, severity, pkg, dependent) {
  add(this, id, severity, pkg, { dependent });
});
Given('an audit report with the advisory {string} of {string} severity in {string}, fixable without a breaking change', function (id, severity, pkg) {
  add(this, id, severity, pkg, { fixable: true });
});

Then('the audit should find nothing blocking', function () {
  assert.deepEqual(audit.judge(report(this)).blocking, []);
});

Then('it should list {string} as accepted for now', function (id) {
  assert.deepEqual(audit.judge(report(this)).accepted.map((a) => a.id), [id]);
});

Then('the audit should block on {string} only', function (id) {
  assert.deepEqual(audit.judge(report(this)).blocking.map((a) => a.id), [id]);
});

Then('the audit should say a fix is now available for {string}', function (pkg) {
  assert.deepEqual(audit.fixableAccepted(report(this)).map((e) => e.package), [pkg]);
});

Then('every accepted advisory should give a reason and link an issue on the site\'s repository', function () {
  assert.ok(audit.ACCEPTED.length > 0);
  for (const entry of audit.ACCEPTED) {
    assert.match(entry.id, /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
    assert.ok(entry.reason.length > 40, `${entry.id} says why`);
    assert.match(entry.issue, /^https:\/\/github\.com\/dienarvaez1\/photography-site\/issues\/\d+$/);
  }
});

Then('the CI workflow\'s Dependency audit step should run {string}', function (command) {
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf-8');
  const step = ci.slice(ci.indexOf('- name: Dependency audit'));
  assert.match(step.split(/\n\s+- name:/)[0], new RegExp(`run: ${command.replace(/ /g, '\\s+')}\\s*$`, 'm'));
  assert.ok(!/run: npm audit\b/.test(ci), 'the bare npm audit is gone');
});

import { Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../support/lib.js';

const readme = () => readFileSync(join(ROOT, 'README.md'), 'utf-8');
const featureFiles = () => readdirSync(join(ROOT, 'features')).filter((f) => f.endsWith('.feature')).sort();

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five',
];

Then('every feature file should be described in the README', function () {
  const text = readme();
  const missing = featureFiles().filter((file) => !text.includes(`\`${file}\``));
  assert.deepEqual(missing, [], 'Add these to the "Testing" list in README.md');
});

Then('every browser feature file should be described in the README', function () {
  const text = readme();
  const files = readdirSync(join(ROOT, 'features/browser')).filter((f) => f.endsWith('.feature')).sort();
  assert.ok(files.length >= 7, 'expected the browser features');
  const missing = files.filter((file) => !text.includes(`\`${file}\``));
  assert.deepEqual(missing, [], 'Add these to the browser tests list in README.md');
});

Then('every npm script that is not an automatic hook should be documented in the README', function () {
  const scripts = Object.keys(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).scripts);
  // npm runs "pre<x>" / "post<x>" automatically when <x> exists; a script that merely starts with "pre" (preview) is not one.
  const isHook = (name) => ['pre', 'post'].some((prefix) => name.startsWith(prefix) && scripts.includes(name.slice(prefix.length)));
  const text = readme();
  const documented = (name) => text.includes(`npm run ${name}`) || text.includes(`npm ${name}`);
  const missing = scripts.filter((name) => !isHook(name) && !documented(name));
  assert.deepEqual(missing, [], 'Document these as `npm run <name>` in README.md');
});

Then('the number of test areas stated in the README should equal the number of feature files', function () {
  const stated = readme().match(/against (\w+) areas/)?.[1];
  assert.ok(stated, 'README should say "against <number> areas"');
  assert.equal(NUMBER_WORDS.indexOf(stated), featureFiles().length, `README says "${stated} areas" but there are ${featureFiles().length} feature files`);
});

Then('every {string} npm script should appear in the README', function (prefix) {
  const scripts = Object.keys(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).scripts).filter((name) => name.startsWith(prefix));
  assert.ok(scripts.length >= 5, 'Expected the photos:* scripts');
  const text = readme();
  const missing = scripts.filter((name) => !text.includes(name));
  assert.deepEqual(missing, [], 'Document these commands in the README');
});

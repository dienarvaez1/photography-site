import { Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../support/lib.js';

const readme = () => readFileSync(join(ROOT, 'README.md'), 'utf-8');
const featureFiles = () => readdirSync(join(ROOT, 'features')).filter((f) => f.endsWith('.feature')).sort();

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];

Then('every feature file should be described in the README', function () {
  const text = readme();
  const missing = featureFiles().filter((file) => !text.includes(`\`${file}\``));
  assert.deepEqual(missing, [], 'Add these to the "Testing" list in README.md');
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

#!/usr/bin/env node
// `npm run test:lighthouse:record`: measure the live site with the Lighthouse suite, then publish the run to R2
// (lighthouse-results/ in photography-site-test), where the Admin page's Lighthouse Test Results tab reads it.
//   npm run test:lighthouse:record                   measure, then publish
//   npm run test:lighthouse:record -- --no-publish   just write test-results/lighthouse/
// A run whose pages miss their budgets is still published (that is what the tab is for); the exit code says it failed.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as publish } from './lib/lighthouse-results-cli.mjs';
import { RESULTS_BUCKET, gitInfo } from './lib/results.mjs';
import { createBucketStorage } from './lib/r2-storage.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const resultsDir = process.env.TEST_RESULTS_DIR ?? join(root, 'test-results');
const dir = join(resultsDir, 'lighthouse');
const cucumber = join(root, 'node_modules/@cucumber/cucumber/bin/cucumber.js');

rmSync(dir, { recursive: true, force: true }); // a run's reports must be that run's alone
const { status } = spawnSync(process.execPath, [cucumber, '--profile', 'lighthouse'], { cwd: root, stdio: 'inherit', env: { ...process.env, TEST_RESULTS_DIR: resultsDir } });

let published = true;
if (!process.argv.includes('--no-publish')) {
  console.log(`\n=== publishing to ${RESULTS_BUCKET} ===`);
  published = (await publish(['publish'], { dir, storage: createBucketStorage(RESULTS_BUCKET), meta: gitInfo(root) })) === 0;
}
console.log(`\n${status === 0 ? '✓ every page within budget' : '✗ some pages over budget (see test-results/lighthouse/index.html)'}${!published ? ' — and the run could not be published' : ''}`);
process.exit(status === 0 && published ? 0 : 1);

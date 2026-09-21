#!/usr/bin/env node
// `npm run test:record`: run the suites with reporters, then publish the results to R2.
//   npm run test:record                     offline + browser, then publish
//   npm run test:record -- --suite offline
//   npm run test:record -- --no-publish     just write test-results/
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as results } from './lib/results-cli.mjs';
import { RESULTS_BUCKET, gitInfo } from './lib/results.mjs';
import { createBucketStorage } from './lib/r2-storage.mjs';
import { planRun } from './lib/test-runner.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = process.env.TEST_RESULTS_DIR ?? join(root, 'test-results');
const cucumber = join(root, 'node_modules/@cucumber/cucumber/bin/cucumber.js');

let plan;
try {
  plan = planRun(process.argv.slice(2), dir);
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exit(1);
}

rmSync(dir, { recursive: true, force: true }); // a run's results must be that run's alone
mkdirSync(dir, { recursive: true });

const outcomes = plan.suites.map(({ name, args }) => {
  console.log(`\n=== ${name} suite ===`);
  const { status } = spawnSync(process.execPath, [cucumber, ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, TEST_RESULTS_DIR: dir } });
  return { name, ok: status === 0 };
});

let published = true;
if (plan.publish) {
  console.log(`\n=== publishing to ${RESULTS_BUCKET} ===`);
  published = (await results(['publish'], { dir, storage: createBucketStorage(RESULTS_BUCKET), meta: gitInfo(root) })) === 0;
}

const failed = outcomes.filter((o) => !o.ok).map((o) => o.name);
console.log(`\n${failed.length ? `✗ failed: ${failed.join(', ')}` : '✓ all suites passed'}${plan.publish && !published ? ' — but the results could not be published' : ''}`);
process.exit(failed.length || !published ? 1 : 0);

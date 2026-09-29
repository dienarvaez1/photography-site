#!/usr/bin/env node
// Lighthouse results in R2: `npm run lighthouse-results:*`. The logic lives in lib/lighthouse-results-cli.mjs.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './lib/lighthouse-results-cli.mjs';
import { RESULTS_BUCKET, gitInfo } from './lib/results.mjs';
import { createBucketStorage } from './lib/r2-storage.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = join(process.env.TEST_RESULTS_DIR ?? join(root, 'test-results'), 'lighthouse');
process.exitCode = await run(process.argv.slice(2), { dir, storage: createBucketStorage(RESULTS_BUCKET), meta: gitInfo(root) });

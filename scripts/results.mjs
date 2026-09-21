#!/usr/bin/env node
// Test results in R2: `npm run results:*`. The logic lives in lib/results-cli.mjs.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './lib/results-cli.mjs';
import { RESULTS_BUCKET, gitInfo } from './lib/results.mjs';
import { createBucketStorage } from './lib/r2-storage.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = process.env.TEST_RESULTS_DIR ?? join(root, 'test-results');
process.exitCode = await run(process.argv.slice(2), { dir, storage: createBucketStorage(RESULTS_BUCKET), meta: gitInfo(root) });

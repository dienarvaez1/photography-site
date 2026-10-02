#!/usr/bin/env node
// `npm run results:label`: gives every run already stored in R2 (test results and Lighthouse results) a `source` (where it
// was started from) and a `target` (where it ran, or which site it tested), for runs published before they were recorded.
//   npm run results:label                 label them
//   npm run results:label -- --dry-run    only say what would change
import { createApiBucketStorage } from './lib/r2-storage.mjs';
import { LIGHTHOUSE_PREFIX } from './lib/lighthouse-results.mjs';
import { RESULTS_BUCKET, RESULTS_PREFIX, labelStoredRuns } from './lib/results.mjs';

const dryRun = process.argv.includes('--dry-run');
const storage = createApiBucketStorage(RESULTS_BUCKET);
let failed = false;
for (const prefix of [RESULTS_PREFIX, LIGHTHOUSE_PREFIX]) {
  try {
    const { labelled, already } = await labelStoredRuns({ storage, prefix, dryRun, log: (line) => console.log(`  ${line}`) });
    console.log(`${RESULTS_BUCKET}/${prefix}: ${labelled.length} run(s) ${dryRun ? 'to label' : 'labelled'}, ${already} already labelled`);
  } catch (error) {
    failed = true;
    console.error(`✗ ${RESULTS_BUCKET}/${prefix}: ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);

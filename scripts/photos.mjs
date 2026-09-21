#!/usr/bin/env node
// Photo workflow: photos and their entries live in R2; .photo-entries/ is a local mirror of the entries.
// Run `npm run photos -- help` for usage. The logic lives in lib/cli.mjs and lib/entry-sync.mjs.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './lib/cli.mjs';
import { PHOTO_ENTRIES_DIR } from './lib/entries-dir.mjs';
import { createR2Storage } from './lib/r2-storage.mjs';

const contentDir = join(fileURLToPath(new URL('..', import.meta.url)), PHOTO_ENTRIES_DIR);
process.exitCode = await run(process.argv.slice(2), { contentDir, storage: createR2Storage(), sync: true });

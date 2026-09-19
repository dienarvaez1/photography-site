#!/usr/bin/env node
// Photo workflow: keeps each src/content/photos/<category>/*.md in sync with its photo in R2.
// Run `npm run photos -- help` for usage. The logic lives in lib/cli.mjs.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './lib/cli.mjs';
import { createR2Storage } from './lib/r2-storage.mjs';

const contentDir = join(fileURLToPath(new URL('..', import.meta.url)), 'src/content/photos');
process.exitCode = await run(process.argv.slice(2), { contentDir, storage: createR2Storage() });

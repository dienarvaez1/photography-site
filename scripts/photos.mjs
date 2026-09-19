#!/usr/bin/env node
// Photo workflow: keeps each src/content/photos/**/*.md in sync with its photo in R2.
// Run `npm run photos -- help` for usage.
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { addPhoto, listEntries, removePhoto, replacePhoto, syncPhotos, verifyPhotos } from './lib/photos.mjs';
import { createR2Storage } from './lib/r2-storage.mjs';

const contentDir = join(fileURLToPath(new URL('..', import.meta.url)), 'src/content/photos');
const log = (line) => console.log(line);

const HELP = `Photo workflow — photos live in Cloudflare R2, their .md files in git.

  npm run photos:add -- <file.jpg> --category <slug> --title "<title>" [options]
      Uploads the photo (original to the private bucket, web sizes to the public
      one), checks it arrived, writes src/content/photos/<category>/<slug>.md, and
      deletes the local file. Options:
        --title-es "<título>"   Spanish title        --slug <slug>   file name (default: from title)
        --camera "<text>"       --copyright "<text>" --order <n>     --featured
        --keep-source           keep the local file after a verified upload

  npm run photos:replace -- <entry.md | slug> <file.jpg> [--keep-source]
      Swaps an entry's photo; the old photo is deleted from R2 once unused.

  npm run photos:remove -- <entry.md | slug>
      Deletes the entry and its photo from R2.

  npm run photos:verify [-- --deep]
      Read-only check that every entry's photo is in R2 (exit 1 if not).
      --deep also downloads each original and checks it against its id.

  npm run photos:sync
      Repairs missing web sizes from the original stored in R2.`;

async function findEntry(ref) {
  const entries = await listEntries(contentDir);
  const wanted = ref.endsWith('.md') ? resolve(ref) : null;
  const found = entries.filter((e) => (wanted ? e.file === wanted : basename(e.file, '.md') === ref));
  if (found.length !== 1) {
    throw new Error(found.length ? `"${ref}" matches ${found.length} entries — pass the .md path` : `No photo entry matches "${ref}"`);
  }
  return found[0].file;
}

function report(problems) {
  for (const { file, message } of problems) console.error(`✗ ${file.replace(`${contentDir}/`, '')}: ${message}`);
}

const [command, ...rest] = process.argv.slice(2);
try {
  switch (command) {
    case 'add': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          category: { type: 'string' }, title: { type: 'string' }, 'title-es': { type: 'string' },
          slug: { type: 'string' }, camera: { type: 'string' }, copyright: { type: 'string' },
          order: { type: 'string' }, featured: { type: 'boolean' }, 'keep-source': { type: 'boolean' },
        },
      });
      if (positionals.length !== 1) throw new Error('Pass exactly one photo file. See: npm run photos -- help');
      const { file, photo } = await addPhoto({
        source: resolve(positionals[0]), category: values.category, title: values.title, slug: values.slug,
        titleEs: values['title-es'], camera: values.camera, copyright: values.copyright,
        order: values.order ? Number(values.order) : 0, featured: Boolean(values.featured),
        keepSource: Boolean(values['keep-source']), contentDir, storage: createR2Storage(), log,
      });
      log(`✓ ${file.replace(`${contentDir}/`, '')} (${photo.id}). Commit the .md.`);
      break;
    }
    case 'replace': {
      const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { 'keep-source': { type: 'boolean' } } });
      if (positionals.length !== 2) throw new Error('Usage: photos:replace <entry.md | slug> <file.jpg>');
      const { photo } = await replacePhoto({
        entryFile: await findEntry(positionals[0]), source: resolve(positionals[1]),
        keepSource: Boolean(values['keep-source']), contentDir, storage: createR2Storage(), log,
      });
      log(`✓ now ${photo.id}. Commit the .md.`);
      break;
    }
    case 'remove': {
      if (rest.length !== 1) throw new Error('Usage: photos:remove <entry.md | slug>');
      await removePhoto({ entryFile: await findEntry(rest[0]), contentDir, storage: createR2Storage(), log });
      log('✓ removed. Commit the deletion.');
      break;
    }
    case 'verify': {
      const { values } = parseArgs({ args: rest, options: { deep: { type: 'boolean' } } });
      const { problems, checked } = await verifyPhotos({ contentDir, storage: createR2Storage(), deep: Boolean(values.deep) });
      if (problems.length) { report(problems); process.exitCode = 1; }
      else log(`✓ ${checked} entries in sync with R2${values.deep ? ' (originals verified)' : ''}`);
      break;
    }
    case 'sync': {
      const { repaired, problems } = await syncPhotos({ contentDir, storage: createR2Storage(), log });
      report(problems);
      log(`✓ repaired ${repaired.length} entr${repaired.length === 1 ? 'y' : 'ies'}`);
      if (problems.length) process.exitCode = 1;
      break;
    }
    default:
      console.log(HELP);
      if (command && command !== 'help') process.exitCode = 1;
  }
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exitCode = 1;
}

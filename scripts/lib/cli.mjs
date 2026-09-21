// Command-line interface of the photo workflow, as a function so tests can drive
// it with a fake R2 and a temporary content folder. scripts/photos.mjs wires in
// the real R2 storage and the real src/content/photos folder.
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pullEntries, pushEntries } from './entry-sync.mjs';
import { addPhoto, fillCameraLines, listEntries, removePhoto, replacePhoto, slugify, syncPhotos, verifyPhotos } from './photos.mjs';

export const HELP = `Photo workflow — photos AND their entries live in Cloudflare R2 (the web bucket: photos/<category>/<id>.md
and photos/index.json, which the site reads when a page is requested). Nothing is committed to git and nothing is
deployed: a photo is on the site as soon as its entry is published, which every command below does for you.
The folder .photo-entries/ is only a local mirror of those entries, kept in step automatically.

  npm run photos:add -- <file.jpg> --category <slug> --title "<title>" [options]
      Uploads the photo (original to the private bucket, web sizes to the public
      one), checks it arrived, and publishes its entry
        photos/<category>/<photo id>.md   (and the manifest the site reads)
      then deletes the local file.
      <category> must be one of the slugs in src/config/categories.ts. Options:
        --title-es "<título>"   Spanish title
        --camera "<text>"       overrides the camera line built from the photo's EXIF
        --order <n>   --featured
        --keep-source           keep the local file after a verified upload
      The camera line ("Nikon Z 7 · 140mm · f/5.6 · 1/125s · ISO 110") is read from
      the photo's EXIF. Nothing else is kept: no copyright, dates, GPS or serial numbers.

  npm run photos:replace -- <entry> <file.jpg> [--camera "<text>"] [--keep-source]
      Swaps an entry's photo: the file is renamed to the new photo id and the old
      photo is deleted from R2 once unused. The camera line comes from --camera, else
      the new photo's EXIF, else the entry's existing line (it is never lost).

  npm run photos:camera [-- <entry>]
      Fills in a missing camera line from the original's EXIF in R2 (all entries, or
      one). Entries that already have a camera line are never touched.

  npm run photos:remove -- <entry>
      Removes the entry from the site, then deletes its photo from R2.

  npm run photos:verify [-- --deep]
      Read-only check that every entry's photo is in R2 (exit 1 if not).
      --deep also downloads each original and checks it against its id.

  npm run photos:sync
      Repairs missing web sizes from the original stored in R2.

  npm run photos:pull [-- --force]
      Makes the local mirror match R2. Refuses if the mirror has unpublished changes (--force discards them).
      Every command already does this first; you only need it to look at the entries.

  npm run photos:push
      Publishes the mirror to R2 (new .md files, then the manifest, then removals). Every command that changes
      entries already does this; you only need it after a failed publish or after editing a .md by hand.

  <entry> is the photo id (the file name), the title, or the path to the .md file.`;

/**
 * Runs one command. Returns the exit code (0 ok, 1 failure); prints through
 * `log` / `error`, and never throws.
 */
export async function run(args, { contentDir, storage, sync = false, log = console.log, error = console.error }) {
  const [command, ...rest] = args;
  let exitCode = 0;

  // With `sync`, the entries live in R2 and `contentDir` is their mirror: bring it up to date before a command reads
  // it, and publish it after a command changes it (see entry-sync.mjs). Without, `contentDir` is all there is.
  const READS_ENTRIES = ['add', 'replace', 'camera', 'remove', 'verify', 'sync'];
  const publish = sync ? async () => {
    const { published, removed } = await pushEntries({ contentDir, storage, log });
    if (published || removed) log(`  published: ${published} entr${published === 1 ? 'y' : 'ies'}${removed ? `, ${removed} removed` : ''}`);
  } : undefined;

  /** An entry by path, photo id (its file name), or title (case and punctuation-insensitive). */
  async function findEntry(ref) {
    const entries = await listEntries(contentDir);
    const wanted = ref.endsWith('.md') ? resolve(ref) : null;
    const found = entries.filter((e) =>
      wanted
        ? e.file === wanted
        : basename(e.file, '.md') === ref || slugify(String(e.data.title ?? '')) === slugify(ref)
    );
    if (found.length !== 1) {
      throw new Error(found.length ? `"${ref}" matches ${found.length} entries — pass the .md path` : `No photo entry matches "${ref}"`);
    }
    return found[0].file;
  }

  const relative = (file) => file.replace(`${contentDir}/`, '');
  const report = (problems) => {
    for (const { file, message } of problems) error(`✗ ${relative(file)}: ${message}`);
  };

  try {
    if (sync && READS_ENTRIES.includes(command)) await pullEntries({ contentDir, storage, log });
    switch (command) {
      case 'pull': {
        const { values } = parseArgs({ args: rest, options: { force: { type: 'boolean' } } });
        const { entries, changed } = await pullEntries({ contentDir, storage, force: Boolean(values.force), log });
        log(`✓ ${entries} entries in R2; local mirror ${changed ? `updated (${changed} file(s))` : 'already matched'}`);
        break;
      }
      case 'push': {
        const { published, removed } = await pushEntries({ contentDir, storage, log });
        log(`✓ ${published} entr${published === 1 ? 'y' : 'ies'} published, ${removed} removed`);
        break;
      }
      case 'add': {
        const { values, positionals } = parseArgs({
          args: rest,
          allowPositionals: true,
          options: {
            category: { type: 'string' }, title: { type: 'string' }, 'title-es': { type: 'string' },
            camera: { type: 'string' }, order: { type: 'string' }, featured: { type: 'boolean' },
            'keep-source': { type: 'boolean' },
          },
        });
        if (positionals.length !== 1) throw new Error('Pass exactly one photo file. See: npm run photos -- help');
        const { file, photo } = await addPhoto({
          source: resolve(positionals[0]), category: values.category, title: values.title,
          titleEs: values['title-es'], camera: values.camera,
          order: values.order ? Number(values.order) : 0, featured: Boolean(values.featured),
          keepSource: Boolean(values['keep-source']), contentDir, storage, publish, log,
        });
        log(sync ? `✓ ${photo.id} is on the site: photos/${values.category}/${photo.id}.md` : `✓ ${relative(file)} (${photo.id}).`);
        break;
      }
      case 'replace': {
        const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { 'keep-source': { type: 'boolean' }, camera: { type: 'string' } } });
        if (positionals.length !== 2) throw new Error('Usage: photos:replace <entry> <file.jpg>');
        const { photo } = await replacePhoto({
          entryFile: await findEntry(positionals[0]), source: resolve(positionals[1]), camera: values.camera,
          keepSource: Boolean(values['keep-source']), contentDir, storage, publish, log,
        });
        log(`✓ now ${photo.id}.`);
        break;
      }
      case 'camera': {
        if (rest.length > 1) throw new Error('Usage: photos:camera [entry]');
        const { updated, unchanged, problems } = await fillCameraLines({
          contentDir, storage, publish, log, entryFiles: rest.length ? [await findEntry(rest[0])] : undefined,
        });
        report(problems);
        log(`✓ camera lines: ${updated.length} added, ${unchanged.length} unchanged`);
        if (problems.length) exitCode = 1;
        break;
      }
      case 'remove': {
        if (rest.length !== 1) throw new Error('Usage: photos:remove <entry>');
        await removePhoto({ entryFile: await findEntry(rest[0]), contentDir, storage, publish, log });
        log('✓ removed.');
        break;
      }
      case 'verify': {
        const { values } = parseArgs({ args: rest, options: { deep: { type: 'boolean' } } });
        const { problems, checked } = await verifyPhotos({ contentDir, storage, deep: Boolean(values.deep), checkEntries: sync });
        if (problems.length) { report(problems); exitCode = 1; }
        else log(`✓ ${checked} entries in sync with R2${values.deep ? ' (originals verified)' : ''}`);
        break;
      }
      case 'sync': {
        const { repaired, problems } = await syncPhotos({ contentDir, storage, log });
        report(problems);
        log(`✓ repaired ${repaired.length} entr${repaired.length === 1 ? 'y' : 'ies'}`);
        if (problems.length) exitCode = 1;
        break;
      }
      default:
        log(HELP);
        if (command && command !== 'help') exitCode = 1;
    }
  } catch (err) {
    error(`✗ ${err.message}`);
    exitCode = 1;
  }
  return exitCode;
}

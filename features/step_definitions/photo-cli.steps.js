import { When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cli, entryFile, lib, makeJpeg, readEntry, sourcePath, state } from '../support/photo-helpers.js';
import { ROOT } from '../support/lib.js';

const { CATEGORIES } = await import(join(ROOT, 'src/config/categories.ts'));

/** Splits a command line the way a shell would: spaces separate words, quotes group them. */
function splitCommand(line) {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\{[^}]*\})|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]);
}

/**
 * Turns test placeholders into real values: photo file names (sunset.jpg) point into this
 * scenario's files folder, {id of nature/rockfish} is that entry's photo id, and
 * {path of nature/rockfish} is its .md file.
 */
async function resolveArgs(world, args) {
  const resolved = [];
  for (const arg of args) {
    const placeholder = arg.match(/^\{(id|path) of ([^}]+)\}$/);
    if (placeholder) {
      const [, kind, ref] = placeholder;
      resolved.push(kind === 'id' ? (await readEntry(world, ref)).photo.id : await entryFile(world, ref));
    } else if (/^[\w.-]+\.jpe?g$/i.test(arg)) {
      resolved.push(sourcePath(world, arg));
    } else {
      resolved.push(arg);
    }
  }
  return resolved;
}

When(/^I run the command: (.+)$/, async function (line) {
  const out = [];
  const err = [];
  const code = await cli.run(await resolveArgs(this, splitCommand(line)), {
    contentDir: state(this).contentDir,
    storage: state(this).storage,
    log: (text) => out.push(text),
    error: (text) => err.push(text),
  });
  state(this).cli = { code, out: out.join('\n'), err: err.join('\n') };
});

Then('the command should succeed', function () {
  const { code, err } = state(this).cli;
  assert.equal(code, 0, `Expected exit code 0, got ${code}. Errors: ${err}`);
});

Then('the command should fail with exit code {int}', function (expected) {
  assert.equal(state(this).cli.code, expected);
});

Then('the output should mention {string}', function (fragment) {
  assert.ok(state(this).cli.out.includes(fragment), `Output does not mention "${fragment}":\n${state(this).cli.out}`);
});

Then('the output should not mention {string}', function (fragment) {
  assert.ok(!state(this).cli.out.includes(fragment), `Output should not mention "${fragment}"`);
});

Then('the error output should mention {string}', function (fragment) {
  assert.ok(state(this).cli.err.includes(fragment), `Error output does not mention "${fragment}":\n${state(this).cli.err}`);
});

Then('the entry path for category {string} and photo id {string} should be {string}', function (category, id, expected) {
  assert.equal(lib.entryPath('/content', category, id), `/content/${expected}`);
});

Then('nothing should have been uploaded', function () {
  const { originals, web } = state(this).storage.objects;
  assert.equal(originals.size + web.size, 0);
});

Then('the library should contain no entries and no category folders', async function () {
  assert.deepEqual(await readdir(state(this).contentDir), [], 'A refused command must not create entries or folders');
});

Then('the entry {string} should be featured', async function (ref) {
  assert.equal((await readEntry(this, ref)).featured, true);
});

Then("adding a photo to every configured category should create one id-named entry in each category's images folder", async function () {
  assert.ok(CATEGORIES.length >= 7, 'Expected the configured categories');
  for (const [index, { slug }] of CATEGORIES.entries()) {
    const name = `photo-${index}.jpg`;
    await makeJpeg(this, name, 900 + index, 600);
    const code = await cli.run(['add', sourcePath(this, name), '--category', slug, '--title', `Photo ${index}`], {
      contentDir: state(this).contentDir, storage: state(this).storage, log: () => {}, error: (t) => assert.fail(t),
    });
    assert.equal(code, 0, `adding to "${slug}" failed`);
    const category = await readdir(join(state(this).contentDir, slug), { withFileTypes: true });
    assert.deepEqual(category.map((e) => `${e.name}${e.isDirectory() ? '/' : ''}`), ['images/'], `${slug}: only an images folder expected`);
    const { photo } = await readEntry(this, `${slug}/photo-${index}`);
    assert.ok(existsSync(join(state(this).contentDir, slug, 'images', `${photo.id}.md`)), `${slug}: entry must be images/<photo id>.md`);
  }
});

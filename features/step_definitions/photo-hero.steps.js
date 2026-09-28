// Server-side tests for the Home Background bulk action (scripts/lib/photos.mjs's setHeroBackground, through
// scripts/lib/photo-form.mjs's /hero-background endpoint): its real request handler, over a fake R2, the
// way the dev server does. The tab's own screens are in browser/photo-hero.feature.
import { When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readEntry, state } from '../support/photo-helpers.js';
import { SITE, answer, send } from './photo-form.steps.js';

/** The photo behind "<category>/<title slug>": its id and the category it is currently filed under. */
async function photoOf(world, ref) {
  const data = await readEntry(world, ref);
  return { ref, id: data.photo.id, category: data.category };
}

const heroUrl = `${SITE}/__photos/hero-background`;
const postJson = (world, body) => send(world, 'POST', heroUrl, { body, origin: SITE, headers: { 'Content-Type': 'application/json' } });

// --- Asking for a hero-background change ------------------------------------------------------------------------------------------

When('I ask the service to set the home background for the photos: {string} to {word}', async function (list, value) {
  const photos = await Promise.all(list.split(', ').map((ref) => photoOf(this, ref)));
  state(this).hero = { photos: { ...state(this).hero?.photos, ...Object.fromEntries(photos.map((p) => [p.ref, p])) } };
  await postJson(this, JSON.stringify({ photos: photos.map(({ id, category }) => ({ id, category })), value: value === 'true' }));
});

When('I ask the service to set the home background for the photos: {string} to {word}, claiming it is filed under {string}', async function (ref, value, claimedCategory) {
  const { id } = await photoOf(this, ref);
  await postJson(this, JSON.stringify({ photos: [{ id, category: claimedCategory }], value: value === 'true' }));
});

When('I send this hero-background request to the service:', async function (text) {
  let body = text;
  for (const [, ref] of text.matchAll(/<id of ([^>]+)>/g)) body = body.replaceAll(`<id of ${ref}>`, (await photoOf(this, ref)).id);
  await postJson(this, body);
});

When('I send a hero-background request naming {int} photos', async function (count) {
  const photos = Array.from({ length: count }, (_, i) => ({ id: i.toString(16).padStart(16, '0'), category: 'astro' }));
  await postJson(this, JSON.stringify({ photos, value: true }));
});

// --- What the service answered ---------------------------------------------------------------------------------------------------

const resultFor = (world, ref) => {
  const { id } = state(world).hero.photos[ref];
  const result = answer(world).body.results.find((r) => r.id === id);
  assert.ok(result, `the answer has a result for ${ref}`);
  return result;
};

Then('the service should report {string} changed', function (ref) {
  assert.equal(resultFor(this, ref).changed, true, JSON.stringify(resultFor(this, ref)));
});

Then('the service should report {string} not changed', function (ref) {
  assert.equal(resultFor(this, ref).changed, false, JSON.stringify(resultFor(this, ref)));
});

// --- What R2 holds afterwards ----------------------------------------------------------------------------------------------------

Then('the entry {string} should be marked as the home background', async function (ref) {
  const data = await readEntry(this, ref);
  assert.equal(data.heroBackground, true, JSON.stringify(data));
});

Then('the entry {string} should not be marked as the home background', async function (ref) {
  const data = await readEntry(this, ref);
  assert.ok(!data.heroBackground, JSON.stringify(data));
});

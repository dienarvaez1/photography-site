import { When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { config, readEntry, state } from '../support/photo-helpers.js';
import { SITE, answer, send } from './photo-form.steps.js';

const web = (world) => state(world).storage.objects.web;

/** The photo behind "<category>/<title slug>": its id and the category it is currently filed under. */
async function photoOf(world, ref) {
  const data = await readEntry(world, ref);
  return { ref, id: data.photo.id, category: data.category };
}

const recategorizeUrl = `${SITE}/__photos/recategorize`;
const postJson = (world, body) => send(world, 'POST', recategorizeUrl, { body, origin: SITE, headers: { 'Content-Type': 'application/json' } });

// --- Asking for a category change ------------------------------------------------------------------------------------------------

When('I ask the service to move the photos: {string} to {string}', async function (list, toCategory) {
  const photos = await Promise.all(list.split(', ').map((ref) => photoOf(this, ref)));
  state(this).recategorize = { photos: { ...state(this).recategorize?.photos, ...Object.fromEntries(photos.map((p) => [p.ref, p])) }, toCategory };
  await postJson(this, JSON.stringify({ photos: photos.map(({ id, category }) => ({ id, category })), toCategory }));
});

When('I ask the service to move the photos: {string} to {string}, claiming it is filed under {string}', async function (ref, toCategory, claimedCategory) {
  const { id } = await photoOf(this, ref);
  await postJson(this, JSON.stringify({ photos: [{ id, category: claimedCategory }], toCategory }));
});

When('I send this category-change request to the service:', async function (text) {
  let body = text;
  for (const [, ref] of text.matchAll(/<id of ([^>]+)>/g)) body = body.replaceAll(`<id of ${ref}>`, (await photoOf(this, ref)).id);
  await postJson(this, body);
});

When('I send a category-change request naming {int} photos', async function (count) {
  const photos = Array.from({ length: count }, (_, i) => ({ id: i.toString(16).padStart(16, '0'), category: 'astro' }));
  await postJson(this, JSON.stringify({ photos, toCategory: 'other' }));
});

// --- What the service answered ---------------------------------------------------------------------------------------------------

const resultFor = (world, ref) => {
  const { id } = state(world).recategorize.photos[ref];
  const result = answer(world).body.results.find((r) => r.id === id);
  assert.ok(result, `the answer has a result for ${ref}`);
  return result;
};

Then('the service should report {string} moved to {string}', function (ref, toCategory) {
  const result = resultFor(this, ref);
  assert.equal(result.moved, true, JSON.stringify(result));
  assert.equal(result.to, toCategory);
});

Then('the service should report {string} not moved', function (ref) {
  assert.equal(resultFor(this, ref).moved, false, JSON.stringify(resultFor(this, ref)));
});

// --- What R2 holds afterwards ----------------------------------------------------------------------------------------------------

Then('the entry {string} should exist, with the title {string} and order {int}', async function (ref, title, order) {
  const data = await readEntry(this, ref);
  assert.equal(data.title, title);
  assert.equal(data.order, order);
});

Then('the photo of {string} should be untouched in R2', async function (ref) {
  const { photo } = await readEntry(this, ref);
  for (const key of config.photoKeys(photo.id).web) assert.ok(web(this).has(key), key);
});

import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../support/lib.js';
import { daysFromRows, fakeAccessBucket } from '../support/access-fixtures.js';

const log = await import(join(ROOT, 'src/config/access-log.ts'));
const view = await import(join(ROOT, 'src/lib/access-view.ts'));
const { handle } = await import(join(ROOT, 'workers/results-api/src/index.mjs'));

const API = 'https://api.test';
const state = (world) => (world.data.access ??= {});

const entryOf = (row) => ({ time: row.time, ip: row.ip, page: row.page, event: row.event, ...(row.photo ? { photo: { id: row.photo, category: row.category } } : {}) });

// --- What a page may report ----------------------------------------------------------------------------------------------

Then(/^the report (.+) should be (accepted|refused)$/, function (json, verdict) {
  const parsed = log.parseBeacon(JSON.parse(json));
  if (verdict === 'accepted') assert.deepEqual(parsed, JSON.parse(json));
  else assert.equal(parsed, null);
});

Then('a report of a {int}-character path should be refused', function (length) {
  assert.equal(log.parseBeacon({ page: `/${'a'.repeat(length - 1)}`, event: 'view' }), null);
  assert.notEqual(log.parseBeacon({ page: `/${'a'.repeat(length - 2)}`, event: 'view' }), null, 'one character less is accepted');
});

// --- One file per UTC day ------------------------------------------------------------------------------------------------

Then('an entry at {string} should go in {string}', function (time, key) {
  assert.equal(log.dayKey(log.dayOf(time)), key);
});

Given('an empty access log', function () {
  state(this).bucket = fakeAccessBucket();
});

Given('the next {int} writes lose the race to another visit', function (count) {
  state(this).bucket.interfere(count);
});

Given("the access log's file of {string} already holds the most entries a day may hold", function (day) {
  const entries = Array.from({ length: log.MAX_ENTRIES_PER_DAY }, (_, i) => ({ time: day, ip: '192.0.2.1', page: `/${i}/`, event: 'view' }));
  state(this).bucket = fakeAccessBucket([{ day, entries }]);
});

Given("the access log's file of {string} holds {string}", function (day, text) {
  state(this).bucket = fakeAccessBucket();
  state(this).bucket.raw(`logs/${day}.json`, text);
});

When('these are recorded:', async function (table) {
  const s = state(this);
  s.results = [];
  for (const row of table.hashes()) s.results.push(await log.recordAccess(s.bucket, entryOf(row)));
});

When('a visit at {string} from {string} to {string} is recorded', async function (time, ip, page) {
  const s = state(this);
  s.results = [await log.recordAccess(s.bucket, { time, ip, page, event: 'view' })];
});

Then(/^(?:each|it) should have been "(recorded|full|busy)"$/, function (result) {
  assert.deepEqual(state(this).results, state(this).results.map(() => result));
});

Then('the access log should hold the files {string}', function (keys) {
  assert.deepEqual(state(this).bucket.keys(), keys.split(', '));
});

Then('the file of {string} should hold, in order:', function (day, table) {
  assert.deepEqual(state(this).bucket.log(day), { day, entries: table.hashes().map(entryOf) });
});

Then('the file of {string} should hold {int} entries, the last a visit from {string} to {string}', function (day, count, ip, page) {
  const file = state(this).bucket.log(day);
  assert.equal(file.day, day);
  assert.equal(file.entries.length, count);
  assert.deepEqual({ ip: file.entries.at(-1).ip, page: file.entries.at(-1).page, event: file.entries.at(-1).event }, { ip, page, event: 'view' });
});

Then('the file of {string} should still hold the most entries a day may hold', function (day) {
  assert.equal(state(this).bucket.log(day).entries.length, log.MAX_ENTRIES_PER_DAY);
});

// --- The results API ----------------------------------------------------------------------------------------------------

Given('a results API with the admin token {string} over an access log holding:', function (token, table) {
  Object.assign(state(this), { token, env: { ADMIN_TOKEN: token, ALLOWED_ORIGINS: 'https://site.test', ACCESS: fakeAccessBucket(daysFromRows(table.hashes())) } });
});

Given('a results API with the admin token {string} and no access log bucket', function (token) {
  Object.assign(state(this), { token, env: { ADMIN_TOKEN: token, ALLOWED_ORIGINS: 'https://site.test' } });
});

When(/^I call the access route "([^"]*)" with (the admin token|no token|the token "[^"]*")$/, async function (route, how) {
  const s = state(this);
  const given = /^the token "(.*)"$/.exec(how)?.[1];
  const headers = how === 'the admin token' ? { Authorization: `Bearer ${s.token}` } : how === 'no token' ? {} : { Authorization: `Bearer ${given}` };
  const response = await handle(new Request(`${API}${route}`, { headers }), s.env);
  s.last = { status: response.status, body: await response.json() };
});

Then('the access response should be {int}, listing the days {string}', function (status, days) {
  const { last } = state(this);
  assert.equal(last.status, status);
  assert.deepEqual(last.body.days.map((d) => d.day), days.split(', '));
  assert.equal(last.body.complete, true);
  for (const d of last.body.days) assert.ok(d.size > 0 && typeof d.updatedAt === 'string', JSON.stringify(d));
});

Then('the access response should be {int}, for the day {string} with {int} entries, the second a {string} of {string}', function (status, day, count, event, id) {
  const { last } = state(this);
  assert.equal(last.status, status);
  assert.equal(last.body.day, day);
  assert.equal(last.body.entries.length, count);
  assert.equal(last.body.entries[1].event, event);
  assert.equal(last.body.entries[1].photo.id, id);
});

Then('the access response should be {int} with the error {string}', function (status, error) {
  const { last } = state(this);
  assert.equal(last.status, status);
  assert.equal(last.body.error, error);
});

// --- What the tab shows -------------------------------------------------------------------------------------------------

Given('a day with these entries:', function (table) {
  state(this).entries = table.hashes().map(entryOf);
});

Then('the day should add up to {int} visits, {int} photos opened and {int} different addresses', function (views, photos, visitors) {
  const s = view.summarize(state(this).entries);
  assert.deepEqual({ views: s.views, photos: s.photos, visitors: s.visitors }, { views, photos, visitors });
});

const ranked = (list) => list.map(({ key, count }) => `${key} ${count}`).join(', ');

Then('its most visited pages should be {string}', function (expected) {
  assert.equal(ranked(view.summarize(state(this).entries).pages), expected);
});

Then('its most opened photos should be {string}', function (expected) {
  assert.equal(ranked(view.summarize(state(this).entries).topPhotos), expected);
});

Then('a pie of {string} should have the slices {string}', function (ranking, expected) {
  const counts = ranking.split(', ').map((pair) => ({ key: pair.split(' ')[0], count: Number(pair.split(' ')[1]) }));
  const slices = view.pieSlices(counts);
  const shown = slices.map((slice) => `${'other' in slice ? `Other(${slice.groups})` : slice.key} ${slice.count} ${Math.round(slice.share * 100)}%`);
  assert.equal(shown.join(', '), expected);
  assert.ok(slices.length <= view.PIE_NAMED + 1, 'never more than five slices');
  if (slices.length) assert.ok(Math.abs(slices.reduce((sum, slice) => sum + slice.share, 0) - 1) < 1e-9, 'the slices make the whole');
});

// --- Where the visitor is (geo) ------------------------------------------------------------------------------------------

const geoBackfill = await import(join(ROOT, 'scripts/lib/access-geo.mjs'));
const parseOrNothing = (text) => (text === 'nothing' ? undefined : JSON.parse(text));

Then(/^Cloudflare's place (.+) should be recorded as (.+)$/, function (cf, geo) {
  assert.deepEqual(log.geoFrom(JSON.parse(cf)), parseOrNothing(geo));
});

Then(/^ipinfo\.io's answer (\{.+\}) should give (.+)$/, async function (answer, geo) {
  const asked = [];
  const fetcher = async (url) => {
    asked.push(url);
    return new Response(answer, { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const ip = JSON.parse(answer).ip;
  assert.deepEqual(await geoBackfill.lookUp(ip, fetcher), parseOrNothing(geo));
  assert.deepEqual(asked, [`https://ipinfo.io/${ip}/json`]);
});

Then('every country should have a continent for the backfill', function () {
  const regions = new Intl.DisplayNames(['en'], { type: 'region' });
  const missing = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      let name;
      try {
        name = regions.of(code);
      } catch {
        continue;
      }
      // A code with an English name of its own is a country or territory, except groupings and reserved codes, and
      // withdrawn ones the name list still knows (SU, YU, ZR, …; UK for GB), which no lookup service answers with.
      const notPlaces = ['EU', 'EZ', 'UN', 'ZZ', 'XA', 'XB', 'QO', 'AC', 'CP', 'DG', 'EA', 'IC', 'TA', 'CQ'];
      const withdrawn = ['AN', 'BU', 'CS', 'DD', 'DY', 'FX', 'HV', 'NH', 'RH', 'SU', 'TP', 'UK', 'VD', 'YD', 'YU', 'ZR'];
      if (name && name !== code && !notPlaces.includes(code) && !withdrawn.includes(code)) {
        if (!geoBackfill.CONTINENT_OF[code]) missing.push(`${code} ${name}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

Given('an access log holding:', function (table) {
  const rows = table.hashes();
  const days = daysFromRows(rows);
  for (const day of days) for (const entry of day.entries) {
    const row = rows.find((r) => r.time === entry.time);
    if (row.geo) entry.geo = { city: row.geo };
  }
  state(this).bucket = fakeAccessBucket(days);
  state(this).places = {};
  state(this).lookups = [];
});

Given('a lookup service that places {string} in {string}, {string}, {string}', function (ip, city, country, timezone) {
  state(this).places[ip] = { city, country, timezone };
});

const runBackfill = async (world, dryRun) => {
  const s = state(world);
  const lookup = (ip) => {
    s.lookups.push(ip);
    const place = s.places[ip];
    return geoBackfill.lookUp(ip, async () => new Response(JSON.stringify(place ? { ip, ...place } : { ip, bogon: true }), { status: 200 }));
  };
  s.report = await geoBackfill.backfill(s.bucket, { lookup, dryRun });
};

When('the access log is backfilled', async function () {
  await runBackfill(this, false);
});

When('the access log is backfilled as a dry run', async function () {
  await runBackfill(this, true);
});

const allEntries = (world) => state(world).bucket.keys().flatMap((key) => state(world).bucket.log(key.slice(5, -5)).entries);

Then('the lookup service should have been asked once, for {string}', function (ip) {
  assert.deepEqual(state(this).lookups, [ip]);
});

Then('every entry from {string} should be in {word}, United States, North America, America\\/Los_Angeles', function (ip, city) {
  const entries = allEntries(this).filter((e) => e.ip === ip);
  assert.ok(entries.length > 0);
  for (const e of entries) assert.deepEqual(e.geo, { city, country: 'United States', continent: 'North America', timezone: 'America/Los_Angeles' });
});

Then('the entry from {string} should still be in {string}', function (ip, city) {
  assert.deepEqual(allEntries(this).find((e) => e.ip === ip).geo, { city });
});

Then('the entry from {string} should have no place', function (ip) {
  assert.equal(allEntries(this).find((e) => e.ip === ip).geo, undefined);
});

Then('the backfill should report {int} days written, {int} given a place and {int} unplaced', function (written, added, unplaced) {
  const { days } = state(this).report;
  assert.equal(days.filter((d) => d.written).length, written);
  assert.equal(days.reduce((n, d) => n + d.added, 0), added);
  assert.equal(days.reduce((n, d) => n + d.unplaced, 0), unplaced);
});

Then('the file of {string} should hold {int} entries, every one with a place', function (day, count) {
  const file = state(this).bucket.log(day);
  assert.equal(file.entries.length, count);
  for (const e of file.entries) assert.ok(e.geo?.city, JSON.stringify(e));
});

// --- The world map -------------------------------------------------------------------------------------------------------

const worldMap = JSON.parse(readFileSync(join(ROOT, 'src/data/world-map.json'), 'utf-8'));

Given('a day with these entries, by country:', function (table) {
  state(this).entries = daysFromRows(table.hashes()).flatMap((day) => day.entries);
});

Then('by country the day should be {string}, with {int} unplaced', function (expected, unplaced) {
  const { countries, unplaced: apart } = view.byCountry(state(this).entries);
  assert.equal(countries.map((c) => `${c.country} ${c.views}+${c.photos}`).join(', '), expected);
  assert.equal(apart, unplaced);
});

Then('the bands for a busiest country of {int} should be {string}', function (max, expected) {
  const ranges = view.bands(max);
  assert.equal(ranges.map(([from, to]) => (from === to ? String(from) : `${from}–${to}`)).join(', '), expected);
  for (let n = 1; n <= max; n++) assert.ok(view.bandOf(n, ranges) >= 0, `${n} has a band`);
  assert.equal(view.bandOf(0, ranges), -1);
});

Then("the world map's data should hold at least {int} countries, each with a unique ISO code and a drawable shape", function (min) {
  const { countries } = worldMap;
  assert.ok(countries.length >= min, `${countries.length} countries`);
  const codes = countries.map((c) => c.code).filter(Boolean);
  assert.equal(new Set(codes).size, codes.length, 'no code twice');
  for (const c of countries) {
    assert.ok(c.code === null || /^[A-Z]{2}$/.test(c.code), c.code);
    assert.match(c.d, /^M[\d.,LMZ-]+$/, `${c.name} is an SVG path`);
  }
});

Then('every country on the map should be named exactly as the access log would name it', function () {
  // The map matches visits to countries by name: the name geoFrom gives Cloudflare's code for that country.
  const mismatched = worldMap.countries.filter((c) => c.code && log.geoFrom({ country: c.code })?.country !== c.name).map((c) => `${c.code} ${c.name}`);
  assert.deepEqual(mismatched, []);
});

Then('the cities of {string} should be {string}', function (country, expected) {
  const found = view.byCountry(state(this).entries).countries.find((c) => c.country === country);
  assert.equal(found.cities.map(({ key, count }) => `${key} ${count}`).join(', '), expected);
});

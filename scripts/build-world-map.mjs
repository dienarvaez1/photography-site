// npm run map:build
// Writes src/data/world-map.json: every country of Natural Earth's 1:110m map (the world-atlas package) as an SVG path,
// projected once here (Natural Earth projection, Antarctica left out), so the Admin page's Access Info map draws plain
// paths and ships no mapping library. Each country carries its ISO code and its English name as the site's own access
// log names it (geoFrom in src/config/access-log.ts: Intl's region names), which is how the map matches visits to it.
// Run it again only to change the map's look or detail; the output is committed.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import countries from 'i18n-iso-countries';

const require = createRequire(import.meta.url);
const topology = JSON.parse(readFileSync(require.resolve('world-atlas/countries-110m.json'), 'utf-8'));
const WIDTH = 960;
const HEIGHT = 470;
// Natural Earth leaves a few places without an ISO number; the ones the log can name get their code here.
const UNNUMBERED = { Kosovo: 'XK' };
const regions = new Intl.DisplayNames(['en'], { type: 'region' });

const shapes = feature(topology, topology.objects.countries).features.filter((f) => f.properties.name !== 'Antarctica');
const projection = geoNaturalEarth1().fitSize([WIDTH, HEIGHT], { type: 'FeatureCollection', features: shapes });
const path = geoPath(projection).digits(1);

const out = shapes
  .map((f) => {
    const code = (f.id ? countries.numericToAlpha2(f.id) : undefined) ?? UNNUMBERED[f.properties.name] ?? null;
    const name = code ? regions.of(code) : f.properties.name;
    return { code, name, d: path(f) };
  })
  .filter((c) => c.d)
  .sort((a, b) => a.name.localeCompare(b.name));

const target = new URL('../src/data/world-map.json', import.meta.url);
writeFileSync(target, `${JSON.stringify({ width: WIDTH, height: HEIGHT, source: 'Natural Earth 1:110m via world-atlas 2 (public domain)', countries: out })}\n`);
console.log(`${out.length} countries (${out.filter((c) => !c.code).length} without an ISO code), ${(readFileSync(target).length / 1024).toFixed(1)} KB`);

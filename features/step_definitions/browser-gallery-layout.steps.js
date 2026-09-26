import { Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';

const page = (world) => world.b.page;

// Matches the 1.2x cap in Gallery.astro's .ratio-N rules, plus headroom for ratioClass()'s own
// rounding (a photo's exact ratio buckets to the nearest tenth before the cap ever applies).
const MAX_STRETCH = 1.3;

Then('the first gallery tile\'s rendered aspect ratio should be within 30% of its photo\'s own', async function () {
  const tile = await page(this).locator('.tile').first().evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const img = el.querySelector('img');
    return {
      renderedRatio: rect.width / rect.height,
      trueRatio: Number(img.getAttribute('width')) / Number(img.getAttribute('height')),
    };
  });
  const stretch = tile.renderedRatio / tile.trueRatio;
  assert.ok(
    stretch <= MAX_STRETCH,
    `tile stretched to ${stretch.toFixed(2)}x its photo's own ratio (rendered ${tile.renderedRatio.toFixed(3)}, true ${tile.trueRatio.toFixed(3)}) — object-fit: cover would crop away too much`
  );
});

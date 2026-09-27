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

Then("the gallery should be centered in the page's content column, not flush left", async function () {
  const boxes = await page(this).evaluate(() => ({
    section: document.querySelector('.work-photos').getBoundingClientRect().toJSON(),
    tile: document.querySelector('.tile').getBoundingClientRect().toJSON(),
  }));
  const leftGap = boxes.tile.left - boxes.section.left;
  const rightGap = boxes.section.right - boxes.tile.right;
  assert.ok(leftGap > 10, `the tile has no room to its left (${leftGap}px) — it isn't centered, it's flush left`);
  assert.ok(Math.abs(leftGap - rightGap) < 2, `left gap ${leftGap}px and right gap ${rightGap}px should be equal for a centered tile`);
});

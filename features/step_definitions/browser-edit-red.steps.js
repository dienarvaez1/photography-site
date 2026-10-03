// Edit mode is red on every Admin tab, as on the site's own pages (the page editor): whatever edit is under way — its
// bar or form, the rows being edited, the checkboxes and switches, and the button that started it.
import { Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';

const RED = 'rgb(229, 72, 77)';
const FILLED_RED = 'rgb(198, 42, 47)'; // a deeper red behind white text, for contrast

async function editLook(page) {
  return page.evaluate(() => {
    const visible = (el) => el.getClientRects().length > 0;
    const css = (el) => getComputedStyle(el);
    return {
      frames: [...document.querySelectorAll('.pics-edit-bar, .pics-remove-bar, .photo-form, .category-list.edit .category-row-body')].filter(visible).map((el) => ({ what: el.className, border: css(el).borderTopColor })),
      checks: [...document.querySelectorAll('.pic-check:not(.pic-switch), .run-check')].filter(visible).map((el) => css(el).accentColor),
      switchesOn: [...document.querySelectorAll('.pic-switch:checked')].filter(visible).map((el) => css(el).backgroundColor),
      primaries: [...document.querySelectorAll(':is(.pics-edit-bar, .pics-remove-bar, .photo-form, .category-list.edit) .results-button.primary')].filter(visible).map((el) => css(el).backgroundColor),
    };
  });
}

Then('the edit mode should be shown in red', async function () {
  await new Promise((resolve) => setTimeout(resolve, 300)); // colours fade in over 0.15s
  const look = await editLook(this.b.page);
  assert.ok(look.frames.length > 0, 'an edit bar, form or row is showing');
  for (const frame of look.frames) assert.equal(frame.border, RED, `${frame.what} is framed in red`);
  for (const colour of look.checks) assert.equal(colour, RED, 'checkboxes are red');
  for (const colour of look.switchesOn) assert.equal(colour, RED, 'a switch that is on is red');
  for (const colour of look.primaries) assert.equal(colour, FILLED_RED, 'the main button is red');
});

Then('the edit mode should be shown in red, with the {string} button marked red', async function (name) {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const look = await editLook(this.b.page);
  assert.ok(look.frames.length > 0, 'an edit bar, form or row is showing');
  for (const frame of look.frames) assert.equal(frame.border, RED, `${frame.what} is framed in red`);
  for (const colour of look.checks) assert.equal(colour, RED, 'checkboxes are red');
  const pressed = this.b.page.locator('[aria-pressed="true"]', { hasText: name }).first();
  assert.equal(await pressed.evaluate((el) => getComputedStyle(el).borderTopColor), RED, `"${name}" is marked red`);
});

import { When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';

const page = (world) => world.b.page;
const eyebrowTop = (world, selector) => page(world).locator(selector).first().evaluate((el) => el.getBoundingClientRect().top);

When('I remember the tagline\'s height', async function () {
  this.data.taglineTop = await eyebrowTop(this, '.hero .eyebrow');
});

Then('the About page\'s eyebrow should be at the remembered height', async function () {
  const aboutTop = await eyebrowTop(this, '.about .eyebrow');
  assert.equal(aboutTop, this.data.taglineTop, `home tagline at ${this.data.taglineTop}px, About eyebrow at ${aboutTop}px`);
});

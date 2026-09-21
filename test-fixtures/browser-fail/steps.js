import { Then } from '@cucumber/cucumber';

Then('this scenario fails on purpose', function () {
  throw new Error('failing on purpose to produce artifacts');
});

import { Given, When } from '@cucumber/cucumber';

Given('a step that passes', function () {}); // cucumber ignores Given/When/Then, so one definition serves all three
When('a step that fails with {string}', function (message) {
  throw new Error(message);
});
Given('a step that skips', function () {
  return 'skipped';
});

// Runs one failing and one passing real-browser scenario, to prove failures leave a screenshot, a trace and notes.
export default {
  paths: ['test-fixtures/browser-fail/fail.feature'],
  import: ['features/support/browser.js', 'features/support/lib.js', 'features/step_definitions/browser.steps.js', 'test-fixtures/browser-fail/steps.js'],
};

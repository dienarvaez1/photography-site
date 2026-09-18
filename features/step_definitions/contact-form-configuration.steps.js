import { Given, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { loadMessages, pageLocale, readWeb3FormsKeyFromEnv, web3formsEnvName } from '../support/lib.js';

// Web3Forms access keys are UUIDs, e.g. f2f6da0a-9eee-4310-bebe-caa49e02370b
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Given('the Web3Forms access key for locale {string} from the environment', function (locale) {
  // Explicit per-locale key only: a missing Spanish key must fail, not silently reuse the English one.
  this.data.web3formsLocale = locale;
  this.data.web3formsEnvName = web3formsEnvName(locale);
  this.data.web3formsKeys = { ...this.data.web3formsKeys, [locale]: readWeb3FormsKeyFromEnv(locale) };
  this.data.web3formsKey = this.data.web3formsKeys[locale];
});

Then('the {string} and {string} access keys should be different', function (a, b) {
  const keys = this.data.web3formsKeys;
  assert.notEqual(
    keys[a],
    keys[b],
    `The "${a}" and "${b}" contact pages share one Web3Forms key — each language should use its own form`
  );
});

Then('the access key should be a non-empty string', function () {
  assert.ok(
    typeof this.data.web3formsKey === 'string' && this.data.web3formsKey.length > 0,
    `${this.data.web3formsEnvName} is not set in .env — the contact form will show the "not configured" ` +
      'notice (or, for Spanish, post to the English form) instead of working. Get a free key at ' +
      'https://web3forms.com/ and set it in .env (and, separately, in any CI/deploy pipeline\'s ' +
      'build environment variables).'
  );
});

Then('the access key should look like a valid Web3Forms UUID key', function () {
  assert.ok(
    UUID_PATTERN.test(this.data.web3formsKey ?? ''),
    `${this.data.web3formsEnvName} ("${this.data.web3formsKey}") does not look like a valid UUID-format Web3Forms key`
  );
});

Then('the contact page should render the real contact form', function () {
  const form = this.data.page.root.querySelector('#contact-form');
  assert.ok(form, 'Contact page does not render the #contact-form element');
});

Then('the contact page should not show the {string} notice', function (noticeFragment) {
  assert.equal(noticeFragment, 'not configured');
  assert.ok(
    this.data.page.root.querySelector('.notice') === null,
    'Contact page still shows the "not configured" notice alongside (or instead of) the real form'
  );
});

Then('the form\'s hidden access_key field should equal the configured Web3Forms key', function () {
  const input = this.data.page.root.querySelector('input[name="access_key"]');
  assert.ok(input, 'Contact form is missing its hidden access_key input');
  assert.equal(
    input.getAttribute('value'),
    this.data.web3formsKey,
    `The access_key hidden field value does not match ${this.data.web3formsEnvName} from .env — the form ` +
      'was built against a different (or missing) key than the one currently configured'
  );
});

Then('the contact page script should submit to the Web3Forms API endpoint', function () {
  assert.ok(
    this.data.page.html.includes('https://api.web3forms.com/submit'),
    'Contact page script does not reference the Web3Forms submit endpoint'
  );
});

Then('the contact form should include a name field', function () {
  assert.ok(
    this.data.page.root.querySelector('#contact-form input[name="name"]'),
    'Contact form is missing its name field'
  );
});

Then('the contact form should include an email field', function () {
  const input = this.data.page.root.querySelector('#contact-form input[name="email"]');
  assert.ok(input, 'Contact form is missing its email field');
  assert.equal(input.getAttribute('type'), 'email', 'Email field is not type="email"');
});

Then('the contact form should include a message field', function () {
  assert.ok(
    this.data.page.root.querySelector('#contact-form textarea[name="message"]'),
    'Contact form is missing its message field'
  );
});

Then('the contact form should include a spam honeypot field', function () {
  const input = this.data.page.root.querySelector('#contact-form input[name="botcheck"]');
  assert.ok(input, 'Contact form is missing its botcheck honeypot field');
  assert.equal(input.getAttribute('aria-hidden'), 'true', 'Honeypot field should be aria-hidden from assistive tech');
});

Then("the contact form labels, button and status messages should be in the page's language", function () {
  const { root } = this.data.page;
  const { contact } = loadMessages(pageLocale(this.data.page));
  const form = root.querySelector('#contact-form');
  assert.ok(form, 'Contact page does not render the #contact-form element');

  const labelFor = (selector) => form.querySelector(selector)?.closest('label')?.text.replace(/\s+/g, ' ').trim();
  assert.ok(labelFor('input[name="name"]')?.startsWith(contact.name), `Name label should start with "${contact.name}"`);
  assert.ok(labelFor('input[name="email"]')?.startsWith(contact.email), `Email label should start with "${contact.email}"`);
  assert.ok(labelFor('select[name="category"]')?.startsWith(contact.interest), `Interest label should start with "${contact.interest}"`);
  assert.ok(labelFor('textarea[name="message"]')?.startsWith(contact.message), `Message label should start with "${contact.message}"`);
  assert.equal(form.querySelector('button[type="submit"]')?.text.trim(), contact.send, 'Submit button label');
  assert.equal(form.getAttribute('data-msg-sending'), contact.sending, 'Sending status message');
  assert.equal(form.getAttribute('data-msg-success'), contact.success, 'Success status message');
  assert.equal(form.getAttribute('data-msg-error'), contact.error, 'Error status message');
  assert.equal(form.querySelector('option[value="Other"]')?.text.trim(), contact.other, '"Other" option label');
  assert.equal(root.querySelector('h1')?.text.trim(), contact.heading, 'Contact heading');
});

Then('the contact form category options should submit English values', function () {
  const english = loadMessages('en');
  const allowed = new Set([...Object.values(english.categories).map((c) => c.label), 'Other']);
  const options = this.data.page.root.querySelectorAll('#contact-form select[name="category"] option');
  assert.ok(options.length > 0, 'Contact form has no category options (is PUBLIC_WEB3FORMS_KEY set?)');
  const violations = options.map((o) => o.getAttribute('value')).filter((v) => !allowed.has(v));
  assert.deepEqual(violations, [], 'Found option values that are not English category labels');
});

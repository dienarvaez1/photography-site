import { Given, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readWeb3FormsKeyFromEnv } from '../support/lib.js';

// Web3Forms access keys are UUIDs, e.g. f2f6da0a-9eee-4310-bebe-caa49e02370b
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Given('the Web3Forms access key from the environment', function () {
  this.data.web3formsKey = readWeb3FormsKeyFromEnv();
});

Then('the access key should be a non-empty string', function () {
  assert.ok(
    typeof this.data.web3formsKey === 'string' && this.data.web3formsKey.length > 0,
    'PUBLIC_WEB3FORMS_KEY is not set in .env — the contact form will show the "not configured" ' +
      'notice instead of working. Get a free key at https://web3forms.com/ and set it in .env ' +
      '(and, separately, in any CI/deploy pipeline\'s build environment variables).'
  );
});

Then('the access key should look like a valid Web3Forms UUID key', function () {
  assert.ok(
    UUID_PATTERN.test(this.data.web3formsKey ?? ''),
    `PUBLIC_WEB3FORMS_KEY ("${this.data.web3formsKey}") does not look like a valid UUID-format Web3Forms key`
  );
});

Then('the contact page should render the real contact form', function () {
  const form = this.data.page.root.querySelector('#contact-form');
  assert.ok(form, 'Contact page does not render the #contact-form element');
});

Then('the contact page should not show the {string} notice', function (noticeFragment) {
  assert.equal(noticeFragment, 'not configured');
  assert.ok(
    !/isn.t configured yet/i.test(this.data.page.html),
    'Contact page still shows the "not configured" notice alongside (or instead of) the real form'
  );
});

Then('the form\'s hidden access_key field should equal the configured Web3Forms key', function () {
  const input = this.data.page.root.querySelector('input[name="access_key"]');
  assert.ok(input, 'Contact form is missing its hidden access_key input');
  assert.equal(
    input.getAttribute('value'),
    this.data.web3formsKey,
    'The access_key hidden field value does not match PUBLIC_WEB3FORMS_KEY from .env — the form ' +
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

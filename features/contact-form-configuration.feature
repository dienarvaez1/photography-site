Feature: Contact page Web3Forms configuration
  As a site maintainer
  I want the Contact page's Web3Forms integration to be genuinely configured and correctly wired
  So that visitors always see a working form instead of silently getting the "not configured" notice

  This guards against a specific regression: PUBLIC_WEB3FORMS_KEY exists in the local .env file
  but a separate deploy pipeline (e.g. Cloudflare's own Git-triggered build) doesn't have it,
  silently shipping the fallback notice in place of a working form.

  Background:
    Given the Web3Forms access key from the environment

  Scenario: A Web3Forms access key is present
    Then the access key should be a non-empty string

  Scenario: The access key is a well-formed Web3Forms key
    Then the access key should look like a valid Web3Forms UUID key

  Scenario: The built Contact page renders the real form, not the fallback notice
    When I load the built page "/contact/"
    Then the contact page should render the real contact form
    And the contact page should not show the "not configured" notice

  Scenario: The rendered form is wired to the configured access key
    When I load the built page "/contact/"
    Then the form's hidden access_key field should equal the configured Web3Forms key

  Scenario: The rendered form submits to the Web3Forms API
    When I load the built page "/contact/"
    Then the contact page script should submit to the Web3Forms API endpoint

  Scenario: The contact form includes every required field
    When I load the built page "/contact/"
    Then the contact form should include a name field
    And the contact form should include an email field
    And the contact form should include a message field
    And the contact form should include a spam honeypot field

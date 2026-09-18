Feature: Contact page Web3Forms configuration (English and Spanish)
  As a site maintainer
  I want the Contact page's Web3Forms integration to be genuinely configured and correctly wired
  So that visitors, in either language, always see a working form instead of silently getting the "not configured" notice

  This guards against a specific regression: a key exists in the local .env file but a separate
  deploy pipeline (e.g. Cloudflare's own Git-triggered build) doesn't have it, silently shipping
  the fallback notice — or, for Spanish, silently sending Spanish messages to the English form.

  Each language has its own Web3Forms form: PUBLIC_WEB3FORMS_KEY for English (/contact/) and
  PUBLIC_WEB3FORMS_KEY_ES for Spanish (/es/contact/).

  Scenario Outline: Each language has its own explicitly configured Web3Forms access key
    Given the Web3Forms access key for locale "<locale>" from the environment
    Then the access key should be a non-empty string
    And the access key should look like a valid Web3Forms UUID key

    Examples:
      | locale |
      | en     |
      | es     |

  Scenario: The Spanish contact form uses a different Web3Forms form than the English one
    Given the Web3Forms access key for locale "en" from the environment
    And the Web3Forms access key for locale "es" from the environment
    Then the "es" and "en" access keys should be different

  Scenario Outline: The built Contact page renders the real form, not the fallback notice
    Given the Web3Forms access key for locale "<locale>" from the environment
    When I load the built page "<route>"
    Then the contact page should render the real contact form
    And the contact page should not show the "not configured" notice

    Examples:
      | route        | locale |
      | /contact/    | en     |
      | /es/contact/ | es     |

  Scenario Outline: The rendered form is wired to its language's configured access key
    Given the Web3Forms access key for locale "<locale>" from the environment
    When I load the built page "<route>"
    Then the form's hidden access_key field should equal the configured Web3Forms key

    Examples:
      | route        | locale |
      | /contact/    | en     |
      | /es/contact/ | es     |

  Scenario Outline: The rendered form submits to the Web3Forms API
    When I load the built page "<route>"
    Then the contact page script should submit to the Web3Forms API endpoint

    Examples:
      | route        |
      | /contact/    |
      | /es/contact/ |

  Scenario Outline: The contact form includes every required field
    When I load the built page "<route>"
    Then the contact form should include a name field
    And the contact form should include an email field
    And the contact form should include a message field
    And the contact form should include a spam honeypot field

    Examples:
      | route        |
      | /contact/    |
      | /es/contact/ |

  Scenario Outline: The contact form is presented in the page's language
    When I load the built page "<route>"
    Then the contact form labels, button and status messages should be in the page's language
    And the contact form category options should submit English values

    Examples:
      | route        |
      | /contact/    |
      | /es/contact/ |

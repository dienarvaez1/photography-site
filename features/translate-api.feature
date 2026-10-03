Feature: The results API translates the page editor's text between English and Spanish
  As the site owner editing a page's headings and descriptions
  I want what I write translated into the other language before it is saved
  So that the English and Spanish pages always say the same thing

  The real Worker code (workers/results-api/src/translate.mjs), with a stand-in for Workers AI that notes what it was
  asked. The browser side is in browser/page-editor.feature.

  Background:
    Given a results API with the admin token "translate-test-admin-token" and a translation service

  Scenario: English text comes back in Spanish, one translation per text
    When I ask the API to translate from "en" to "es":
      | key           | text                       |
      | about.heading | Real moments.              |
      | about.intro   | First one.\n\nSecond one.  |
    Then the response should be 200 with these translations:
      | key           | text                            |
      | about.heading | [es] Real moments.              |
      | about.intro   | [es] First one.\n\nSecond one.  |
    And the translation service should have been asked 2 times, with model "@cf/meta/llama-3.3-70b-instruct-fp8-fast", from English to Spanish

  Scenario: Spanish text comes back in English
    When I ask the API to translate from "es" to "en":
      | key            | text              |
      | contact.heading | Trabajemos juntos. |
    Then the response should be 200 with these translations:
      | key             | text                    |
      | contact.heading | [en] Trabajemos juntos. |
    And the translation service should have been asked 1 time, with model "@cf/meta/llama-3.3-70b-instruct-fp8-fast", from Spanish to English

  Scenario: A translation wrapped in quotes or labelled is tidied
    Given the translation service answers with quotes and a label
    When I ask the API to translate from "en" to "es":
      | key           | text          |
      | about.heading | Real moments. |
    Then the response should be 200 with these translations:
      | key           | text               |
      | about.heading | [es] Real moments. |

  Scenario: A {placeholder} must survive the translation
    Given the translation service drops placeholders
    When I ask the API to translate from "en" to "es":
      | key           | text                       |
      | contact.intro | Email me at {email}.       |
    Then the translate response should be 502 with the error "translation-failed"

  Scenario: A placeholder that survives is kept as it is
    When I ask the API to translate from "en" to "es":
      | key           | text                 |
      | contact.intro | Email me at {email}. |
    Then the response should be 200 with these translations:
      | key           | text                      |
      | contact.intro | [es] Email me at {email}. |

  Scenario Outline: Requests it refuses: <case>
    When I send the API this translation request: <body>
    Then the translate response should be <status> with the error "<error>"
    And the translation service should not have been asked

    Examples:
      | case                  | body                                                                     | status | error       |
      | the same language     | {"from":"en","to":"en","texts":{"a":"Hi"}}                              | 400    | bad-request |
      | an unknown language   | {"from":"en","to":"fr","texts":{"a":"Hi"}}                              | 400    | bad-request |
      | no texts              | {"from":"en","to":"es","texts":{}}                                      | 400    | bad-request |
      | an empty text         | {"from":"en","to":"es","texts":{"a":"  "}}                              | 400    | bad-request |
      | HTML                  | {"from":"en","to":"es","texts":{"a":"<b>Hi</b>"}}                       | 400    | bad-request |
      | not JSON              | not json                                                                 | 400    | bad-request |

  Scenario: Too many texts at once are refused
    When I ask the API to translate 13 texts at once
    Then the translate response should be 400 with the error "bad-request"

  Scenario: A translation that comes back as HTML is refused
    Given the translation service answers with HTML
    When I ask the API to translate from "en" to "es":
      | key           | text          |
      | about.heading | Real moments. |
    Then the translate response should be 502 with the error "translation-failed"

  Scenario: The translation service failing is reported, not hidden
    Given the translation service is down
    When I ask the API to translate from "en" to "es":
      | key           | text          |
      | about.heading | Real moments. |
    Then the translate response should be 502 with the error "translation-failed"

  Scenario: Without the admin token nothing is translated
    When I ask the API to translate with the token "wrong-token-wrong-token"
    Then the translate response should be 401 with the error "unauthorized"
    And the translation service should not have been asked

  Scenario: A Worker without the AI binding says so
    Given the results API has no translation service
    When I ask the API to translate from "en" to "es":
      | key           | text          |
      | about.heading | Real moments. |
    Then the translate response should be 500 with the error "misconfigured"

  Scenario: The deployed Worker has the AI binding
    Then the results API's wrangler.jsonc should bind Workers AI as "AI"

Feature: The post-deploy smoke check catches a broken site
  As the site owner
  I want one command that checks the live site the way a visitor would
  So that a deploy that quietly broke the contact forms, the photos or the error pages is noticed at once

  The checker is run against the real built site served locally the way Cloudflare serves it
  (with its _headers and 404 handling), with R2 faked. Each scenario then breaks one thing.

  Background:
    Given the built site is served locally and R2 has every photo the pages reference

  Scenario: A healthy site passes every check
    When the smoke check runs
    Then the smoke check should pass
    And the smoke check should have verified all of these:
      | sitemap lists the pages                                        |
      | every page loads with lang, title, canonical and hreflang      |
      | English contact form has its key                               |
      | Spanish contact form has its key                               |
      | each language uses its own Web3Forms form                      |
      | unknown English URL gets a real 404 page                       |
      | unknown Spanish URL gets a real 404 page                       |
      | robots.txt points at the real sitemap                          |
      | security headers are sent (incl. Content-Security-Policy)      |

  Scenario: It checks every photo URL the pages use
    When the smoke check runs
    Then the smoke check should have requested every R2 photo URL used by the pages

  Scenario: It knows which keys the forms should use
    When the smoke check runs expecting the keys that are in the pages
    Then the smoke check should pass

  Scenario Outline: A deploy that breaks one thing is caught by the right check
    Given <breakage>
    When the smoke check runs
    Then the smoke check should fail
    And the failing check should be "<check>" mentioning "<detail>"

    Examples:
      | breakage                                                    | check                                                     | detail                                  |
      | the English contact page shows the "not configured" notice  | English contact form has its key                          | not configured                          |
      | the Spanish contact page shows the "not configured" notice  | Spanish contact form has its key                          | not configured                          |
      | the Spanish form uses the English key                       | each language uses its own Web3Forms form                 | same key                                |
      | a contact form has lost its endpoint                        | English contact form has its key                          | does not post to Web3Forms              |
      | one photo in R2 is missing                                  | all                                                       | 404                                     |
      | unknown URLs get a blank 404 instead of the 404 page        | unknown English URL gets a real 404 page                  | body is not the 404 page                |
      | robots.txt points at the old pages.dev sitemap              | robots.txt points at the real sitemap                     | differs from the site's                 |
      | the Content-Security-Policy header is missing               | security headers are sent (incl. Content-Security-Policy) | content-security-policy                 |
      | the home page lost its hreflang alternates                  | every page loads with lang, title, canonical and hreflang | no hreflang                             |
      | the home page is accidentally noindex                       | every page loads with lang, title, canonical and hreflang | noindex                                 |

  Scenario: A form using a key other than the configured one is caught
    When the smoke check runs expecting different keys
    Then the smoke check should fail
    And the failing check should be "English contact form has its key" mentioning "not the configured one"

  Scenario: An unreachable site fails cleanly instead of crashing
    Given nothing is listening at the site address
    When the smoke check runs
    Then the smoke check should fail
    And the failing check should be "sitemap lists the pages" mentioning ""

  Scenario: The command line exits with a failure code when the site is not reachable
    When I run the smoke command against an address where nothing is listening
    Then the smoke command should exit with code 1 and say the checks failed

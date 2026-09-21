@browser
Feature: Language switching and the location-based default, in a real browser
  As a visitor
  I want the site in my language, and my own choice to stick
  So that I am never bounced away from the language I picked

  # --- The switcher ---------------------------------------------------------------------------

  Scenario: The switcher goes to the same page in the other language and remembers the choice
    When I open "/work/pets/"
    And I click the language switcher link "ES"
    Then the page path should be "/es/work/pets/"
    And the page language should be "es"
    And the browser should remember the language "es"

  Scenario: Switching back to English is remembered too
    When I open "/es/about/"
    And I click the language switcher link "EN"
    Then the page path should be "/about/"
    And the browser should remember the language "en"

  Scenario: The switcher marks the current language and is usable by keyboard alone
    When I open "/contact/"
    Then the current language "EN" should be marked, and "ES" should be a link
    When I tab until keyboard focus reaches the language link "ES"
    And I press the key "Enter"
    Then the page path should be "/es/contact/"

  # --- A choice always beats the location -----------------------------------------------------------

  Scenario: A remembered Spanish choice sends the visitor to the Spanish home page, even from the USA
    Given Cloudflare says the visitor is in "US"
    And the visitor's browser already remembers the language "es"
    When I open "/"
    Then the visitor should end up on "/es/"
    And Cloudflare's location should not have been asked

  Scenario: A remembered English choice keeps a visitor in Mexico on the English site
    Given Cloudflare says the visitor is in "MX"
    And the visitor's browser already remembers the language "en"
    When I open "/"
    Then the visitor should stay on "/" once location detection has had time to run

  Scenario: The full round trip: switch to English while in Mexico and stay there
    Given Cloudflare says the visitor is in "MX"
    When I open "/"
    Then the visitor should end up on "/es/"
    When I click the language switcher link "EN"
    Then the page path should be "/"
    And the visitor should stay on "/" once location detection has had time to run

  # --- First visit: the location decides ---------------------------------------------------------------

  Scenario Outline: A first-time visitor lands in the language of their country
    Given Cloudflare says the visitor is in "<country>"
    When I open "/"
    Then the visitor should <result>

    Examples:
      | country | result                                                                 |
      | MX      | end up on "/es/"                                                       |
      | ES      | end up on "/es/"                                                       |
      | AR      | end up on "/es/"                                                       |
      | US      | stay on "/" once location detection has had time to run                |
      | CA      | stay on "/" once location detection has had time to run                |
      | GB      | stay on "/" once location detection has had time to run                |

  Scenario Outline: When the location can't be found, the visitor stays on English unless the browser says Spanish
    Given <lookup>
    And the visitor's browser language is "<browser>"
    When I open "/"
    Then the visitor should <result>

    Examples:
      | lookup                                       | browser | result                                                      |
      | Cloudflare's location lookup is unavailable  | en-US   | stay on "/" once location detection has had time to run     |
      | Cloudflare's location lookup is unavailable  | es-MX   | end up on "/es/"                                            |
      | Cloudflare's location lookup fails to connect | es-ES  | end up on "/es/"                                            |
      | Cloudflare's location lookup never answers   | en-US   | stay on "/" once location detection has had time to run     |

  Scenario: A known country beats the browser language
    Given Cloudflare says the visitor is in "US"
    And the visitor's browser language is "es-MX"
    When I open "/"
    Then the visitor should stay on "/" once location detection has had time to run

  Scenario: The visitor's query string and anchor survive the redirect
    Given Cloudflare says the visitor is in "MX"
    When I open "/?utm_source=mail#featured"
    Then the visitor should end up on "/es/" with the address ending "?utm_source=mail#featured"

  # --- Where detection does and doesn't run -----------------------------------------------------------------

  Scenario Outline: Only the English home page ever redirects
    Given Cloudflare says the visitor is in "MX"
    When I open "<page>"
    Then the visitor should stay on "<page>" once location detection has had time to run
    And Cloudflare's location should not have been asked

    Examples:
      | page             |
      | /about/          |
      | /contact/        |
      | /work/pets/      |
      | /es/             |
      | /es/about/       |

  Scenario: Search engine crawlers are never redirected
    Given Cloudflare says the visitor is in "MX"
    And the visitor is a search engine crawler
    When I open "/"
    Then the visitor should stay on "/" once location detection has had time to run
    And Cloudflare's location should not have been asked

  Scenario: Detection does not break the page when storage is blocked
    Given Cloudflare says the visitor is in "MX"
    And the browser blocks local storage
    When I open "/"
    Then the visitor should end up on "/es/"
    When I click the language switcher link "EN"
    Then the page path should be "/"
    And no script error should have been logged

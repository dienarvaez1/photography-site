Feature: Location-based default language
  As a first-time visitor
  I want the site to open in the language of my country
  So that a visitor in Mexico lands on the Spanish site and a visitor in the USA lands on the English one,
  without ever overriding a language I chose myself

  Rules, in order: the visitor's own remembered choice, then their country (from Cloudflare's IP
  geolocation), then - only when the country can't be determined - the browser's language, then
  English. Detection only runs on the English home page ("/").

  Scenario Outline: A country maps to a language
    Then the country "<country>" should map to the language "<language>"

    Examples:
      | country | language |
      | MX      | es       |
      | ES      | es       |
      | AR      | es       |
      | CO      | es       |
      | CL      | es       |
      | PE      | es       |
      | PR      | es       |
      | mx      | es       |
      | US      | en       |
      | CA      | en       |
      | GB      | en       |
      | DE      | en       |
      | JP      | en       |
      | XX      | en       |
      |         | en       |

  Scenario: The country list is well-formed
    Then every listed country should be an uppercase ISO 3166-1 alpha-2 code
    And every listed country should belong to exactly one language
    And every language with listed countries should be a configured locale

  Scenario Outline: A visitor's own choice beats their location
    Then a visitor with remembered choice "<stored>" in country "<country>" should get the language "<language>"

    Examples:
      | stored | country | language | why                                   |
      | none   | MX      | es       | location decides                      |
      | none   | US      | en       | location decides                      |
      | none   | none    | en       | nothing known: default                |
      | en     | MX      | en       | chose English while in Mexico         |
      | es     | US      | es       | chose Spanish while in the USA        |
      | fr     | MX      | es       | unknown stored value is ignored       |

  Scenario Outline: The country is read from Cloudflare's trace response
    Then the trace text "<trace>" should give the country "<country>"

    Examples:
      | trace                              | country |
      | fl=1\nloc=MX\ntls=TLSv1.3          | MX      |
      | loc=US                             | US      |
      | fl=1\nloc=mx\n                     | MX      |
      | loc=XX                             | none    |
      | loc=T1                             | none    |
      | colo=PDX                           | none    |
      |                                    | none    |

  Scenario Outline: The home page redirects first-time visitors according to their country
    Given a visitor on the English home page with remembered choice "<stored>", user agent "<agent>" and a trace response of "<trace>"
    When the location detection runs
    Then the visitor should be redirected to "<target>"
    And Cloudflare's trace endpoint should be asked "<asked>"

    Examples:
      | stored | agent            | trace       | target | asked |
      | none   | Mozilla/5.0      | loc=MX      | /es/   | yes   |
      | none   | Mozilla/5.0      | loc=ES      | /es/   | yes   |
      | none   | Mozilla/5.0      | loc=US      | none   | yes   |
      | none   | Mozilla/5.0      | loc=CA      | none   | yes   |
      | none   | Mozilla/5.0      | loc=XX      | none   | yes   |
      | none   | Mozilla/5.0      | unreachable | none   | yes   |
      | none   | Mozilla/5.0      | http-error  | none   | yes   |
      | none   | Mozilla/5.0      | timeout     | none   | yes   |
      | en     | Mozilla/5.0      | loc=MX      | none   | no    |
      | es     | Mozilla/5.0      | loc=US      | /es/   | no    |
      | fr     | Mozilla/5.0      | loc=US      | none   | yes   |
      | none   | Googlebot/2.1    | loc=MX      | none   | no    |

  Scenario: The visitor's query string and hash survive the redirect
    Given a visitor on the English home page with remembered choice "none", user agent "Mozilla/5.0" and a trace response of "loc=MX"
    And the visitor arrived with the query "?utm_source=mail" and the hash "#featured"
    When the location detection runs
    Then the visitor should be redirected to "/es/?utm_source=mail#featured"

  Scenario Outline: Detection only runs on the English home page
    Given a visitor on the page "<path>" with remembered choice "none", user agent "Mozilla/5.0" and a trace response of "loc=MX"
    When the location detection runs
    Then the visitor should be redirected to "none"
    And Cloudflare's trace endpoint should be asked "no"

    Examples:
      | path       |
      | /about/    |
      | /contact/  |
      | /work/pets/ |
      | /es/       |

  Scenario: Blocked browser storage never breaks detection or the language switcher
    Given a visitor on the English home page whose browser blocks storage and whose trace response is "loc=MX"
    When the location detection runs
    Then the visitor should be redirected to "/es/"
    And remembering a language choice should not throw

  Scenario: Only valid languages can be remembered
    Then remembering the language "fr" should store nothing
    And remembering the language "es" should store "es"

  Scenario: Development can pretend to be in another country
    Given a visitor on the English home page with remembered choice "none", user agent "Mozilla/5.0" and a trace response of "unreachable"
    And the development country override is "mx"
    When the location detection runs
    Then the visitor should be redirected to "/es/"
    And Cloudflare's trace endpoint should be asked "no"

  Scenario: Only the English home page ships the location-detection script
    When I load every built page
    Then the location-detection script should be present only on the page "/"

  Scenario: Every page remembers an explicit language choice from the language switcher
    When I load every built page
    Then every page should load the script that remembers the language switcher choice

  # --- Browser language: a tiebreaker only when the country is unknown ---------------------------

  Scenario Outline: The browser language decides only when the country is unknown
    Then a visitor with remembered choice "<stored>", country "<country>" and browser languages "<languages>" should get the language "<language>"

    Examples:
      | stored | country | languages     | language | why                                                  |
      | none   | US      | es-MX, es     | en       | a known country wins: USA stays English              |
      | none   | MX      | en-US         | es       | a known country wins over an English browser         |
      | none   | none    | es-MX, en     | es       | unknown country: Spanish browser                     |
      | none   | none    | es            | es       | unknown country: plain "es"                          |
      | none   | none    | en-US, es     | en       | unknown country: first supported language wins       |
      | none   | none    | fr-FR, es-AR  | es       | unsupported languages are skipped                    |
      | none   | none    | fr-FR, de     | en       | nothing supported: default                           |
      | none   | none    | none          | en       | nothing known: default                               |
      | en     | none    | es-MX         | en       | the visitor's own choice still wins                  |

  Scenario Outline: When the location lookup fails, a Spanish browser still lands on the Spanish site
    Given a visitor on the English home page with remembered choice "none", user agent "Mozilla/5.0" and a trace response of "<trace>"
    And the visitor's browser languages are "<languages>"
    When the location detection runs
    Then the visitor should be redirected to "<target>"

    Examples:
      | trace       | languages | target |
      | unreachable | es-MX, en | /es/   |
      | http-error  | es        | /es/   |
      | timeout     | es-ES     | /es/   |
      | loc=XX      | es-MX     | /es/   |
      | unreachable | en-US     | none   |
      | loc=US      | es-MX     | none   |
      | loc=MX      | en-US     | /es/   |

  Scenario: A visitor's remembered choice beats the browser language even when the lookup fails
    Given a visitor on the English home page with remembered choice "en", user agent "Mozilla/5.0" and a trace response of "unreachable"
    And the visitor's browser languages are "es-MX"
    When the location detection runs
    Then the visitor should be redirected to "none"

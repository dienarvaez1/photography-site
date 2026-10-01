Feature: The access log records who opened which page and which photo, one file per UTC day
  As the site owner
  I want every visit to a page, and every photo opened, recorded with its time in UTC and the visitor's address
  So that the Admin page's Access Info tab can show how the site is used, day by day

  The log's own code (src/config/access-log.ts) against a stand-in for its bucket that behaves like R2: conditional
  writes, and a way to make a write lose the race to a visit at the same moment. The results API's routes are called
  through the real request handler. (site-render.feature sends real reports to the built site in workerd, and
  browser/access-info.feature checks that the pages send them.)

  # --- What a page may report ------------------------------------------------------------------------------------------

  Scenario Outline: Only a path, one of two kinds and a photo's id and category are accepted
    Then the report <report> should be <verdict>

    Examples:
      | report                                                                              | verdict  |
      | {"page":"/","event":"view"}                                                         | accepted |
      | {"page":"/es/work/nature/","event":"view"}                                          | accepted |
      | {"page":"/work/nature/","event":"photo","photo":{"id":"ba380c579ee5e5ca","category":"nature"}} | accepted |
      | {"page":"/wp-admin/install.php","event":"view"}                                     | accepted |
      | {"page":"/","event":"view","ip":"198.51.100.1"}                                     | refused  |
      | {"page":"/","event":"view","time":"2020-01-01T00:00:00.000Z"}                      | refused  |
      | {"page":"/","event":"click"}                                                        | refused  |
      | {"page":"https://evil.example/","event":"view"}                                     | refused  |
      | {"page":"/a b/","event":"view"}                                                     | refused  |
      | {"page":"/<script>/","event":"view"}                                                | refused  |
      | {"page":"/","event":"view","photo":{"id":"ba380c579ee5e5ca","category":"nature"}}   | refused  |
      | {"page":"/","event":"photo"}                                                        | refused  |
      | {"page":"/","event":"photo","photo":{"id":"BA380C579EE5E5CA","category":"nature"}}  | refused  |
      | {"page":"/","event":"photo","photo":{"id":"ba380c579ee5e5ca","category":"Nature!"}} | refused  |
      | {"page":"/","event":"photo","photo":{"id":"ba380c579ee5e5ca","category":"nature","x":1}} | refused  |
      | ["/","view"]                                                                        | refused  |
      | "/"                                                                                 | refused  |

  Scenario: A path longer than 300 characters is refused
    Then a report of a 301-character path should be refused

  # --- One file per UTC day ----------------------------------------------------------------------------------------------

  Scenario Outline: An entry goes in the file of its UTC day, named by the day's first instant
    Then an entry at "<time>" should go in "<key>"

    Examples:
      | time                     | key                                    |
      | 2026-10-01T14:30:00.000Z | logs/2026-10-01T00:00:00.000Z.json     |
      | 2026-10-01T00:00:00.000Z | logs/2026-10-01T00:00:00.000Z.json     |
      | 2026-10-01T23:59:59.999Z | logs/2026-10-01T00:00:00.000Z.json     |
      | 2026-10-02T00:00:00.000Z | logs/2026-10-02T00:00:00.000Z.json     |

  Scenario: Entries are added to their day's file, oldest first, and a new day starts a new file
    Given an empty access log
    When these are recorded:
      | time                     | ip          | page          | event | photo            | category |
      | 2026-10-01T09:00:00.000Z | 203.0.113.7 | /             | view  |                  |          |
      | 2026-10-01T09:00:05.000Z | 203.0.113.7 | /work/nature/ | photo | ba380c579ee5e5ca | nature   |
      | 2026-10-02T00:00:01.000Z | 2001:db8::1 | /es/          | view  |                  |          |
    Then each should have been "recorded"
    And the access log should hold the files "logs/2026-10-01T00:00:00.000Z.json, logs/2026-10-02T00:00:00.000Z.json"
    And the file of "2026-10-01T00:00:00.000Z" should hold, in order:
      | time                     | ip          | page          | event | photo            | category |
      | 2026-10-01T09:00:00.000Z | 203.0.113.7 | /             | view  |                  |          |
      | 2026-10-01T09:00:05.000Z | 203.0.113.7 | /work/nature/ | photo | ba380c579ee5e5ca | nature   |

  Scenario: A visit that loses the race to another one at the same moment is still recorded, and so is the other
    Given an empty access log
    And the next 3 writes lose the race to another visit
    When a visit at "2026-10-01T10:00:00.000Z" from "203.0.113.7" to "/about/" is recorded
    Then it should have been "recorded"
    And the file of "2026-10-01T00:00:00.000Z" should hold 4 entries, the last a visit from "203.0.113.7" to "/about/"

  Scenario: A day that already holds the most entries a day may hold drops the next one
    Given the access log's file of "2026-10-01T00:00:00.000Z" already holds the most entries a day may hold
    When a visit at "2026-10-01T10:00:00.000Z" from "203.0.113.7" to "/about/" is recorded
    Then it should have been "full"
    And the file of "2026-10-01T00:00:00.000Z" should still hold the most entries a day may hold

  Scenario: An unreadable day file is started again rather than failing the visit
    Given the access log's file of "2026-10-01T00:00:00.000Z" holds "not json"
    When a visit at "2026-10-01T10:00:00.000Z" from "203.0.113.7" to "/about/" is recorded
    Then it should have been "recorded"
    And the file of "2026-10-01T00:00:00.000Z" should hold 1 entries, the last a visit from "203.0.113.7" to "/about/"

  # --- The results API: /access and /access/<day> ----------------------------------------------------------------------

  Scenario: The days with a log are listed newest first, behind the admin token
    Given a results API with the admin token "correct-admin-token-123" over an access log holding:
      | time                     | ip          | page          | event | photo            | category |
      | 2026-09-29T08:00:00.000Z | 203.0.113.1 | /             | view  |                  |          |
      | 2026-09-30T08:00:00.000Z | 203.0.113.2 | /about/       | view  |                  |          |
      | 2026-10-01T09:00:00.000Z | 203.0.113.7 | /             | view  |                  |          |
      | 2026-10-01T09:00:05.000Z | 203.0.113.7 | /work/nature/ | photo | ba380c579ee5e5ca | nature   |
    When I call the access route "/access" with the admin token
    Then the access response should be 200, listing the days "2026-10-01T00:00:00.000Z, 2026-09-30T00:00:00.000Z, 2026-09-29T00:00:00.000Z"

  Scenario: One day's entries are served as they were recorded
    Given a results API with the admin token "correct-admin-token-123" over an access log holding:
      | time                     | ip          | page          | event | photo            | category |
      | 2026-10-01T09:00:00.000Z | 203.0.113.7 | /             | view  |                  |          |
      | 2026-10-01T09:00:05.000Z | 203.0.113.7 | /work/nature/ | photo | ba380c579ee5e5ca | nature   |
    When I call the access route "/access/2026-10-01T00:00:00.000Z" with the admin token
    Then the access response should be 200, for the day "2026-10-01T00:00:00.000Z" with 2 entries, the second a "photo" of "ba380c579ee5e5ca"

  Scenario Outline: The access routes refuse what they can't serve
    Given a results API with the admin token "correct-admin-token-123" over an access log holding:
      | time                     | ip          | page | event | photo | category |
      | 2026-10-01T09:00:00.000Z | 203.0.113.7 | /    | view  |       |          |
    When I call the access route "<route>" with <token>
    Then the access response should be <status> with the error "<error>"

    Examples:
      | route                                 | token                     | status | error        |
      | /access                               | no token                  | 401    | unauthorized |
      | /access/2026-10-01T00:00:00.000Z      | the token "wrong-token-1234567" | 401 | unauthorized |
      | /access/2026-10-01                    | the admin token           | 400    | bad-request  |
      | /access/2026-13-45T00:00:00.000Z      | the admin token           | 400    | bad-request  |
      | /access/2026-10-01T12:00:00.000Z      | the admin token           | 400    | bad-request  |
      | /access/2026-09-01T00:00:00.000Z      | the admin token           | 404    | not-found    |
      | /access/2026-10-01T00:00:00.000Z/more | the admin token           | 400    | bad-request  |

  Scenario: Without the bucket bound, the API says so
    Given a results API with the admin token "correct-admin-token-123" and no access log bucket
    When I call the access route "/access" with the admin token
    Then the access response should be 500 with the error "misconfigured"

  # --- What the tab shows (src/lib/access-view.ts) ---------------------------------------------------------------------

  Scenario: A day adds up to its visits, photos opened, different addresses, and top pages and photos
    Given a day with these entries:
      | time                     | ip          | page          | event | photo            | category |
      | 2026-10-01T09:00:00.000Z | 203.0.113.7 | /             | view  |                  |          |
      | 2026-10-01T09:01:00.000Z | 203.0.113.7 | /work/nature/ | view  |                  |          |
      | 2026-10-01T09:01:05.000Z | 203.0.113.7 | /work/nature/ | photo | ba380c579ee5e5ca | nature   |
      | 2026-10-01T09:01:09.000Z | 203.0.113.7 | /work/nature/ | photo | 4b3761b8ee641a7d | nature   |
      | 2026-10-01T10:00:00.000Z | 2001:db8::1 | /work/nature/ | view  |                  |          |
      | 2026-10-01T10:00:03.000Z | 2001:db8::1 | /work/nature/ | photo | ba380c579ee5e5ca | nature   |
      | 2026-10-01T11:00:00.000Z | 198.51.100.4 | /es/         | view  |                  |          |
    Then the day should add up to 4 visits, 3 photos opened and 3 different addresses
    And its most visited pages should be "/work/nature/ 2, / 1, /es/ 1"
    And its most opened photos should be "ba380c579ee5e5ca 2, 4b3761b8ee641a7d 1"

  Scenario Outline: A pie names the first five groups and folds the rest into one sixth "Other" slice
    # Five colors and the gray of "Other" are what passed the color checks as a ring, so a sixth group is "Other" too.
    Then a pie of "<ranking>" should have the slices "<slices>"

    Examples:
      | ranking                                    | slices                                                            |
      | /a 6, /b 2, /c 1, /d 1                     | /a 6 60%, /b 2 20%, /c 1 10%, /d 1 10%                            |
      | /a 5, /b 2, /c 1, /d 1, /e 1               | /a 5 50%, /b 2 20%, /c 1 10%, /d 1 10%, /e 1 10%                  |
      | /a 4, /b 1, /c 1, /d 1, /e 1, /f 2         | /a 4 40%, /b 1 10%, /c 1 10%, /d 1 10%, /e 1 10%, Other(1) 2 20%  |
      | /a 3, /b 1, /c 1, /d 1, /e 1, /f 1, /g 2   | /a 3 30%, /b 1 10%, /c 1 10%, /d 1 10%, /e 1 10%, Other(2) 3 30%  |
      | /a 3, /b 1                                 | /a 3 75%, /b 1 25%                                                |
      | /a 3                                       |                                                                   |

  # --- Where the visitor is (geo) ----------------------------------------------------------------------------------------

  Scenario Outline: Cloudflare's codes for a visitor's place become names
    Then Cloudflare's place <cf> should be recorded as <geo>

    Examples:
      | cf                                                                                         | geo                                                                                                   |
      | {"city":"Lelystad","country":"NL","continent":"EU","timezone":"Europe/Amsterdam"}          | {"city":"Lelystad","country":"Netherlands","continent":"Europe","timezone":"Europe/Amsterdam"}        |
      | {"city":"Ecatepec de Morelos","country":"MX","continent":"NA","timezone":"America/Mexico_City"} | {"city":"Ecatepec de Morelos","country":"Mexico","continent":"North America","timezone":"America/Mexico_City"} |
      | {"country":"JP","continent":"AS"}                                                          | {"country":"Japan","continent":"Asia"}                                                                |
      | {"country":"T1","continent":"EU","timezone":"not a zone"}                                  | {"continent":"Europe"}                                                                                |
      | {"country":"XX"}                                                                           | nothing                                                                                               |
      | {}                                                                                         | nothing                                                                                               |

  Scenario: A page can't send its own place: a report with "geo" is refused
    Then the report {"page":"/","event":"view","geo":{"city":"Anywhere"}} should be refused

  Scenario: An ipinfo.io answer becomes the same names, with the continent from the country
    Then ipinfo.io's answer {"ip":"203.0.113.9","city":"Lelystad","country":"NL","timezone":"Europe/Amsterdam"} should give {"city":"Lelystad","country":"Netherlands","continent":"Europe","timezone":"Europe/Amsterdam"}
    And ipinfo.io's answer {"ip":"10.0.0.1","bogon":true} should give nothing
    And every country should have a continent for the backfill

  Scenario: The backfill places each address once, leaves what already has a place, and skips private addresses
    Given an access log holding:
      | time                     | ip          | page          | event | photo | category | geo      |
      | 2026-09-30T08:00:00.000Z | 203.0.113.7 | /             | view  |       |          |          |
      | 2026-10-01T09:00:00.000Z | 203.0.113.7 | /about/       | view  |       |          |          |
      | 2026-10-01T09:05:00.000Z | 2001:db8::1 | /es/          | view  |       |          | Lelystad |
      | 2026-10-01T09:06:00.000Z | 127.0.0.1   | /admin/       | view  |       |          |          |
    And a lookup service that places "203.0.113.7" in "Portland", "US", "America/Los_Angeles"
    When the access log is backfilled
    Then the lookup service should have been asked once, for "203.0.113.7"
    And every entry from "203.0.113.7" should be in Portland, United States, North America, America/Los_Angeles
    And the entry from "2001:db8::1" should still be in "Lelystad"
    And the entry from "127.0.0.1" should have no place
    And the backfill should report 2 days written, 2 given a place and 1 unplaced

  Scenario: A dry run looks up but writes nothing
    Given an access log holding:
      | time                     | ip          | page | event | photo | category | geo |
      | 2026-10-01T09:00:00.000Z | 203.0.113.7 | /    | view  |       |          |     |
    And a lookup service that places "203.0.113.7" in "Portland", "US", "America/Los_Angeles"
    When the access log is backfilled as a dry run
    Then the entry from "203.0.113.7" should have no place

  Scenario: A visit recorded while the backfill runs is kept, and placed too
    Given an access log holding:
      | time                     | ip          | page | event | photo | category | geo |
      | 2026-10-01T09:00:00.000Z | 203.0.113.7 | /    | view  |       |          |     |
    And a lookup service that places "203.0.113.7" in "Portland", "US", "America/Los_Angeles"
    And a lookup service that places "192.0.2.99" in "Lelystad", "NL", "Europe/Amsterdam"
    And the next 1 writes lose the race to another visit
    When the access log is backfilled
    Then the file of "2026-10-01T00:00:00.000Z" should hold 2 entries, every one with a place

  # --- The world map ------------------------------------------------------------------------------------------------------

  Scenario: A day adds up by country, and visits without a country are counted apart
    Given a day with these entries, by country:
      | time                     | ip          | page | event | photo            | category | country       |
      | 2026-10-01T09:00:00.000Z | 203.0.113.7 | /    | view  |                  |          | United States |
      | 2026-10-01T09:01:00.000Z | 203.0.113.7 | /    | photo | 4b3761b8ee641a7d | nature   | United States |
      | 2026-10-01T10:00:00.000Z | 2001:db8::1 | /es/ | view  |                  |          | Mexico        |
      | 2026-10-01T10:00:09.000Z | 2001:db8::1 | /es/ | view  |                  |          | Mexico        |
      | 2026-10-01T11:00:00.000Z | 192.0.2.4   | /    | view  |                  |          | Belgium       |
      | 2026-10-01T12:00:00.000Z | 192.0.2.9   | /    | view  |                  |          |               |
    Then by country the day should be "Mexico 2+0, United States 1+1, Belgium 1+0", with 1 unplaced

  Scenario Outline: The map's color bands grow geometrically up to the busiest country, never empty or repeated
    Then the bands for a busiest country of <max> should be "<bands>"

    Examples:
      | max  | bands                                |
      | 0    |                                      |
      | 1    | 1                                    |
      | 4    | 1, 2, 3, 4                           |
      | 30   | 1–2, 3–4, 5–8, 9–15, 16–30           |
      | 1000 | 1–4, 5–16, 17–63, 64–251, 252–1000   |

  Scenario: The map draws the world, and names its countries the way the log does
    Then the world map's data should hold at least 170 countries, each with a unique ISO code and a drawable shape
    And every country on the map should be named exactly as the access log would name it

  Scenario: Each country's cities are ranked by accesses, most first
    Given a day with these entries, by country:
      | time                     | ip          | page | event | photo            | category | country       | city     |
      | 2026-10-01T09:00:00.000Z | 203.0.113.7 | /    | view  |                  |          | United States | Portland |
      | 2026-10-01T09:01:00.000Z | 203.0.113.7 | /    | photo | 4b3761b8ee641a7d | nature   | United States | Portland |
      | 2026-10-01T09:02:00.000Z | 203.0.113.8 | /    | view  |                  |          | United States | Boston   |
      | 2026-10-01T09:03:00.000Z | 203.0.113.9 | /    | view  |                  |          | United States |          |
      | 2026-10-01T10:00:00.000Z | 2001:db8::1 | /es/ | view  |                  |          | Mexico        | Puebla   |
    Then the cities of "United States" should be "Portland 2, Boston 1"
    And the cities of "Mexico" should be "Puebla 1"

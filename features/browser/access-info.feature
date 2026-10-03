@browser
Feature: The pages report every visit and photo opened, and the Admin page's Access Info tab shows them
  As the site owner
  I want each page, including the Admin page, to report when it's opened and which photo is opened in the lightbox
  And a tab that shows those visits day by day, behind the admin token
  So that I can see who opened which page and which photo, and when

  The pages' reports to /api/access are noted as sent (the static test build has no Worker to record them; the
  recording itself is tested against the built site in site-render.feature). The tab reads the log through the real
  results API code, over a stand-in for the access log bucket holding two days.

  Background:
    Given today is "2026-10-01" in UTC
    And the results API holds the admin token "browser-test-admin-token" and these published runs:
      | time                 | commit  | offline results | browser results | smoke | artifacts |
      | 2026-09-21T10:00:00Z | ccccccc | 3 passed        |                 |       |           |
    And the access log holds:
      | time                     | ip           | page          | event | photo            | category |
      | 2026-09-30T22:15:00.000Z | 198.51.100.4 | /es/          | view  |                  |          |
      | 2026-10-01T09:00:00.000Z | 203.0.113.7  | /             | view  |                  |          |
      | 2026-10-01T09:01:00.000Z | 203.0.113.7  | /work/nature/ | view  |                  |          |
      | 2026-10-01T09:01:05.000Z | 203.0.113.7  | /work/nature/ | photo | 4b3761b8ee641a7d | nature   |
      | 2026-10-01T09:01:09.000Z | 203.0.113.7  | /work/nature/ | photo | 899aa0a81d293d01 | nature   |
      | 2026-10-01T10:00:00.000Z | 2001:db8::1  | /work/nature/ | view  |                  |          |
      | 2026-10-01T10:00:03.000Z | 2001:db8::1  | /work/nature/ | photo | 4b3761b8ee641a7d | nature   |

  # --- What the pages report -----------------------------------------------------------------------------------------

  Scenario: Every page reports its visit once, the Admin page included, with only its path
    When I open "/"
    And I open "/about/?from=newsletter"
    And I open "/es/work/nature/"
    And I open "/admin/"
    Then the pages should have reported, in order, visits to "/, /about/, /es/work/nature/, /admin/"
    And every report should have come from the site's own pages

  Scenario: Opening a photo reports it, and so does moving on to the next one
    When I open "/work/nature/"
    And I open the first photo in the lightbox
    And I press the key "ArrowRight"
    Then the pages should have reported a visit to "/work/nature/", then the first two photos of the gallery opened there

  Scenario: Switching category in the gallery reports a visit to the new category's page
    When I open "/work/nature/"
    And I switch the gallery to the category "pets"
    Then the pages should have reported, in order, visits to "/work/nature/, /work/pets/"

  # --- The Access Info tab -------------------------------------------------------------------------------------------

  Scenario: The tab asks for the admin token before showing or requesting anything
    When I open "/admin/#access-info"
    Then the Access Info tab should ask for the admin token
    And the results API should not have been asked for the access log

  Scenario: Signing in shows today: its totals, then a table of each group's title over its pie and legend
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    Then the day button should read "2026-10-01", and the calendar should mark the days "2026-10-01, 2026-09-30" as having visits
    And the Access Info tab should add up to 3 page visits, 3 photos opened and 2 different addresses
    And the table of pies should have no row of counts under the pies
    And under the most visited pages, a pie should share them out as "/work/nature/: 2 visits · 67%, /: 1 visit · 33%"
    And under the most opened photos, a pie should share them out as "Chimpanzee Portrait: 2 opens · 67%, American Buffalo: 1 open · 33%"
    And no table of the raw entries should be shown
    And the groups' table should have light gray lines

  Scenario: Under the map, a table lists each IP address with its location and visit counts, most visits first
    Given the access log holds:
      | time                     | ip          | page          | event | photo            | category | city     | country       |
      | 2026-10-01T09:00:00.000Z | 203.0.113.7 | /             | view  |                  |          | Portland | United States |
      | 2026-10-01T09:01:00.000Z | 203.0.113.7 | /work/nature/ | view  |                  |          | Portland | United States |
      | 2026-10-01T09:01:05.000Z | 203.0.113.7 | /work/nature/ | photo | 4b3761b8ee641a7d | nature   | Portland | United States |
      | 2026-10-01T10:00:00.000Z | 2001:db8::1 | /es/          | view  |                  |          |          | Mexico        |
      | 2026-10-01T11:00:00.000Z | 192.0.2.9   | /             | view  |                  |          |          |               |
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    Then the IP address table should sit under the world map, titled "Visits by IP address" over "Addresses: 3"
    And the IP address table should list, in order:
      | IP address  | Location                | Page visits | Photos opened |
      | 203.0.113.7 | Portland, United States | 2           | 1             |
      | 192.0.2.9   | Unknown                 | 1           | 0             |
      | 2001:db8::1 | Mexico                  | 1           | 0             |
    And the page should not scroll sideways

  Scenario: The tables' contents share one smaller font, and their titles keep theirs
    Given the access log holds:
      | time                     | ip          | page          | event | photo            | category | country       |
      | 2026-10-01T09:00:00.000Z | 203.0.113.7 | /             | view  |                  |          | United States |
      | 2026-10-01T09:01:05.000Z | 203.0.113.7 | /work/nature/ | photo | 4b3761b8ee641a7d | nature   | United States |
      | 2026-10-01T10:00:00.000Z | 2001:db8::1 | /es/          | view  |                  |          | Mexico        |
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    Then the IP address table's rows and column headers should be smaller than the page's text, and its title should not
    And the country list, the map's legend and the pies' legends should be the same size as the IP address table's rows
    And "Days (UTC)", the date field, the Quick range dropdown and the calendar should be the same size as the IP address table's rows

  Scenario: Hovering over a slice shows its number and its name in a tooltip, and so does focusing it with the keyboard
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    And I hover over the slice "/work/nature/" of the pages pie
    Then the pages pie's tooltip should say "2 visits · 67%" for "/work/nature/"
    When I move the pointer off the pie
    Then the pages pie's tooltip should be hidden
    When I focus the slice "American Buffalo" of the photos pie with the keyboard
    Then the photos pie's tooltip should say "1 open · 33%" for "American Buffalo"

  Scenario: On a phone the pies sit side by side, smaller, and a tap on a slice tells its numbers instead of the legend
    Given the visitor uses a phone
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    Then the two pies should sit side by side, each at most 160 px wide, inside the screen
    And the pies' legends should be hidden, with "Tap a slice to see its visits or opens." under them
    When I tap the slice "/work/nature/" of the pages pie
    Then the pages pie's tooltip should say "2 visits · 67%" for "/work/nature/"
    When I tap the slice "Chimpanzee Portrait" of the photos pie
    Then the photos pie's tooltip should say "2 opens · 67%" for "Chimpanzee Portrait"
    When I tap outside the pies
    Then no pie's tooltip should be shown
    And the page should not scroll sideways

  Scenario: On a laptop the legends stay under the pies, and no tap hint is shown
    Given the visitor uses a laptop
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    Then the pies' legends should be shown under them, with no tap hint

  Scenario: More than five pages share out as the first five by name and a sixth "Other" slice
    Given the access log also holds, on "2026-10-01", one visit each to "/about/, /contact/, /es/, /work/pets/, /work/astro/"
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    Then under the most visited pages, a pie should share them out as "/work/nature/: 2 visits · 25%, /: 1 visit · 13%, /about/: 1 visit · 13%, /contact/: 1 visit · 13%, /es/: 1 visit · 13%, Other (2): 2 visits · 25%"

  Scenario: A range of days in the calendar adds them up
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    And I choose the days from "2026-10-01" to "2026-09-30" in the Access Info tab
    Then the day button should read "2026-09-30 – 2026-10-01", and the calendar should mark the days "2026-10-01, 2026-09-30" as having visits
    And the Access Info tab should add up to 4 page visits, 3 photos opened and 3 different addresses

  Scenario: Today with no visits yet says so, and days after today can't be chosen
    Given today is "2026-10-03" in UTC
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    Then the Access Info tab should say "No visits were recorded on these days."
    And the calendar should not let me choose a day after today, "2026-10-03"

  Scenario Outline: The open calendar passes the automated accessibility audit, and doesn't scroll sideways on a phone
    Given the visitor uses a <device>
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    And I open the calendar in the Access Info tab
    Then the page should pass the automated accessibility audit
    And the page should not scroll sideways

    Examples:
      | device |
      | laptop |
      | phone  |

  Scenario: The Quick range dropdown chooses its days in one step
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    And I choose the ready-made range "Current Week" in the Access Info tab
    Then the day button should read "2026-09-28 – 2026-10-01", and the calendar should mark the days "2026-10-01, 2026-09-30" as having visits
    And the Access Info tab should add up to 4 page visits, 3 photos opened and 3 different addresses
    When I choose the ready-made range "Last Week" in the Access Info tab
    Then the Access Info tab should say "No visits were recorded on these days."
    And the Quick range dropdown should offer "Today, Last Week, Current Week, Last Month, Current Month, Current Year"

  Scenario: More than 50 addresses or countries are shown 50 at a time, with arrows for the rest
    Given the access log also holds, on "2026-10-01", a visit from each of 120 addresses in 60 countries
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    Then the IP address table should show 50 rows and say "1–50 of 122"
    When I press the next arrow of the IP address table
    Then the IP address table should show 50 rows and say "51–100 of 122"
    When I press the next arrow of the IP address table
    Then the IP address table should show 22 rows and say "101–122 of 122", with no next arrow
    When I press the previous arrow of the IP address table
    Then the IP address table should show 50 rows and say "51–100 of 122"
    And the map's list of countries should show 50 countries and say "1–50 of 60"
    And the page should not scroll sideways

  Scenario: On a laptop the calendar is a compact popover under its button
    Given the visitor uses a laptop
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    And I open the calendar in the Access Info tab
    Then the calendar should open under its button, at most 270 px wide and 330 px tall

  Scenario: On a phone the calendar is a bottom sheet across the screen, with 44 px touch targets
    Given the visitor uses a phone
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    And I open the calendar in the Access Info tab
    Then the calendar should sit at the bottom of the screen, across its whole width, inside the screen
    And every day, arrow and button in the calendar should be at least 44 px tall
    And the date field and the Quick range dropdown should be at least 44 px tall
    And the date field and the dropdowns should be 16 px, so iOS doesn't zoom the page when one is tapped
    When I tap "Close" in the calendar
    Then the calendar should be closed

  Scenario: A tap outside the calendar closes it
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    And I open the calendar in the Access Info tab
    And I click outside the calendar
    Then the calendar should be closed

  Scenario: A day with a single page and no photos shows its list but no pie
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    And I choose the day "2026-09-30" in the Access Info tab
    Then the Access Info tab should add up to 1 page visits, 0 photos opened and 1 different addresses
    And no pie should be shown
    And the Access Info tab should say "/es/: 1 visit · 100%"
    And the Access Info tab should say "No photos were opened on this day."

  Scenario: The tab works in Spanish
    When I open "/es/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    Then the Access Info tab should say "Visitas a páginas"
    And under the most visited pages, a pie should share them out as "/work/nature/: 2 visitas · 67 %, /: 1 visita · 33 %"

  Scenario: With no visits recorded yet, the tab says so
    Given the access log holds nothing
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    Then the Access Info tab should say "No visits have been recorded yet."

  Scenario Outline: The tab passes the automated accessibility audit, and doesn't scroll sideways on a phone
    Given the visitor uses a <device>
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    Then the day button should read "2026-10-01", and the calendar should mark the days "2026-10-01, 2026-09-30" as having visits
    And the page should pass the automated accessibility audit
    And the page should not scroll sideways

    Examples:
      | device |
      | laptop |
      | phone  |

  Scenario: Using the tab causes no script errors and no policy violations
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    And I choose the day "2026-09-30" in the Access Info tab
    Then no script error should have been logged
    And no Content-Security-Policy violation should have been reported
    And nothing but the site and the results API should have been requested

  # --- The world map -----------------------------------------------------------------------------------------------------

  Scenario: Under the pies, a world map shades each country by its visits, with a legend and a list
    Given the access log holds:
      | time                     | ip          | page          | event | photo            | category | country       |
      | 2026-10-01T09:00:00.000Z | 203.0.113.7 | /             | view  |                  |          | United States |
      | 2026-10-01T09:01:00.000Z | 203.0.113.7 | /work/nature/ | view  |                  |          | United States |
      | 2026-10-01T09:01:05.000Z | 203.0.113.7 | /work/nature/ | photo | 4b3761b8ee641a7d | nature   | United States |
      | 2026-10-01T09:02:00.000Z | 203.0.113.7 | /about/       | view  |                  |          | United States |
      | 2026-10-01T10:00:00.000Z | 2001:db8::1 | /es/          | view  |                  |          | Mexico        |
      | 2026-10-01T10:00:09.000Z | 2001:db8::1 | /es/about/    | view  |                  |          | Mexico        |
      | 2026-10-01T11:00:00.000Z | 192.0.2.4   | /work/nature/ | photo | 899aa0a81d293d01 | nature   | Netherlands   |
      | 2026-10-01T12:00:00.000Z | 192.0.2.9   | /             | view  |                  |          |               |
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    Then the world map should sit under the pies
    And the world map should be in a table with light gray lines, titled "Visits by country" over "Countries: 3"
    And the world map should draw every country, shading only "United States, Mexico, Netherlands"
    And on the world map, "United States" should be in band 4, "Mexico" in band 2 and "Netherlands" in band 1
    And the world map's legend should read "1, 2, 3, 4, 0"
    And the world map's list of countries should be flush left, under the start of its legend
    And the world map's counts should line up in one column, starting at most 24 px after the longest country name
    And the world map's list should read "United States: 3 page visits · 1 photo opened, Mexico: 2 page visits · 0 photos opened, Netherlands: 0 page visits · 1 photo opened"
    And the Access Info tab should say "1 visit could not be placed on the map."
    And that note should come under the list of countries, with a blank line before and after the list

  Scenario: Hovering over a country highlights it and shows its counts; a country without visits says so
    Given the access log holds:
      | time                     | ip          | page | event | photo | category | country       |
      | 2026-10-01T09:00:00.000Z | 203.0.113.7 | /    | view  |       |          | United States |
      | 2026-10-01T10:00:00.000Z | 2001:db8::1 | /es/ | view  |       |          | Mexico        |
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    And I hover over "United States" on the world map
    Then "United States" should be highlighted on the world map
    And the world map's tooltip should say "1 page visit · 0 photos opened" for "United States"
    When I hover over "Germany" on the world map
    Then the world map's tooltip should say "No visits" for "Germany"
    When I move the pointer off the pie
    Then the world map's tooltip should be hidden

  Scenario: The keyboard reaches the countries with visits, and focusing one shows its counts
    Given the access log holds:
      | time                     | ip          | page | event | photo | category | country |
      | 2026-10-01T10:00:00.000Z | 2001:db8::1 | /es/ | view  |       |          | Mexico  |
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    Then only "Mexico" should be in the tab order on the world map
    When I focus "Mexico" on the world map with the keyboard
    Then the world map's tooltip should say "1 page visit · 0 photos opened" for "Mexico"

  Scenario Outline: The map passes the automated accessibility audit, and doesn't scroll sideways on a phone
    Given the visitor uses a <device>
    And the access log holds:
      | time                     | ip          | page | event | photo | category | country       |
      | 2026-10-01T09:00:00.000Z | 203.0.113.7 | /    | view  |       |          | United States |
      | 2026-10-01T10:00:00.000Z | 2001:db8::1 | /es/ | view  |       |          | Mexico        |
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    Then the world map should draw every country, shading only "United States, Mexico"
    And the page should pass the automated accessibility audit
    And the page should not scroll sideways

    Examples:
      | device |
      | laptop |
      | phone  |

  Scenario: The map speaks Spanish
    Given the access log holds:
      | time                     | ip          | page | event | photo | category | country |
      | 2026-10-01T10:00:00.000Z | 2001:db8::1 | /es/ | view  |       |          | Mexico  |
    When I open "/es/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    Then the Access Info tab should say "Visitas por país"
    And the world map's list should read "Mexico: 1 visita a páginas · 0 fotos abiertas"

  Scenario: Hovering over a country in the list shows its top five cities, and focusing it does too
    Given the access log holds:
      | time                     | ip          | page | event | photo            | category | country       | city          |
      | 2026-10-01T09:00:00.000Z | 203.0.113.1 | /    | view  |                  |          | United States | Portland      |
      | 2026-10-01T09:00:01.000Z | 203.0.113.1 | /    | view  |                  |          | United States | Portland      |
      | 2026-10-01T09:00:02.000Z | 203.0.113.1 | /    | photo | 4b3761b8ee641a7d | nature   | United States | Portland      |
      | 2026-10-01T09:01:00.000Z | 203.0.113.2 | /    | view  |                  |          | United States | Seattle       |
      | 2026-10-01T09:01:01.000Z | 203.0.113.2 | /    | view  |                  |          | United States | Seattle       |
      | 2026-10-01T09:02:00.000Z | 203.0.113.3 | /    | view  |                  |          | United States | Boston        |
      | 2026-10-01T09:03:00.000Z | 203.0.113.4 | /    | view  |                  |          | United States | Austin        |
      | 2026-10-01T09:04:00.000Z | 203.0.113.5 | /    | view  |                  |          | United States | Chicago       |
      | 2026-10-01T09:05:00.000Z | 203.0.113.6 | /    | view  |                  |          | United States | New York City |
      | 2026-10-01T10:00:00.000Z | 2001:db8::1 | /es/ | view  |                  |          | Mexico        |               |
    When I open "/admin/#access-info"
    And I sign in to the Access Info tab with the token "browser-test-admin-token"
    And I hover over "United States" in the world map's list
    Then the list's tooltip should name the top cities of "United States": "Portland: 3 accesses, Seattle: 2 accesses, Austin: 1 access, Boston: 1 access, Chicago: 1 access"
    When I move the pointer off the pie
    Then the list's tooltip should be hidden
    When I focus "Mexico" in the world map's list with the keyboard
    Then the list's tooltip should say "No city was recorded for these visits." for "Mexico"

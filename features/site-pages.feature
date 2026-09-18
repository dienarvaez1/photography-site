Feature: Site pages render correctly
  As a visitor
  I want every page to build successfully and show the right content
  So that the site never silently shows an error page or the wrong data

  Scenario Outline: Every route builds a real page, not an error page
    When I load the built page "<route>"
    Then the page should not be an error page
    And the page should have a non-empty title

    Examples:
      | route              |
      | /                  |
      | /about/            |
      | /contact/          |
      | /work/astro/       |
      | /work/events/      |
      | /work/landscape/   |
      | /work/nature/      |
      | /work/pets/        |
      | /work/portrait/    |
      | /work/real-estate/ |

  Scenario: The header navigation lists only visible categories, in alphabetical order
    Given the configured categories
    When I load the built page "/"
    Then the header "Work" menu should list exactly the visible category labels in alphabetical order

  Scenario: A hidden category is not linked from the header navigation
    Given the configured categories
    When I load the built page "/"
    Then the header "Work" menu should not contain a link for any hidden category

  Scenario: The homepage category grid matches the header navigation categories
    When I load the built page "/"
    Then the homepage category grid should list the same categories as the header "Work" menu

  Scenario: A hidden category's page still builds and shows the empty-state message when it has no photos
    Given the configured categories
    When I load the built page for each hidden category with no photos
    Then each of those pages should show the "no photos yet" message

  Scenario: The contact page shows the correct state for the configured Web3Forms key
    When I load the built page "/contact/"
    Then the contact page should show the real form only if a Web3Forms access key is configured

  Scenario: Gallery tiles expose hover metadata for photos that declare camera or copyright info
    Given all photo content entries
    When I load the built page "/work/astro/"
    Then every photo on that page with camera or copyright info should show that info in its tile

  Scenario: The footer shows the current copyright year
    When I load the built page "/"
    Then the footer should show the current year

  Scenario: The homepage "Featured" section matches whether any photo is actually featured
    Given all photo content entries
    When I load the built page "/"
    Then the homepage should show a "Featured" section only if a visible photo is marked featured

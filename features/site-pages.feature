Feature: Site pages render correctly (English and Spanish)
  As a visitor, in either language
  I want every page to build successfully and show the right content
  So that the site never silently shows an error page or the wrong data

  Scenario Outline: Every route builds a real page, not an error page
    When I load the built page "<route>"
    Then the page should not be an error page
    And the page should have a non-empty title

    Examples:
      | route                 |
      | /                     |
      | /about/               |
      | /contact/             |
      | /admin/               |
      | /work/astro/          |
      | /work/events/         |
      | /work/landscape/      |
      | /work/nature/         |
      | /work/drafts/         |
      | /work/other/          |
      | /work/pets/           |
      | /work/portrait/       |
      | /work/real-estate/    |
      | /es/                  |
      | /es/about/            |
      | /es/contact/          |
      | /es/admin/            |
      | /es/work/astro/       |
      | /es/work/events/      |
      | /es/work/landscape/   |
      | /es/work/nature/      |
      | /es/work/drafts/      |
      | /es/work/other/       |
      | /es/work/pets/        |
      | /es/work/portrait/    |
      | /es/work/real-estate/ |

  Scenario: Every page the build produces is covered by the tested route list
    Then the built pages on disk should exactly match the expected routes in every locale

  Scenario: The header navigation on every page lists only visible categories, in alphabetical order
    Given the configured categories
    When I load every built page
    Then the header "Work" menu on every page should list exactly the visible category labels of its language in alphabetical order

  Scenario: A hidden category is not linked from the header navigation on any page
    Given the configured categories
    When I load every built page
    Then the header "Work" menu on every page should not contain a link for any hidden category

  Scenario: Every page has the localized header, skip link and footer
    When I load every built page
    Then every page should show its language's skip link, navigation labels and copyright footer

  Scenario Outline: The homepage category grid matches the header navigation categories
    When I load the built page "<route>"
    Then the homepage category grid should list the same categories as the header "Work" menu

    Examples:
      | route |
      | /     |
      | /es/  |

  Scenario Outline: A hidden category's page still builds and shows the empty-state message when it has no photos
    Given the configured categories
    When I load the built page for each hidden category with no photos in locale "<locale>"
    Then each of those pages should show the "no photos yet" message in its language

    Examples:
      | locale |
      | en     |
      | es     |

  Scenario Outline: The contact page shows the correct state for the configured Web3Forms key
    When I load the built page "<route>"
    Then the contact page should show the real form only if a Web3Forms access key is configured

    Examples:
      | route        |
      | /contact/    |
      | /es/contact/ |

  Scenario Outline: A category page shows every photo of its category, with its camera line on hover
    Given all photo content entries
    When I load the built page "<route>"
    Then the page should show a tile for every photo in its category
    And each tile should load its photo sizes from the public photo bucket
    And every photo on that page with a camera line should show it in its tile, and no tile should show a copyright

    Examples:
      | route                 |
      | /work/astro/          |
      | /work/events/         |
      | /work/landscape/      |
      | /work/nature/         |
      | /work/drafts/         |
      | /work/other/          |
      | /work/pets/           |
      | /work/portrait/       |
      | /work/real-estate/    |
      | /es/work/astro/       |
      | /es/work/events/      |
      | /es/work/landscape/   |
      | /es/work/nature/      |
      | /es/work/drafts/      |
      | /es/work/other/       |
      | /es/work/pets/        |
      | /es/work/portrait/    |
      | /es/work/real-estate/ |

  Scenario Outline: The homepage category cards use each category's first photo as the cover
    Given all photo content entries
    When I load the built page "<route>"
    Then each category card should use the first photo of its category as the cover

    Examples:
      | route |
      | /     |
      | /es/  |

  Scenario: The footer shows the current copyright year on every page
    When I load every built page
    Then the footer on every page should show the current year

  Scenario Outline: The homepage "Featured" section matches whether any photo is actually featured
    Given all photo content entries
    When I load the built page "<route>"
    Then the homepage should show a "Featured" section only if a visible photo is marked featured

    Examples:
      | route |
      | /     |
      | /es/  |

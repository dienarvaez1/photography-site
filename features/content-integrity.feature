Feature: Photo content integrity
  As a site maintainer
  I want every photo entry's data to be internally consistent
  So that visitors never hit a missing image, a duplicate, or stray placeholder content

  Background:
    Given all photo content entries

  Scenario: Every photo entry references its photo in R2 by a valid content id and size
    Then each entry should reference its photo in R2 by a valid content id and size
    And no entry should still point at a local image file

  Scenario: No two entries in the same category use the same photo
    Then no category should contain the same photo twice

  Scenario: Photos are stored in R2, not in the repository
    Then the repository should contain no photo files

  Scenario: Building the site needs no photo files and no network access to R2
    Then the site code should not process photos at build time
    And the photo tooling should be the only code that contacts R2

  Scenario: Every entry only uses recognized frontmatter fields
    Then each entry should only use the allowed frontmatter fields

  Scenario: Every entry declares a title
    Then each entry's title should be a non-empty string

  Scenario: Every entry's category is one of the configured categories
    And the configured category slugs
    Then each entry's category should be a configured category slug

  Scenario: No leftover placeholder content remains
    Then no entry's title should look like placeholder content

  Scenario: Every entry's order is a valid number
    Then each entry's order should be a number when present

  Scenario: Every translated title only uses configured locales and is non-empty
    And the configured locales
    Then each entry's translated titles should be non-empty and use configured locales only

  Scenario: Every entry has a title for every non-default locale
    And the configured locales
    Then each entry should have a translated title for every non-default locale

Feature: Photo content integrity
  As a site maintainer
  I want every photo entry's data to be internally consistent
  So that visitors never hit a missing image, a duplicate, or stray placeholder content

  Background:
    Given all photo content entries

  Scenario: Every photo entry's image file exists on disk
    Then each entry's declared image file should exist

  Scenario: No two entries in the same category point at the same image file
    Then no category should contain duplicate image files

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

Feature: Category configuration consistency
  As a site maintainer
  I want the category list, visibility flags, and content folders to agree with each other
  So that hiding or renaming a category never leaves the site in a half-updated state

  Scenario: Category slugs are unique
    Given the configured categories
    Then no two categories should share the same slug

  Scenario: Every category has a non-empty label and description in every locale
    Given the configured categories
    Then each category should have a non-empty label
    And each category should have a non-empty description

  Scenario: Hidden categories are excluded from the visible list
    Given the configured categories
    Then every category marked hidden should be absent from the visible categories
    And every category not marked hidden should be present in the visible categories

  Scenario: Every content folder corresponds to a configured category slug
    Given the category content folders on disk
    And the configured categories
    Then every content folder name should match a configured category slug

  Scenario: Every photo entry's category matches the folder convention
    Given all photo content entries
    Then each entry's frontmatter category should be a real, defined category

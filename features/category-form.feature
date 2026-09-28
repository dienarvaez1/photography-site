Feature: Category Maintenance writes the site's own category files
  As the site owner using the Admin page's Category Maintenance tab
  I want Add, Edit and Remove to write straight to src/config/categories.json and each locale's text
  So that a category added, renamed, hidden or removed from the page is exactly as good as hand-editing those files

  These scenarios call the tab's real request handler (scripts/lib/category-form.mjs) with a temporary copy of
  the configuration files and a temporary folder for the entries mirror, the way the dev server does — never the
  actual project files. The tab's own screens are in browser/category-maintenance.feature.

  Background:
    Given an empty category configuration

  # --- Listing ---------------------------------------------------------------------------------------------------

  Scenario: The list shows both locales' text and how many photos are in each category
    Given the category "nature" already has a photo in the library
    When I ask the category service for the current list
    Then the category service should answer with status 200
    And the category list should include "nature" labelled "Nature" in English and "Naturaleza" in Spanish
    And the category "nature" should show 1 photos
    And the category "drafts" should show 0 photos

  # --- Adding -----------------------------------------------------------------------------------------------------

  Scenario: Adding a category writes it to the configuration and both locale files
    When I add the category "night-sky"
    Then the category service should answer with status 200
    And the category configuration files on disk should list "night-sky"

  Scenario: Adding a category that already exists is refused
    When I add the category "nature"
    Then the category service should answer with status 409
    And the category service should report the error "duplicate"

  Scenario Outline: Adding a category needs every field
    When I add a category with no "<field>"
    Then the category service should answer with status 400

    Examples:
      | field       |
      | slug        |
      | label       |
      | labelEs     |
      | description |

  Scenario Outline: A category's slug must be lowercase letters, digits and single hyphens
    When I add a category with the slug "<slug>"
    Then the category service should answer with status 400

    Examples:
      | slug        |
      | Night Sky   |
      | night_sky   |
      | -night-sky  |
      | 1night      |

  # --- Editing: hide/show and rename ------------------------------------------------------------------------------

  Scenario: Hiding and showing a category again
    When I hide the category "nature"
    Then the category service should answer with status 200
    And the category "nature" should be hidden
    When I show the category "nature"
    Then the category "nature" should not be hidden

  Scenario: Renaming a category in one language leaves the other untouched
    When I rename the category "nature" to "Wildlife" in English only
    Then the category service should answer with status 200
    And the English name of "nature" on disk should still be "Wildlife"
    And the Spanish name of "nature" on disk should still be "Naturaleza"

  Scenario: Editing a category that does not exist is refused
    When I edit the category "no-such-category"
    Then the category service should answer with status 404
    And the category service should report the error "not-found"

  # --- Editing: changing the slug --------------------------------------------------------------------------------

  Scenario: Changing a category's slug moves its photos and its text in both locales
    Given the category "nature" already has a photo in the library
    When I change the slug of the category "nature" to "wildlife"
    Then the category service should answer with status 200
    And the category configuration files on disk should list "wildlife"
    And the category configuration files on disk should not mention "nature"
    When I ask the category service for the current list
    Then the category list should include "wildlife" labelled "Nature" in English and "Naturaleza" in Spanish
    And the category list should not include "nature"
    And the category "wildlife" should show 1 photos

  Scenario: Changing a category's slug and its label together applies both to the new slug
    When I change the slug and English label of the category "nature" to "wildlife" and "Wildlife"
    Then the category service should answer with status 200
    When I ask the category service for the current list
    Then the category list should include "wildlife" labelled "Wildlife" in English and "Naturaleza" in Spanish

  Scenario: Changing a category's slug to one that already exists is refused
    When I change the slug of the category "nature" to "drafts"
    Then the category service should answer with status 409
    And the category service should report the error "duplicate"

  Scenario Outline: A category's new slug must be lowercase letters, digits and single hyphens
    When I change the slug of the category "nature" to "<slug>"
    Then the category service should answer with status 400

    Examples:
      | slug       |
      | Night Sky  |
      | night_sky  |
      | -night-sky |
      | 1night     |

  # --- Editing: descriptions --------------------------------------------------------------------------------------

  Scenario: Editing a category's descriptions in both languages
    When I set the description of the category "nature" to "Wild places." in English and "Lugares silvestres." in Spanish
    Then the category service should answer with status 200
    And the English description of "nature" on disk should be "Wild places."
    And the Spanish description of "nature" on disk should be "Lugares silvestres."

  # --- Removing -------------------------------------------------------------------------------------------------

  Scenario: Removing a category with no photos removes it everywhere
    When I remove the category "drafts"
    Then the category service should answer with status 200
    And the category configuration files on disk should not mention "drafts"

  Scenario: A category still holding photos cannot be removed
    Given the category "nature" already has a photo in the library
    When I remove the category "nature"
    Then the category service should answer with status 409
    And the category service should report the error "in-use"
    And nothing about "nature" should have changed on disk

  # --- Only the owner's own page ----------------------------------------------------------------------------------

  Scenario: A request from another site's page is refused
    When I ask to remove the category "drafts" from another site
    Then the category service should answer with status 403
    And the category service should report the error "not-local"
    And nothing about "drafts" should have changed on disk

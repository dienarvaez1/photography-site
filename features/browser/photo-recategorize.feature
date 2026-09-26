@browser
Feature: The Admin page's Edit Photos button moves the photos ticked in the Pics Viewer to a new category, and only those
  As the site owner
  I want to tick one or several photos in the Pics Viewer and move them to a different category at once
  So that I can reorganize the site without a command line, and never move a photo I did not choose

  The Pics Viewer reads the real results API code over a fake originals bucket; the moving is done by the real
  local photo service (as `astro dev` runs it) over the SAME fake buckets, so what the page lists after a change is
  what really moved. Nothing leaves the machine. Edit Photos and Remove Photos are mutually exclusive: choosing
  one while the other is showing switches to it directly (features/browser/photo-remove.feature covers removal).

  Background:
    Given the results API holds the admin token "browser-test-admin-token" and these published runs:
      | time                 | commit  | offline results | browser results | smoke | artifacts |
      | 2026-09-21T10:00:00Z | ccccccc | 3 passed        |                 |       |           |
    And an empty photo library and a fake R2
    And the buckets hold these photos, shared by the Pics Viewer and the photo service:
      | photo id         | on the site |
      | 22d56df0b2da3a99 | yes         |
      | 4c4f46c18b70c4b5 | yes         |
      | 4b3761b8ee641a7d | yes         |
      | ffffffffffffffff | no          |
    And the local photo service is running

  # --- The checkboxes and the bar ---------------------------------------------------------------------------------------------------

  Scenario: Edit Photos puts a checkbox only on photos the site actually lists, and a bar above the list
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Edit Photos" button
    Then the Pics Viewer should show a checkbox on each of its 3 listed photos, none ticked
    And the photo "ffffffffffffffff" should have no checkbox
    And the edit bar should say "0 selected"
    And the "Change category" button of the edit bar should be disabled
    And the "Edit Photos" button should be pressed
    And the results API should have been asked for the list only
    And the photo service should have been asked only: "GET status"

  Scenario: Choosing a category enables Change category; ticking more photos updates the count
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Edit Photos" button
    And I tick the photo "Half Moon"
    Then the edit bar should say "1 selected"
    And the "Change category" button of the edit bar should be disabled
    When I choose "Pets" from the edit bar's category select
    Then the "Change category" button of the edit bar should be enabled
    When I tick the photo "Orion Nebula"
    Then the edit bar should say "2 selected"

  Scenario: Selecting all ticks only the photos with a checkbox
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Edit Photos" button
    And I click the "Select all" button of the edit bar
    Then the edit bar should say "3 selected"
    And every photo with a checkbox should be ticked

  Scenario: Clicking Edit Photos while Remove Photos is showing switches to it directly
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Remove Photos" button
    And I tick the photo "Half Moon"
    And I click the "Edit Photos" button
    Then the "Remove Photos" button should not be pressed
    And the "Edit Photos" button should be pressed
    And the edit bar should say "0 selected"
    And no removal bar should be showing

  Scenario: Cancel takes the checkboxes away, forgets the ticks, and returns to the Edit Photos button
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Edit Photos" button
    And I tick the photo "Half Moon"
    And I click the "Cancel" button of the edit bar
    Then the Pics Viewer should show no checkbox to select a photo
    And keyboard focus should be on the "Edit Photos" button

  # --- Applying the change ------------------------------------------------------------------------------------------------------

  Scenario: Changing one photo's category moves it there and says so
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Edit Photos" button
    And I tick the photo "Half Moon"
    And I choose "Pets" from the edit bar's category select
    And I click the "Change category" button of the edit bar
    Then the Pics Viewer should say "1 photo moved to Pets."
    And the photo service should have been asked only: "GET status, POST recategorize"
    And the photo "Half Moon" should show the category "Pets"
    And the Pics Viewer should show no checkbox to select a photo

  Scenario: Changing several photos at once moves them all
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Edit Photos" button
    And I tick the photo "Half Moon"
    And I tick the photo "Orion Nebula"
    And I choose "Pets" from the edit bar's category select
    And I click the "Change category" button of the edit bar
    Then the Pics Viewer should say "2 photos moved to Pets."
    And the photo "Half Moon" should show the category "Pets"
    And the photo "Orion Nebula" should show the category "Pets"

  Scenario: Choosing the category a photo is already in moves nothing, and says so
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Edit Photos" button
    And I tick the photo "Half Moon"
    And I choose "Astrophotography" from the edit bar's category select
    And I click the "Change category" button of the edit bar
    Then the Pics Viewer should say "It was already there."
    And the photo "Half Moon" should show the category "Astrophotography"

  # --- Spanish, and quality --------------------------------------------------------------------------------------------------------

  Scenario: The whole category change speaks Spanish on the Spanish page
    When I open "/es/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Editar fotos" button
    Then the edit bar should say "0 seleccionadas"
    When I tick the photo "Media luna"
    And I choose "Mascotas" from the edit bar's category select
    And I click the "Cambiar categoría" button of the edit bar
    Then the Pics Viewer should say "1 foto movida a Mascotas."

  Scenario Outline: Each state of the category change passes the automated accessibility audit
    When I open "/admin/#pics-viewer"
    And I show the category change in its "<state>" state
    Then the page should pass the automated accessibility audit

    Examples:
      | state             |
      | choosing          |
      | photos ticked     |
      | category chosen   |
      | not available     |

  Scenario: Using the category change causes no script errors, no policy violations and no unexpected requests
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Edit Photos" button
    And I tick the photo "Half Moon"
    And I choose "Pets" from the edit bar's category select
    And I click the "Change category" button of the edit bar
    Then the Pics Viewer should say "1 photo moved to Pets."
    And no script error should have been logged
    And no Content-Security-Policy violation should have been reported
    And nothing but the site and the results API should have been requested

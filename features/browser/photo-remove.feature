@browser
Feature: The Admin page's Remove Photos button deletes the photos ticked in the Pics Viewer, and only those
  As the site owner
  I want to tick photos in the Pics Viewer and delete them from both R2 buckets in one go
  So that I can clear out photos without a command line, and never lose one I did not choose

  The Pics Viewer reads the real results API code over a fake originals bucket; the deleting is done by the real
  local photo service (as `astro dev` runs it) over the SAME fake buckets, so what the page lists after a removal is
  what is really left. Nothing leaves the machine.

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

  # --- The checkboxes ---------------------------------------------------------------------------------------------------------------

  Scenario: Remove Photos puts a checkbox on every photo, all unticked, and a bar above the list
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Remove Photos" button
    Then the Pics Viewer should show a checkbox on each of its 4 photos, none ticked
    And the checkbox of "Half Moon" should be named "Select Half Moon (4c4f46c18b70c4b5)"
    And the removal bar should say "0 selected"
    And the removal bar should offer "Select all", "Delete selected" (disabled) and "Cancel"
    And the "Remove Photos" button should be pressed
    And the results API should have been asked for the list only
    And the photo service should have been asked only: "GET status"

  Scenario: The checkboxes and the bar are reachable with the keyboard and large enough to tap
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Remove Photos" button
    Then keyboard focus should be on the first photo's checkbox
    And every checkbox and every button of the removal bar should be in the tab order and at least 44 pixels tall

  Scenario: Ticking photos counts them; Select all and Select none tick and clear every checkbox
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Remove Photos" button
    And I tick the photo "Half Moon"
    Then the removal bar should say "1 selected"
    And the button "Delete selected" of the removal bar should be enabled
    When I tick the photo "ffffffffffffffff"
    Then the removal bar should say "2 selected"
    When I click the "Select all" button
    Then the removal bar should say "4 selected"
    And every photo should be ticked
    And the removal bar should offer "Select none", "Delete selected" and "Cancel"
    When I click the "Select none" button
    Then the removal bar should say "0 selected"
    And no photo should be ticked
    And the button "Delete selected" of the removal bar should be disabled

  Scenario: Cancel takes the checkboxes away, forgets the ticks, and returns to the Remove Photos button
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Remove Photos" button
    And I tick the photo "Half Moon"
    And I click the "Cancel" button
    Then the Pics Viewer should show no checkbox to select a photo
    And keyboard focus should be on the "Remove Photos" button
    When I click the "Remove Photos" button
    Then the removal bar should say "0 selected"

  Scenario: Pressing Remove Photos again puts the checkboxes away
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Remove Photos" button
    And I click the "Remove Photos" button
    Then the Pics Viewer should show no checkbox to select a photo

  Scenario: Signing out puts the checkboxes away
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Remove Photos" button
    And I tick the photo "Half Moon"
    And I click "Sign out" at the top of the page
    Then the Pics Viewer should ask for the admin token
    And the Pics Viewer should show no checkbox to select a photo

  # --- Confirming: nothing is deleted until the person says so ------------------------------------------------------------------

  Scenario: Delete selected asks first, naming every photo, with the safe answer under the keyboard
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Remove Photos" button
    And I tick the photo "Half Moon"
    And I tick the photo "ffffffffffffffff"
    And I click the "Delete selected" button
    Then the removal bar should ask: "Permanently delete these 2 photos from R2?"
    And the confirmation should name exactly: "Half Moon (4c4f46c18b70c4b5), not on the site (ffffffffffffffff)"
    And the removal bar should offer "Yes, delete 2 photos" and "Keep them"
    And keyboard focus should be on the "Keep them" button
    And nothing should have been deleted from R2

  Scenario Outline: Keep them, and Escape, go back to the choice with the ticks as they were, and delete nothing
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Remove Photos" button
    And I tick the photo "Half Moon"
    And I click the "Delete selected" button
    And I <way> back out of the confirmation
    Then the removal bar should say "1 selected"
    And the photo "Half Moon" should be ticked
    And nothing should have been deleted from R2
    And the photo service should have been asked only: "GET status"

    Examples:
      | way   |
      | click |
      | press |

  Scenario: One photo is confirmed in the singular
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Remove Photos" button
    And I tick the photo "Half Moon"
    And I click the "Delete selected" button
    Then the removal bar should ask: "Permanently delete this photo from R2?"
    And the removal bar should offer "Yes, delete this photo" and "Keep them"

  # --- Deleting ---------------------------------------------------------------------------------------------------------------------

  Scenario: Confirming deletes the ticked photos from both buckets and the site, and leaves every other photo alone
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Remove Photos" button
    And I tick the photo "Half Moon"
    And I tick the photo "Chimpanzee Portrait"
    And I click the "Delete selected" button
    And I click the "Yes, delete 2 photos" button
    Then the Pics Viewer should say "2 photos deleted."
    And the photo service should have been asked only: "GET status, POST remove"
    And nothing of the photo ids "4c4f46c18b70c4b5, 4b3761b8ee641a7d" should be left in R2
    And the photo ids "22d56df0b2da3a99, ffffffffffffffff" should be completely untouched in R2
    And the manifest in R2 should list exactly: "astro/orion-nebula"
    And the Pics Viewer should list 2 original photos in this order: "Orion Nebula, ffffffffffffffff"
    And the Pics Viewer should show no checkbox to select a photo
    And the results API should have asked for the list again

  Scenario: A photo the site does not list can be deleted too, and the manifest is not touched
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Remove Photos" button
    And I tick the photo "ffffffffffffffff"
    And I click the "Delete selected" button
    And I click the "Yes, delete this photo" button
    Then the Pics Viewer should say "1 photo deleted."
    And nothing of the photo ids "ffffffffffffffff" should be left in R2
    And the photo ids "22d56df0b2da3a99, 4c4f46c18b70c4b5, 4b3761b8ee641a7d" should be completely untouched in R2
    And the manifest in R2 should list exactly: "astro/orion-nebula, astro/half-moon, nature/chimpanzee-portrait"

  Scenario: Every photo can be deleted at once
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Remove Photos" button
    And I click the "Select all" button
    And I click the "Delete selected" button
    And I click the "Yes, delete 4 photos" button
    Then the Pics Viewer should say "4 photos deleted."
    And the Pics Viewer should say "0 original photos"
    And the manifest in R2 should list exactly: ""

  Scenario: A photo that cannot be deleted is named, the others are deleted, and the list shows what is left
    Given R2 will fail to delete the files of the photo id "4b3761b8ee641a7d"
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Remove Photos" button
    And I tick the photo "Half Moon"
    And I tick the photo "Chimpanzee Portrait"
    And I click the "Delete selected" button
    And I click the "Yes, delete 2 photos" button
    Then the Pics Viewer should say "1 photo deleted."
    And the Pics Viewer should say "Could not delete Chimpanzee Portrait (4b3761b8ee641a7d): simulated delete failure"
    And nothing of the photo ids "4c4f46c18b70c4b5" should be left in R2
    And the Pics Viewer should list 3 original photos in this order: "Orion Nebula, Chimpanzee Portrait, ffffffffffffffff"

  # --- A long list is drawn 20 at a time: "select all" never reaches photos that are not shown -----------------------------------

  Scenario: Select all ticks only the photos shown, says so, and never the ones not yet drawn
    Given the buckets also hold 41 more photos the site does not list
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Remove Photos" button
    Then the removal bar should offer "Select the 20 shown", "Delete selected" (disabled) and "Cancel"
    When I click the "Select the 20 shown" button
    Then the removal bar should say "20 selected"
    And the removal bar should offer "Select none", "Delete selected" and "Cancel"
    When I scroll to the end of the list
    Then the Pics Viewer should draw 40 of its photos
    And the removal bar should say "20 selected"
    And the removal bar should offer "Select the 40 shown", "Delete selected" and "Cancel"
    And 20 photos should be ticked

  Scenario: Once every photo has been drawn, Select all ticks all of them
    Given the buckets also hold 41 more photos the site does not list
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Remove Photos" button
    And I scroll to the end of the list
    And I scroll to the end of the list
    Then the Pics Viewer should draw 45 of its photos
    And the removal bar should offer "Select all", "Delete selected" (disabled) and "Cancel"
    When I click the "Select all" button
    Then the removal bar should say "45 selected"
    And every photo should be ticked in a list of 45

  Scenario: Photos drawn by a later page arrive with their checkbox, ticked if they were chosen
    Given the buckets also hold 41 more photos the site does not list
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Remove Photos" button
    And I focus and press Enter on the "Show 20 more" button
    Then the Pics Viewer should show a checkbox on each of its 40 photos, none ticked
    When I tick the photo "0000000000000020"
    Then the removal bar should say "1 selected"

  Scenario: Deleting the 20 photos shown removes exactly those, and the list carries on from what is left
    Given the buckets also hold 41 more photos the site does not list
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Remove Photos" button
    And I click the "Select the 20 shown" button
    And I scroll to the end of the list
    And I remember the ticked photos
    And I click the "Delete selected" button
    Then the removal bar should ask: "Permanently delete these 20 photos from R2?"
    And the confirmation should name 10 photos and then say "…and 10 more"
    When I click the "Yes, delete 20 photos" button
    Then the Pics Viewer should say "20 photos deleted."
    And the remembered photos should be gone from R2, and every other photo should still be there
    And the Pics Viewer should say it is showing 20 of 25 photos
    And the Pics Viewer should say "25 original photos"

  # --- Spanish, phones and quality ---------------------------------------------------------------------------------------------------

  Scenario: The whole removal speaks Spanish on the Spanish page
    When I open "/es/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Eliminar fotos" button
    Then the removal bar should say "0 seleccionadas"
    When I tick the photo "Media luna"
    And I click the "Eliminar seleccionadas" button
    Then the removal bar should ask: "¿Eliminar de forma permanente esta foto de R2?"
    And the removal bar should offer "Sí, eliminar esta foto" and "Conservarlas"
    When I click the "Sí, eliminar esta foto" button
    Then the Pics Viewer should say "1 foto eliminada."

  Scenario Outline: Each state of the removal passes the automated accessibility audit
    When I open "/admin/#pics-viewer"
    And I show the removal in its "<state>" state
    Then the page should pass the automated accessibility audit

    Examples:
      | state             |
      | choosing          |
      | photos ticked     |
      | confirming        |
      | not available     |

  Scenario Outline: No state of the removal scrolls sideways on a phone, and its buttons stay on screen
    Given the visitor uses a phone
    When I open "/admin/#pics-viewer"
    And I show the removal in its "<state>" state
    Then the page should not scroll sideways
    And every button and checkbox of the removal should be entirely inside the screen

    Examples:
      | state             |
      | choosing          |
      | photos ticked     |
      | confirming        |

  Scenario: Using the removal causes no script errors, no policy violations and no unexpected requests
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Remove Photos" button
    And I tick the photo "Half Moon"
    And I click the "Delete selected" button
    And I click the "Yes, delete this photo" button
    Then the Pics Viewer should say "1 photo deleted."
    And no script error should have been logged
    And no Content-Security-Policy violation should have been reported
    And nothing but the site and the results API should have been requested

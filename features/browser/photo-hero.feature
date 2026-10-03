@browser
Feature: The Admin page's Home Background button switches photos in or out of the home page's hero background, saved at once
  As the site owner
  I want an on/off switch on each photo in the Pics Viewer, showing whether the home page's monochrome hero
  background uses it, and one button to save whatever I switched
  So that I can pick the home page's background from any category, without touching a command line

  The Pics Viewer reads the real results API code over a fake originals bucket; the change is done by the real
  local photo service (as `astro dev` runs it) over the SAME fake buckets, so what the page shows after a
  change is what really happened. Nothing leaves the machine. Upload Photos, Edit Photos, Remove Photos and
  Home Background are mutually exclusive: choosing one while another is showing switches to it directly
  (features/browser/photo-recategorize.feature and photo-remove.feature cover the other two).

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

  # --- The switches and the bar -----------------------------------------------------------------------------------------------------

  Scenario: Home Background puts an on/off switch only on photos the site actually lists, and a bar above the list
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    Then the Pics Viewer should show an on/off switch on each of its 3 listed photos, all off
    And the photo "ffffffffffffffff" should have no switch
    And the home background bar should say "Switch a photo on to show it in the home background, or off to take it out."
    And the home background bar should offer only the buttons "Save changes, Cancel"
    And the "Save changes" button of the home background bar should be disabled
    And the "Home Background" button should be pressed
    And the edit mode should be shown in red, with the "Home Background" button marked red
    And the results API should have been asked only for the list and each shown file's details
    And the photo service should have been asked only: "GET status"

  Scenario: Each switch is a real switch, easy to tap, and says which photo it is for
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    Then each switch should be announced as a switch named "In the home background: <the photo>", at least 44 pixels to tap

  Scenario: Flipping switches counts the unsaved changes, and flipping one back undoes it
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    And I switch the photo "Half Moon" on
    Then the home background bar should say "1 change to save"
    And the "Save changes" button of the home background bar should be enabled
    And the row for "Half Moon" should show an unsaved change
    And the edit mode should be shown in red
    When I switch the photo "Orion Nebula" on
    Then the home background bar should say "2 changes to save"
    When I switch the photo "Orion Nebula" off
    Then the home background bar should say "1 change to save"
    And the row for "Orion Nebula" should show no unsaved change

  Scenario: Clicking Home Background while Edit Photos is showing switches to it directly
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Edit Photos" button
    And I tick the photo "Half Moon"
    And I click the "Home Background" button
    Then the "Edit Photos" button should not be pressed
    And the "Home Background" button should be pressed
    And the switch for "Half Moon" should be off

  Scenario: Cancel takes the switches away, forgets what was flipped, and returns to the Home Background button
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    And I switch the photo "Half Moon" on
    And I click the "Cancel" button of the home background bar
    Then the Pics Viewer should show no switch
    And the photo "Half Moon" should not be marked Home background
    And keyboard focus should be on the "Home Background" button

  # --- Saving -----------------------------------------------------------------------------------------------------------------------

  Scenario: Switching one photo on and saving marks it, and says so
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    And I switch the photo "Half Moon" on
    And I click the "Save changes" button of the home background bar
    Then the Pics Viewer should say "1 photo set as the home background."
    And the photo service should have been asked only: "GET status, POST hero-background"
    And the photo "Half Moon" should be marked Home background
    And the row for "Half Moon" should read, top to bottom: its title, the Home background badge, its category, its path
    And the Pics Viewer should show no switch

  Scenario: Switching several photos on saves them all at once
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    And I switch the photo "Half Moon" on
    And I switch the photo "Orion Nebula" on
    And I click the "Save changes" button of the home background bar
    Then the Pics Viewer should say "2 photos set as the home background."
    And the photo "Half Moon" should be marked Home background
    And the photo "Orion Nebula" should be marked Home background

  Scenario: Reopening Home Background shows its current members switched on
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    And I switch the photo "Half Moon" on
    And I click the "Save changes" button of the home background bar
    And the Pics Viewer should say "1 photo set as the home background."
    And I click the "Home Background" button
    Then the switch for "Half Moon" should be on
    And the switch for "Orion Nebula" should be off
    And the home background bar should say "Switch a photo on to show it in the home background, or off to take it out."
    And the "Save changes" button of the home background bar should be disabled

  Scenario: One Save changes switches one photo in and another out together
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    And I switch the photo "Half Moon" on
    And I click the "Save changes" button of the home background bar
    And the Pics Viewer should say "1 photo set as the home background."
    And I click the "Home Background" button
    And I switch the photo "Half Moon" off
    And I switch the photo "Orion Nebula" on
    Then the home background bar should say "2 changes to save"
    When I click the "Save changes" button of the home background bar
    Then the Pics Viewer should say "1 photo set as the home background. 1 photo removed from the home background."
    And the photo "Orion Nebula" should be marked Home background
    And the photo "Half Moon" should not be marked Home background
    And the photo service should have been asked only: "GET status, POST hero-background, GET status, POST hero-background, POST hero-background"

  Scenario: On a slow connection the next change still waits for the last one to finish
    # Seen on GitHub's runners: reopening Home Background before the save had answered was ignored (a bulk action
    # refuses to start while another is under way), and the test went on to use the old, busy bar.
    Given the local photo service takes 1500 milliseconds to answer
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    And I switch the photo "Half Moon" on
    And I click the "Save changes" button of the home background bar
    And the Pics Viewer should say "1 photo set as the home background."
    And I click the "Home Background" button
    Then the switch for "Half Moon" should be on
    When I switch the photo "Half Moon" off
    And I click the "Save changes" button of the home background bar
    Then the Pics Viewer should say "1 photo removed from the home background."

  Scenario: While saving, the switches and buttons wait
    Given the local photo service takes 1500 milliseconds to answer
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    And I switch the photo "Half Moon" on
    And I click the "Save changes" button of the home background bar
    Then the home background bar should say "Saving the change…"
    And every switch and button of the home background bar should be disabled

  # --- Spanish, and quality --------------------------------------------------------------------------------------------------------

  Scenario: The whole home background change speaks Spanish on the Spanish page
    When I open "/es/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Fondo de inicio" button
    Then the home background bar should say "Activa una foto para mostrarla en el fondo de inicio, o desactívala para quitarla."
    When I switch the photo "Media luna" on
    Then the home background bar should say "1 cambio por guardar"
    When I click the "Guardar cambios" button of the home background bar
    Then the Pics Viewer should say "1 foto establecida como fondo de inicio."

  Scenario Outline: Each state of the home background change passes the automated accessibility audit

    When I open "/admin/#pics-viewer"
    And I show the home background change in its "<state>" state
    Then the page should pass the automated accessibility audit

    Examples:
      | state            |
      | choosing         |
      | photos switched  |
      | not available    |

  Scenario: Using the home background change causes no script errors, no policy violations and no unexpected requests
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    And I switch the photo "Half Moon" on
    And I click the "Save changes" button of the home background bar
    Then the Pics Viewer should say "1 photo set as the home background."
    And no script error should have been logged
    And no Content-Security-Policy violation should have been reported
    And nothing but the site and the results API should have been requested

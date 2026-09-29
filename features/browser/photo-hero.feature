@browser
Feature: The Admin page's Home Background button sets or clears the photos ticked in the Pics Viewer as the home page's hero background
  As the site owner
  I want to tick one or several photos in the Pics Viewer and choose whether the home page's monochrome hero
  background shows them
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

  # --- The checkboxes and the bar ---------------------------------------------------------------------------------------------------

  Scenario: Home Background puts a checkbox only on photos the site actually lists, and a bar above the list
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    Then the Pics Viewer should show a checkbox on each of its 3 listed photos, none ticked
    And the photo "ffffffffffffffff" should have no checkbox
    And the home background bar should say "0 selected"
    And the "Set as background" button of the home background bar should be disabled
    And the "Remove from background" button of the home background bar should be disabled
    And the "Home Background" button should be pressed
    And the results API should have been asked only for the list and each shown file's details
    And the photo service should have been asked only: "GET status"

  Scenario: Ticking a photo enables both actions; ticking more updates the count
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    And I tick the photo "Half Moon"
    Then the home background bar should say "1 selected"
    And the "Set as background" button of the home background bar should be enabled
    And the "Remove from background" button of the home background bar should be enabled
    When I tick the photo "Orion Nebula"
    Then the home background bar should say "2 selected"

  Scenario: Selecting all ticks only the photos with a checkbox
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    And I click the "Select all" button of the home background bar
    Then the home background bar should say "3 selected"
    And every photo with a checkbox should be ticked

  Scenario: Clicking Home Background while Edit Photos is showing switches to it directly
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Edit Photos" button
    And I tick the photo "Half Moon"
    And I click the "Home Background" button
    Then the "Edit Photos" button should not be pressed
    And the "Home Background" button should be pressed
    And the home background bar should say "0 selected"

  Scenario: Cancel takes the checkboxes away, forgets the ticks, and returns to the Home Background button
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    And I tick the photo "Half Moon"
    And I click the "Cancel" button of the home background bar
    Then the Pics Viewer should show no checkbox to select a photo
    And keyboard focus should be on the "Home Background" button

  # --- Setting and clearing -----------------------------------------------------------------------------------------------------

  Scenario: Setting one photo as the background marks it, and says so
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    And I tick the photo "Half Moon"
    And I click the "Set as background" button of the home background bar
    Then the Pics Viewer should say "1 photo set as the home background."
    And the photo service should have been asked only: "GET status, POST hero-background"
    And the photo "Half Moon" should be marked Home background
    And the row for "Half Moon" should read, top to bottom: its title, the Home background badge, its category, its path
    And the Pics Viewer should show no checkbox to select a photo

  Scenario: Setting several photos at once marks them all
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    And I tick the photo "Half Moon"
    And I tick the photo "Orion Nebula"
    And I click the "Set as background" button of the home background bar
    Then the Pics Viewer should say "2 photos set as the home background."
    And the photo "Half Moon" should be marked Home background
    And the photo "Orion Nebula" should be marked Home background

  Scenario: Reopening Home Background starts with its current members already ticked
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    And I tick the photo "Half Moon"
    And I click the "Set as background" button of the home background bar
    And the Pics Viewer should say "1 photo set as the home background."
    And I click the "Home Background" button
    Then the photo "Half Moon" should be ticked
    And the photo "Orion Nebula" should not be ticked
    And the home background bar should say "1 selected"

  Scenario: Setting an already-marked photo again changes nothing, and says so
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    And I tick the photo "Half Moon"
    And I click the "Set as background" button of the home background bar
    And the Pics Viewer should say "1 photo set as the home background."
    And I click the "Home Background" button
    And I tick the photo "Half Moon"
    And I click the "Set as background" button of the home background bar
    Then the Pics Viewer should say "It was already set that way."
    And the photo "Half Moon" should be marked Home background

  Scenario: On a slow connection the next action still waits for the last one to finish
    # Seen on GitHub's runners: reopening Home Background before "Set as background" had answered was ignored (a bulk
    # action refuses to start while another is under way), and the test went on to click the old, busy bar.
    Given the local photo service takes 1500 milliseconds to answer
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    And I tick the photo "Half Moon"
    And I click the "Set as background" button of the home background bar
    And the Pics Viewer should say "1 photo set as the home background."
    And I click the "Home Background" button
    Then the photo "Half Moon" should be ticked
    When I click the "Set as background" button of the home background bar
    Then the Pics Viewer should say "It was already set that way."

  Scenario: Removing a marked photo from the background clears its mark, and says so
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    And I tick the photo "Half Moon"
    And I click the "Set as background" button of the home background bar
    And the Pics Viewer should say "1 photo set as the home background."
    And I click the "Home Background" button
    And I tick the photo "Half Moon"
    And I click the "Remove from background" button of the home background bar
    Then the Pics Viewer should say "1 photo removed from the home background."
    And the photo "Half Moon" should not be marked Home background

  # --- Spanish, and quality --------------------------------------------------------------------------------------------------------

  Scenario: The whole home background change speaks Spanish on the Spanish page
    When I open "/es/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Fondo de inicio" button
    Then the home background bar should say "0 seleccionadas"
    When I tick the photo "Media luna"
    And I click the "Usar como fondo" button of the home background bar
    Then the Pics Viewer should say "1 foto establecida como fondo de inicio."

  Scenario Outline: Each state of the home background change passes the automated accessibility audit

    When I open "/admin/#pics-viewer"
    And I show the home background change in its "<state>" state
    Then the page should pass the automated accessibility audit

    Examples:
      | state          |
      | choosing       |
      | photos ticked  |
      | not available  |

  Scenario: Using the home background change causes no script errors, no policy violations and no unexpected requests
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Home Background" button
    And I tick the photo "Half Moon"
    And I click the "Set as background" button of the home background bar
    Then the Pics Viewer should say "1 photo set as the home background."
    And no script error should have been logged
    And no Content-Security-Policy violation should have been reported
    And nothing but the site and the results API should have been requested

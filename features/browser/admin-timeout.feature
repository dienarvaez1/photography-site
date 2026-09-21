@browser
Feature: The Admin page signs out after 5 minutes of inactivity
  As the site owner
  I want the Admin page to forget my admin token when I have left it alone for 5 minutes
  So that an unattended screen never keeps showing (or being able to fetch) private data

  The page's clock is under the test's control here, so minutes pass at once. Touching the page (moving the
  pointer, pressing a key, scrolling, tapping) means the person is there and restarts the 5 minutes.

  Background:
    Given the page clock is under the test's control
    And the results API holds the admin token "browser-test-admin-token" and these published runs:
      | time                 | commit  | offline results | browser results | smoke | artifacts |
      | 2026-09-21T10:00:00Z | ccccccc | 3 passed        |                 |       |           |
    And the originals bucket holds these files:
      | photo id         | metadata |
      | 22d56df0b2da3a99 | full     |

  # --- The timeout ------------------------------------------------------------------------------------------------

  Scenario: Still signed in just before 5 minutes, signed out at 5 minutes
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And 4 minutes and 55 seconds pass with nobody touching the page
    Then the latest run should be shown as commit "ccccccc", Passed, with "3 of 3 passed"
    And "Refresh" then "Sign out" should sit on the same line as the "Admin" title, at the right of the page
    When 0 minutes and 10 seconds pass with nobody touching the page
    Then the Test Results tab should ask for the admin token
    And the Test Results tab should say "You were signed out after 5 minutes of inactivity. Enter the token to continue."
    And there should be no "Refresh" or "Sign out" button at the top of the page
    And the browser should not remember any token

  Scenario: Both tabs are signed out together, whichever tab is showing
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I hover over the file "Orion Nebula"
    And 5 minutes pass with nobody touching the page
    Then the Pics Viewer should ask for the admin token
    And the Pics Viewer should say "You were signed out after 5 minutes of inactivity. Enter the token to continue."
    And no tooltip should be showing
    When I click the "Test Results" tab
    Then the Test Results tab should ask for the admin token
    And the Test Results tab should say "You were signed out after 5 minutes of inactivity. Enter the token to continue."

  Scenario: Nothing is requested from the API after the timeout
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And 5 minutes pass with nobody touching the page
    Then the Test Results tab should ask for the admin token
    When I note how many requests the results API has had
    And 10 minutes pass with nobody touching the page
    Then the results API should not have been asked for anything more

  # --- Being there restarts the clock ------------------------------------------------------------------------------------

  Scenario Outline: <activity> restarts the 5 minutes
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And 4 minutes pass with nobody touching the page
    And the person <activity>
    And 4 minutes pass with nobody touching the page
    Then the latest run should be shown as commit "ccccccc", Passed, with "3 of 3 passed"
    When 1 minutes and 5 seconds pass with nobody touching the page
    Then the Test Results tab should ask for the admin token

    Examples:
      | activity                    |
      | moves the mouse             |
      | presses a key               |
      | scrolls the page            |
      | clicks on the page heading  |

  Scenario: Touching a phone screen restarts the 5 minutes
    Given the visitor uses a phone
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And 4 minutes pass with nobody touching the page
    And the person taps the page heading
    And 4 minutes pass with nobody touching the page
    Then the latest run should be shown as commit "ccccccc", Passed, with "3 of 3 passed"

  Scenario: Only the person counts, not the page's own requests
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And 4 minutes pass with nobody touching the page
    And the page reloads its results by itself
    And 1 minutes and 5 seconds pass with nobody touching the page
    Then the Test Results tab should ask for the admin token

  # --- Coming back --------------------------------------------------------------------------------------------------------------

  Scenario: A tab left for longer than 5 minutes and then reloaded is signed out
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And the browser had been away from the page for 6 minutes
    And I reload the page
    Then the Test Results tab should ask for the admin token
    And the Test Results tab should say "You were signed out after 5 minutes of inactivity. Enter the token to continue."

  Scenario: A reload within 5 minutes keeps the sign-in
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And 2 minutes pass with nobody touching the page
    And I reload the page
    Then the latest run should be shown as commit "ccccccc", Passed, with "3 of 3 passed"

  Scenario: The reminder goes away when the person signs in again, and a manual sign-out never shows it
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And 5 minutes pass with nobody touching the page
    Then the Test Results tab should say "You were signed out after 5 minutes of inactivity. Enter the token to continue."
    When I sign in with the token "browser-test-admin-token"
    Then the latest run should be shown as commit "ccccccc", Passed, with "3 of 3 passed"
    When I click "Sign out" at the top of the page
    Then the Test Results tab should ask for the admin token
    And the Test Results tab should not mention being signed out for inactivity

  Scenario: The timeout still works when the browser will not keep the sign-in
    Given the browser blocks session storage
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    Then the latest run should be shown as commit "ccccccc", Passed, with "3 of 3 passed"
    When 5 minutes pass with nobody touching the page
    Then the Test Results tab should ask for the admin token

  Scenario: The timeout is announced in Spanish on the Spanish page
    When I open "/es/admin/"
    And I sign in with the token "browser-test-admin-token"
    And 5 minutes pass with nobody touching the page
    Then the Test Results tab should ask for the token in Spanish
    And the Test Results tab should say "Se cerró tu sesión tras 5 minutos de inactividad. Introduce el token para continuar."

  Scenario: The reminder is announced to screen readers and the page stays accessible
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And 5 minutes pass with nobody touching the page
    Then the reminder should be a status message for screen readers
    And the page should pass the automated accessibility audit

  Scenario: Timing out causes no script errors, no policy violations and no unexpected requests
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And 5 minutes pass with nobody touching the page
    Then no script error should have been logged
    And no Content-Security-Policy violation should have been reported
    And nothing but the site and the results API should have been requested

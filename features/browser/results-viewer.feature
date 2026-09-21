@browser
Feature: The Admin page's Test Results tab shows the stored test runs in a real browser
  As the site owner
  I want the Test Results tab to load index.json and latest.json from the private results store and let me open any run
  So that I can see how the tests are doing, and what failed, from the Admin page

  The results API here is the real Worker code answering from a fake bucket of runs published by the real publisher.

  Background:
    Given the results API holds the admin token "browser-test-admin-token" and these published runs:
      | time                 | commit  | offline results    | browser results | smoke | artifacts      | failure                                        |
      | 2026-09-19T10:00:00Z | aaaaaaa | 3 passed           |                 |       |                |                                                |
      | 2026-09-20T10:00:00Z | bbbbbbb | 2 passed, 1 failed |                 |       | checkout-fails | <img src=x onerror=window.__xss=1> Expected 5  |
      | 2026-09-21T10:00:00Z | ccccccc | 3 passed           | 2 passed        | yes   |                |                                                |

  # --- Signing in ------------------------------------------------------------------------------------------------

  Scenario: Without a token the tab asks for one and asks the results API for nothing
    When I open "/admin/"
    Then the Test Results tab should ask for the admin token
    And the results API should not have been asked for anything

  Scenario: A wrong token is refused, and forgotten
    When I open "/admin/"
    And I sign in with the token "definitely-the-wrong-one"
    Then the Test Results tab should say "That token was not accepted."
    And the Test Results tab should ask for the admin token
    And the browser should not remember any token

  Scenario: The right token shows the results, starting from latest.json and index.json
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    Then the latest run should be shown as commit "ccccccc", Passed, with "7 of 7 passed"
    And the list of all runs should show the commits "ccccccc, bbbbbbb, aaaaaaa" in that order
    And the results API should have been asked only for "/latest" and "/index", each with the token in the Authorization header
    And the token should not appear in any address

  Scenario: The token is kept for the browser tab, so a reload does not ask again
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I reload the page
    Then the latest run should be shown as commit "ccccccc", Passed, with "7 of 7 passed"

  Scenario: Signing out forgets the token
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I click "Sign out" at the top of the page
    Then the Test Results tab should ask for the admin token
    And the browser should not remember any token
    When I reload the page
    Then the Test Results tab should ask for the admin token

  Scenario: The tab explains when the results service has no admin token yet
    Given the results API has no admin token set up
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    Then the Test Results tab should say "The results service has no admin token yet. Set the ADMIN_TOKEN secret on the results Worker."
    And the Test Results tab should ask for the admin token

  Scenario: A token that stops being valid sends the visitor back to sign in
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And the results API's admin token is changed to "a-completely-new-admin-token"
    And I click "Refresh" at the top of the page
    Then the Test Results tab should say "That token was not accepted."
    And the Test Results tab should ask for the admin token

  Scenario: The gate works with the keyboard alone
    When I open "/admin/"
    And I type the token "browser-test-admin-token" into the focused token field and press Enter
    Then the latest run should be shown as commit "ccccccc", Passed, with "7 of 7 passed"

  # --- Opening runs ----------------------------------------------------------------------------------------------

  Scenario Outline: Any run in the list can be opened, and the address says which
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "<commit>" from the list
    Then the address should show that run
    And the run's details should show the commit "<commit>", <status> and "<totals>"
    And the results API should have been asked for that run, with the token in the Authorization header

    Examples:
      | commit  | status | totals                                       |
      | ccccccc | Passed | 7 of 7 passed                                |
      | bbbbbbb | Failed | 2 of 3 passed, 1 failed, 0 skipped           |
      | aaaaaaa | Passed | 3 of 3 passed                                |

  Scenario: The latest run card opens the newest run too
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I open the latest run card
    Then the run's details should show the commit "ccccccc", Passed and "7 of 7 passed"

  Scenario: The browser's Back button returns from a run to the list
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "bbbbbbb" from the list
    And I go back in the browser
    Then the list of all runs should show the commits "ccccccc, bbbbbbb, aaaaaaa" in that order
    And the "Test Results" tab should be the selected one

  Scenario: The "All runs" link returns from a run to the list
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "aaaaaaa" from the list
    And I click the "← All runs" link
    Then the list of all runs should show the commits "ccccccc, bbbbbbb, aaaaaaa" in that order

  Scenario: A link to a run opens it directly, even after a reload
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "bbbbbbb" from the list
    And I reload the page
    Then the run's details should show the commit "bbbbbbb", Failed and "2 of 3 passed, 1 failed, 0 skipped"

  Scenario: A link to a run that is not there says so and offers the way back
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I open "/admin/#test-results/run/2030-01-01T00-00-00Z-nothing-local"
    Then the Test Results tab should say "That run was not found. It may have been pruned."
    And there should be an "← All runs" link

  Scenario: Clicking the Test Results tab while a run is open returns to the list
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "bbbbbbb" from the list
    And I click the "Test Results" tab
    Then the list of all runs should show the commits "ccccccc, bbbbbbb, aaaaaaa" in that order
    And the address should end with "#test-results"

  Scenario: Keyboard users can open a run with Enter
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I focus the run with commit "bbbbbbb" and press Enter
    Then the run's details should show the commit "bbbbbbb", Failed and "2 of 3 passed, 1 failed, 0 skipped"
    And keyboard focus should be on the run's heading

  # --- What a run shows --------------------------------------------------------------------------------------------

  Scenario: A run shows its suites
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "ccccccc" from the list
    Then the suites table should show these rows:
      | Suite             | Scenarios | Passed | Failed | Steps |
      | Offline           | 3         | 3      | 0      | 3     |
      | Browser           | 2         | 2      | 0      | 2     |
      | Live site (smoke) | 2         | 2      | 0      | –     |
    And the run's failures should say "No failures in this run."
    And the features of the "Offline" suite should list "site.feature" with 3 scenarios, 3 passed and 0 failed
    And the slowest scenarios of the "Browser" suite should be listed by name
    And the run should show no missing values such as "undefined", "null" or "[object Object]"

  Scenario: A failing run shows what failed, as plain text
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "bbbbbbb" from the list
    Then the features of the "Offline" suite should list "site.feature" with 3 scenarios, 2 passed and 1 failed
    And the failures should list the scenario "failed scenario 1" of the feature "site.feature" with the reason "<img src=x onerror=window.__xss=1> Expected 5"
    And nothing from the results should have been treated as page markup

  Scenario: A run's reports open in a new tab, from the results API, showing the stored report
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "ccccccc" from the list
    Then every report link should open in a new tab without giving the new page access to this one
    And every file link should lead to the results API, with no token in it
    When I click the report link "Open report (Offline)"
    Then a new tab should show the stored report "Offline report ccccccc"

  Scenario: A file link that does not lead back to the results API is never shown
    Given the results API hands out a link to another site for "offline.html"
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "ccccccc" from the list
    Then the run should show no link to another site, and no report link for that file

  Scenario: Failure evidence is shown: the screenshot, and the trace to download
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "bbbbbbb" from the list
    Then the evidence for "checkout-fails" should show its screenshot, loaded, with a description
    And the evidence for "checkout-fails" should offer the trace as a download and the log as a link

  Scenario: The stored report is reached by the run's signed link, and the link stops working after signing out
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "ccccccc" from the list
    And the results API's admin token is changed to "a-completely-new-admin-token"
    And I click the report link "Open report (Offline)"
    Then a new tab should be refused with the error "forbidden"

  # --- When things are not normal ---------------------------------------------------------------------------------------------

  Scenario: An empty results store says so
    Given the results API holds the admin token "browser-test-admin-token" and no published runs
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    Then the Test Results tab should say "No test results have been published yet. Run npm run test:record, then npm run results:publish."

  Scenario: When the results API cannot be reached the tab says so, and Refresh recovers
    Given the results API cannot be reached
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    Then the Test Results tab should say "Could not reach the results service. Check your connection and try again."
    When the results API comes back
    And I click "Refresh" at the top of the page
    Then the latest run should be shown as commit "ccccccc", Passed, with "7 of 7 passed"

  Scenario: No test results are asked for while the other tab is showing
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I open "/admin/#pics-viewer"
    And I reload the page
    Then the "Pics Viewer" tab should be the selected one
    And the results API should not have been asked for test results since the reload
    When I click the "Test Results" tab
    Then the latest run should be shown as commit "ccccccc", Passed, with "7 of 7 passed"

  Scenario: A link to a run opens the Test Results tab from another tab
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I click the "Pics Viewer" tab
    And I open the address "/admin/#test-results/run/2026-09-21T10-00-00Z-ccccccc-local" in this page
    Then the "Test Results" tab should be the selected one

  # --- Language, layout, accessibility ------------------------------------------------------------------------------------------

  Scenario: The tab speaks Spanish on the Spanish page
    When I open "/es/admin/"
    Then the Test Results tab should ask for the token in Spanish
    When I sign in with the token "browser-test-admin-token"
    Then the Test Results tab should show "Última ejecución", "Todas las ejecuciones" and "21 sept 2026"
    When I open the run with commit "bbbbbbb" from the list
    Then the Test Results tab should show "Fallos", "Evidencia de los fallos" and "← Todas las ejecuciones"

  Scenario Outline: Each state of the tab passes the automated accessibility audit
    When I open "/admin/"
    And I show the Test Results tab in its "<state>" state
    Then the page should pass the automated accessibility audit

    Examples:
      | state             |
      | sign-in           |
      | wrong token       |
      | list of runs      |
      | passing run       |
      | failing run       |

  Scenario Outline: No state of the tab scrolls sideways on a phone
    Given the visitor uses a phone
    When I open "/admin/"
    And I show the Test Results tab in its "<state>" state
    Then the page should not scroll sideways

    Examples:
      | state        |
      | sign-in      |
      | list of runs |
      | passing run  |
      | failing run  |

  Scenario: Using the tab causes no script errors, no policy violations and no unexpected requests
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "bbbbbbb" from the list
    And I click the "← All runs" link
    Then no script error should have been logged
    And no Content-Security-Policy violation should have been reported
    And nothing but the site and the results API should have been requested

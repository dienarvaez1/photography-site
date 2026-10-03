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
    When I open "/admin/#test-results"
    Then the Test Results tab should ask for the admin token
    And the results API should not have been asked for anything

  Scenario: A wrong token is refused, and forgotten
    When I open "/admin/#test-results"
    And I sign in with the token "definitely-the-wrong-one"
    Then the Test Results tab should say "That token was not accepted."
    And the Test Results tab should ask for the admin token
    And the browser should not remember any token

  Scenario: The right token shows the results, starting from latest.json and index.json
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    Then the latest run should be shown as commit "ccccccc", Passed, with "7 of 7 passed"
    And the list of all runs should show the commits "ccccccc, bbbbbbb, aaaaaaa" in that order
    And the results API should have been asked only for "/latest" and "/index", each with the token in the Authorization header
    And the token should not appear in any address

  Scenario: The token is kept for the browser tab, so a reload does not ask again
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I reload the page
    Then the latest run should be shown as commit "ccccccc", Passed, with "7 of 7 passed"

  Scenario: The Admin page still works after leaving it and returning with the browser's Back button
    # Nothing links to /admin/, so this is the only way back to it once view transitions are on:
    # its own mount logic can't simply run again the way it would after a real page load, since the
    # viewers it starts attach window/document listeners with no way to tear them down.
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    Then the latest run should be shown as commit "ccccccc", Passed, with "7 of 7 passed"
    When I click the header link "Contact"
    And I go back in the browser
    Then the latest run should be shown as commit "ccccccc", Passed, with "7 of 7 passed"

  Scenario: Signing out forgets the token
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I click "Sign out" at the top of the page
    Then the Test Results tab should ask for the admin token
    And the browser should not remember any token
    When I reload the page
    Then the Test Results tab should ask for the admin token

  Scenario: The tab explains when the results service has no admin token yet
    Given the results API has no admin token set up
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    Then the Test Results tab should say "The results service has no admin token yet. Set the ADMIN_TOKEN secret on the results Worker."
    And the Test Results tab should ask for the admin token

  Scenario: A token that stops being valid sends the visitor back to sign in
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And the results API's admin token is changed to "a-completely-new-admin-token"
    And I click "Refresh" at the top of the page
    Then the Test Results tab should say "That token was not accepted."
    And the Test Results tab should ask for the admin token

  Scenario: The gate works with the keyboard alone
    When I open "/admin/#test-results"
    And I type the token "browser-test-admin-token" into the focused token field and press Enter
    Then the latest run should be shown as commit "ccccccc", Passed, with "7 of 7 passed"

  # --- A results API on this computer (?api=) -----------------------------------------------------------------------

  Scenario: On the dev server, ?api= points the tab at a results API on this computer
    # npm run dev with npm run results-api:dev, as the README describes. The dev server sends the deployed site's
    # security headers too (src/middleware.ts), and until 1 Oct 2026 their policy blocked every request to the
    # local API, so the tab only ever said it could not reach the results service.
    Given the site is served with the dev server's headers
    And the results API also runs on this computer at "http://localhost:8788"
    When I open "/admin/?api=http://localhost:8788#test-results"
    And I sign in with the token "browser-test-admin-token"
    Then the latest run should be shown as commit "ccccccc", Passed, with "7 of 7 passed"
    And every request to the results API should have gone to "http://localhost:8788"
    And no Content-Security-Policy violation should have been reported

  Scenario: The deployed site's policy still refuses a results API on this computer
    Given the results API also runs on this computer at "http://localhost:8788"
    When I open "/admin/?api=http://localhost:8788#test-results"
    And I sign in with the token "browser-test-admin-token"
    Then the Test Results tab should say "Could not reach the results service."
    And the page should have been refused a connection to "http://localhost:8788" by its Content-Security-Policy
    And the results API should not have been asked for anything

  # --- Opening runs ----------------------------------------------------------------------------------------------

  Scenario Outline: Any run in the list can be opened, and the address says which
    When I open "/admin/#test-results"
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
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I open the latest run card
    Then the run's details should show the commit "ccccccc", Passed and "7 of 7 passed"

  Scenario: The browser's Back button returns from a run to the list
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "bbbbbbb" from the list
    And I go back in the browser
    Then the list of all runs should show the commits "ccccccc, bbbbbbb, aaaaaaa" in that order
    And the "Test Results" tab should be the selected one

  Scenario: The "All runs" link returns from a run to the list
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "aaaaaaa" from the list
    And I click the "← All runs" link
    Then the list of all runs should show the commits "ccccccc, bbbbbbb, aaaaaaa" in that order

  Scenario: A link to a run opens it directly, even after a reload
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "bbbbbbb" from the list
    And I reload the page
    Then the run's details should show the commit "bbbbbbb", Failed and "2 of 3 passed, 1 failed, 0 skipped"

  Scenario: A link to a run that is not there says so and offers the way back
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I open "/admin/#test-results/run/2030-01-01T00-00-00Z-nothing-local"
    Then the Test Results tab should say "That run was not found. It may have been pruned."
    And there should be an "← All runs" link

  Scenario: Clicking the Test Results tab while a run is open returns to the list
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "bbbbbbb" from the list
    And I click the "Test Results" tab
    Then the list of all runs should show the commits "ccccccc, bbbbbbb, aaaaaaa" in that order
    And the address should end with "#test-results"

  Scenario: Keyboard users can open a run with Enter
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I focus the run with commit "bbbbbbb" and press Enter
    Then the run's details should show the commit "bbbbbbb", Failed and "2 of 3 passed, 1 failed, 0 skipped"
    And keyboard focus should be on the run's heading

  # --- What a run shows --------------------------------------------------------------------------------------------

  Scenario: A run shows its suites
    When I open "/admin/#test-results"
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
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "bbbbbbb" from the list
    Then the features of the "Offline" suite should list "site.feature" with 3 scenarios, 2 passed and 1 failed
    And the failures should list the scenario "failed scenario 1" of the feature "site.feature" with the reason "<img src=x onerror=window.__xss=1> Expected 5"
    And nothing from the results should have been treated as page markup

  Scenario: A run's reports open in a new tab, from the results API, showing the stored report
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "ccccccc" from the list
    Then every report link should open in a new tab without giving the new page access to this one
    And every file link should lead to the results API, with no token in it
    When I click the report link "Open report (Offline)"
    Then a new tab should show the stored report "Offline report ccccccc"

  Scenario: A file link that does not lead back to the results API is never shown
    Given the results API hands out a link to another site for "offline.html"
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "ccccccc" from the list
    Then the run should show no link to another site, and no report link for that file

  Scenario: Failure evidence is shown: the screenshot, and the trace to download
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "bbbbbbb" from the list
    Then the evidence for "checkout-fails" should show its screenshot, loaded, with a description
    And the evidence for "checkout-fails" should offer the trace as a download and the log as a link

  Scenario: The stored report is reached by the run's signed link, and the link stops working after signing out
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "ccccccc" from the list
    And the results API's admin token is changed to "a-completely-new-admin-token"
    And I click the report link "Open report (Offline)"
    Then a new tab should be refused with the error "forbidden"

  # --- When things are not normal ---------------------------------------------------------------------------------------------

  Scenario: An empty results store says so
    Given the results API holds the admin token "browser-test-admin-token" and no published runs
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    Then the Test Results tab should say "No test results have been published yet. Run npm run test:record, then npm run results:publish."

  Scenario: When the results API can't be reached, signing in says so, and works once it is back
    Given the results API cannot be reached
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    Then the token box should say "Could not reach the results service. Check your connection and try again."
    And the page should offer only the admin token box and its button
    When the results API comes back
    And I sign in with the token "browser-test-admin-token"
    Then the latest run should be shown as commit "ccccccc", Passed, with "7 of 7 passed"

  Scenario: When the results API stops answering the tab says so, and Refresh recovers
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And the results API cannot be reached
    And I click "Refresh" at the top of the page
    Then the Test Results tab should say "Could not reach the results service. Check your connection and try again."
    When the results API comes back
    And I click "Refresh" at the top of the page
    Then the latest run should be shown as commit "ccccccc", Passed, with "7 of 7 passed"

  Scenario: No test results are asked for while the other tab is showing
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I open "/admin/#pics-viewer"
    And I reload the page
    Then the "Pics Viewer" tab should be the selected one
    And the results API should not have been asked for test results since the reload
    When I click the "Test Results" tab
    Then the latest run should be shown as commit "ccccccc", Passed, with "7 of 7 passed"

  Scenario: A link to a run opens the Test Results tab from another tab
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I click the "Pics Viewer" tab
    And I open the address "/admin/#test-results/run/2026-09-21T10-00-00Z-ccccccc-local" in this page
    Then the "Test Results" tab should be the selected one

  # --- Language, layout, accessibility ------------------------------------------------------------------------------------------

  Scenario: The tab speaks Spanish on the Spanish page
    When I open "/es/admin/#test-results"
    Then the Test Results tab should ask for the token in Spanish
    When I sign in with the token "browser-test-admin-token"
    Then the Test Results tab should show "Última ejecución", "Todas las ejecuciones" and "21 sept 2026"
    When I open the run with commit "bbbbbbb" from the list
    Then the Test Results tab should show "Fallos", "Evidencia de los fallos" and "← Todas las ejecuciones"

  Scenario Outline: Each state of the tab passes the automated accessibility audit
    When I open "/admin/#test-results"
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
    When I open "/admin/#test-results"
    And I show the Test Results tab in its "<state>" state
    Then the page should not scroll sideways

    Examples:
      | state        |
      | sign-in      |
      | list of runs |
      | passing run  |
      | failing run  |

  Scenario: Using the tab causes no script errors, no policy violations and no unexpected requests
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I open the run with commit "bbbbbbb" from the list
    And I click the "← All runs" link
    Then no script error should have been logged
    And no Content-Security-Policy violation should have been reported
    And nothing but the site and the results API should have been requested

  # --- Cleanup Test Results: deleting runs on demand ----------------------------------------------------------------------------

  Scenario: On the dev box Cleanup Test Results opens straight away (SITE_ENV decides); without the dev server's service, deleting says so
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Cleanup Test Results" in the Test Results tab
    Then every run in the list should have a checkbox, none ticked
    And the edit mode should be shown in red
    And the Test Results tab should not say "only works on your own computer"
    When I tick the runs "aaaaaaa"
    And I press "Delete selected" in the removal bar
    And I press "Delete 1 run" in the removal bar
    Then the Test Results tab should say "the local results service did not answer"
    And the list of all runs should show the commits "ccccccc, bbbbbbb, aaaaaaa" in that order

  Scenario: Remove Results puts a checkbox on every run, and the bar counts what is ticked
    Given the local results service is running
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Cleanup Test Results" in the Test Results tab
    Then every run in the list should have a checkbox, none ticked
    And the removal bar should say "0 selected", with "Delete selected" unavailable
    When I tick the runs "bbbbbbb, aaaaaaa"
    Then the removal bar should say "2 selected", with "Delete selected" available
    When I press "Select all" in the removal bar
    Then every run in the list should be ticked
    And the removal bar should say "3 selected", with "Delete selected" available
    When I press "Cancel" in the removal bar
    Then no run should have a checkbox
    And the local results service should not have been asked to remove anything

  Scenario: The confirmation names every run before anything is deleted, and "Keep them" or Escape backs out
    Given the local results service is running
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Cleanup Test Results" in the Test Results tab
    And I tick the runs "bbbbbbb, aaaaaaa"
    And I press "Delete selected" in the removal bar
    Then the removal bar should ask "Permanently delete these 2 test runs and all their reports? This cannot be undone."
    And the confirmation should name the runs "bbbbbbb, aaaaaaa"
    And "Keep them" should have the keyboard focus
    When I press "Keep them" in the removal bar
    Then the removal bar should say "2 selected", with "Delete selected" available
    When I press "Delete selected" in the removal bar
    And I press the key "Escape"
    Then the removal bar should say "2 selected", with "Delete selected" available
    And the local results service should not have been asked to remove anything

  Scenario: Deleting the ticked runs removes them from the store and the list, and says so
    Given the local results service is running
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Cleanup Test Results" in the Test Results tab
    And I tick the runs "bbbbbbb, aaaaaaa"
    And I press "Delete selected" in the removal bar
    And I press "Delete 2 runs" in the removal bar
    Then the Test Results tab should say "Deleted 2 test runs."
    And the list of all runs should show the commits "ccccccc" in that order
    And the latest run should be shown as commit "ccccccc", Passed, with "7 of 7 passed"
    And no file of the runs "bbbbbbb, aaaaaaa" should be left in the results bucket
    And no run should have a checkbox

  Scenario: Deleting the newest run makes the next one the latest
    Given the local results service is running
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Cleanup Test Results" in the Test Results tab
    And I tick the runs "ccccccc"
    And I press "Delete selected" in the removal bar
    And I press "Delete 1 run" in the removal bar
    Then the Test Results tab should say "Deleted 1 test run."
    And the latest run should be shown as commit "bbbbbbb", Failed, with "2 of 3 passed, 1 failed, 0 skipped"
    And the list of all runs should show the commits "bbbbbbb, aaaaaaa" in that order

  Scenario: A run whose files can't all be deleted is said to be off the list, and safe to remove again
    Given the local results service is running
    And deleting files of "bbbbbbb" fails in the results bucket
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Cleanup Test Results" in the Test Results tab
    And I tick the runs "bbbbbbb"
    And I press "Delete selected" in the removal bar
    And I press "Delete 1 run" in the removal bar
    Then the Test Results tab should say "was taken off the list, but not all its files could be deleted"
    And the list of all runs should show the commits "ccccccc, aaaaaaa" in that order

  Scenario Outline: The removal bar and its confirmation pass the automated accessibility audit, on laptop and phone
    Given the visitor uses a <device>
    And the local results service is running
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Cleanup Test Results" in the Test Results tab
    And I tick the runs "bbbbbbb"
    Then the page should pass the automated accessibility audit
    And the page should not scroll sideways
    When I press "Delete selected" in the removal bar
    Then the page should pass the automated accessibility audit

    Examples:
      | device |
      | laptop |
      | phone  |

  Scenario: Remove Results speaks Spanish
    Given the local results service is running
    When I open "/es/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Limpiar resultados de pruebas" in the Test Results tab
    Then the removal bar should say "0 seleccionadas", with "Eliminar las seleccionadas" unavailable

  # --- Run in CI -------------------------------------------------------------------------------------------------------------

  Scenario: Run in CI first asks which branch, defaulting to the one this checkout is on, and starts nothing until asked
    Given the local results service is running
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Run in CI" in the Test Results tab
    Then the branch dialog should offer "QA-feature_optimization (this checkout), main, local checkout on this computer (QA-feature_optimization)", with "QA-feature_optimization (this checkout)" chosen
    And the CI workflow should have been started 0 times
    And the page should pass the automated accessibility audit
    When I press "Start CI run" in the branch dialog
    Then the branch dialog should be closed
    And the CI run should have been started from the tab on the branch "QA-feature_optimization"
    And the Test Results tab should say "Running every Cucumber test in CI on QA-feature_optimization."

  Scenario: Another branch can be chosen in the dialog
    Given the local results service is running
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Run in CI" in the Test Results tab
    And I choose the branch "main" in the branch dialog
    And I press "Start CI run" in the branch dialog
    Then the CI run should have been started from the tab on the branch "main"
    And the Test Results tab should say "Running every Cucumber test in CI on main."

  Scenario: Cancel or Escape in the branch dialog starts nothing
    Given the local results service is running
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Run in CI" in the Test Results tab
    And I press "Cancel" in the branch dialog
    Then the branch dialog should be closed
    And "Run in CI" should be available in the Test Results tab
    When I press "Run in CI" in the Test Results tab
    And I press the key "Escape"
    Then the branch dialog should be closed
    And the CI workflow should have been started 0 times

  Scenario: A checkout on a branch that isn't on GitHub is still the default, but must be pushed before CI can run it
    Given this checkout is on the branch "QA-not-pushed", which is not on GitHub yet
    And the local results service is running
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Run in CI" in the Test Results tab
    Then the branch dialog should offer "QA-not-pushed (this checkout), QA-feature_optimization, main, local checkout on this computer (QA-not-pushed)", with "QA-not-pushed (this checkout)" chosen
    And the branch dialog should say "QA-not-pushed is not on GitHub yet. Push it first, or choose another branch.", with "Start CI run" unavailable
    When I choose the branch "main" in the branch dialog
    Then "Start CI run" should be available in the branch dialog
    When I press "Start CI run" in the branch dialog
    Then the CI run should have been started from the tab on the branch "main"

  Scenario: Cleanup Test Results comes first above the list, then Run in CI
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    Then the Test Results tab's buttons above the list should be "Cleanup Test Results, Run in CI"

  Scenario: On the dev box Run in CI goes straight to the branch list (SITE_ENV decides); without the dev server's service, it says why
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Run in CI" in the Test Results tab
    Then the Test Results tab should say "The branches on GitHub could not be listed: the local results service did not answer"
    And the Test Results tab should not say "only works on your own computer"
    And "Run in CI" should be available in the Test Results tab
    And the CI workflow should have been started 0 times

  Scenario: Run in CI starts every Cucumber test in CI, follows the run, then reads the list again
    Given the local results service is running
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Run in CI" in the Test Results tab
    And I press "Start CI run" in the branch dialog
    Then the Test Results tab should say "Running every Cucumber test in CI on QA-feature_optimization."
    And the Test Results tab should link to the CI run
    And "CI run in progress…" should be unavailable in the Test Results tab
    And the Test Results tab should come to say "The CI run is done: every test passed."
    And "Run in CI" should be available again in the Test Results tab
    And the results API should come to have been asked for "/index" 2 times
    And the CI workflow should have been started 1 time

  Scenario: A CI run that fails says so, with a link to it on GitHub
    Given the local results service is running
    And the CI run fails
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Run in CI" in the Test Results tab
    And I press "Start CI run" in the branch dialog
    Then the Test Results tab should come to say "The CI run ended: failure."
    And the Test Results tab should link to the CI run

  Scenario: Pressing Run in CI while a run from here is going follows it instead of starting another
    Given the local results service is running
    And the CI run is never done
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Run in CI" in the Test Results tab
    And I press "Start CI run" in the branch dialog
    And I reload the page
    And I press "Run in CI" in the Test Results tab
    And I press "Start CI run" in the branch dialog
    Then the Test Results tab should say "Running every Cucumber test in CI on QA-feature_optimization."
    And "CI run in progress…" should be unavailable in the Test Results tab
    And the CI workflow should have been started 1 time

  Scenario: Run in CI says why GitHub refused to start the run
    Given the local results service is running
    And starting a CI run fails with "HTTP 422: Workflow does not have 'workflow_dispatch' trigger"
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Run in CI" in the Test Results tab
    And I press "Start CI run" in the branch dialog
    Then the Test Results tab should say "The CI run could not be started: HTTP 422: Workflow does not have 'workflow_dispatch' trigger"
    And "Run in CI" should be available in the Test Results tab

  Scenario: Both buttons are there even before the first test run (Cleanup unavailable until there is one), and pass the accessibility audit
    Given the results API holds the admin token "browser-test-admin-token" and no published runs
    And the local results service is running
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    Then the Test Results tab's buttons above the list should be "Cleanup Test Results, Run in CI"
    And "Cleanup Test Results" should be unavailable in the Test Results tab
    And the page should pass the automated accessibility audit
    When I press "Run in CI" in the Test Results tab
    And I press "Start CI run" in the branch dialog
    Then the Test Results tab should say "Running every Cucumber test in CI on QA-feature_optimization."
    And the page should pass the automated accessibility audit

  Scenario: Run in CI speaks Spanish
    Given the local results service is running
    When I open "/es/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Ejecutar en CI" in the Test Results tab
    And I press "Iniciar ejecución de CI" in the branch dialog
    Then the Test Results tab should say "Ejecutando todas las pruebas en CI sobre QA-feature_optimization."

  Scenario: A few unanswered checks (the dev server restarting) don't stop the tab following the CI run
    Given the local results service is running
    And the local results service misses the next 2 checks on the CI run
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Run in CI" in the Test Results tab
    And I press "Start CI run" in the branch dialog
    Then the Test Results tab should come to say "The CI run is done: every test passed."

  Scenario: A dev server restart goes on following the CI run until GitHub says it is done
    Given the local results service is running
    And the CI run is never done
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Run in CI" in the Test Results tab
    And I press "Start CI run" in the branch dialog
    And the dev server restarts while the CI run is going
    Then the Test Results tab should come to say "The CI run is done: every test passed."

  Scenario: A dev server restart that loses the CI run says so, and links to the run on GitHub
    Given the local results service is running
    And the CI run is never done
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Run in CI" in the Test Results tab
    And I press "Start CI run" in the branch dialog
    And the dev server restarts while the CI run is going and loses the run it saved
    Then the Test Results tab should come to say "The dev server restarted and lost track of the CI run; it may still be going on GitHub."
    And the Test Results tab should link to the CI run
    And "Run in CI" should be available again in the Test Results tab

  Scenario: Run in CI can run every test in the local checkout instead, and says how it went
    Given the local results service is running
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Run in CI" in the Test Results tab
    And I choose the branch ":local" in the branch dialog
    Then "Start CI run" should be available in the branch dialog
    When I press "Start CI run" in the branch dialog
    Then the Test Results tab should say "Running every Cucumber test in the local checkout (QA-feature_optimization) on this computer."
    And the Test Results tab should come to say "The local run is done: every test passed."
    And the tests should have run in the local checkout once, started from this page's host
    And the CI workflow should have been started 0 times

  Scenario: A local run that fails says so in its own words
    Given the local results service is running
    And the local run fails with "✗ browser suite failed"
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I press "Run in CI" in the Test Results tab
    And I choose the branch ":local" in the branch dialog
    And I press "Start CI run" in the branch dialog
    Then the Test Results tab should come to say "The local run ended: ✗ browser suite failed"

  Scenario: A run's line and details say where it was started from and where it ran
    Given the results API also holds a run of commit "eeeeeee" started from "localhost:4321" that ran in "GitHub CI"
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    Then the run of commit "eeeeeee" should be listed as "eeeeeee · main · localhost:4321 → GitHub CI"

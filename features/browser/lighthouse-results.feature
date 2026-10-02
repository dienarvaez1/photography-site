@browser
Feature: The Admin page's Lighthouse Test Results tab shows every Lighthouse run, behind the admin token
  As the site owner
  I want a tab that shows the latest Lighthouse run and every earlier one, like the Test Results tab
  So that I can see how fast the live site is, and what was over budget, without running anything

  The tab reads the runs through the real results API code, from a fake test bucket holding runs published by the
  real Lighthouse publisher (made-up measurements).

  Background:
    Given the results API holds the admin token "browser-test-admin-token" and these published runs:
      | time                 | commit  | offline results | browser results | smoke | artifacts |
      | 2026-09-21T10:00:00Z | ccccccc | 3 passed        |                 |       |           |
    And the results bucket also holds these Lighthouse runs:
      | time                 | commit  | phone | laptop |
      | 2026-09-28T10:00:00Z | aaaaaaa | 60    | 98     |
      | 2026-09-29T10:00:00Z | bbbbbbb | 91    | 98     |

  Scenario: The tab asks for the admin token before showing or requesting anything
    When I open "/admin/#lighthouse-results"
    Then the Lighthouse Test Results tab should ask for the admin token
    And the results API should not have been asked for any Lighthouse run

  Scenario: A wrong token is refused, and nothing is shown
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "not-the-token-123"
    Then the Lighthouse Test Results tab should say "That token was not accepted."
    And the Lighthouse Test Results tab should ask for the admin token

  Scenario: Signing in shows the latest run and every run, newest first
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    Then the latest Lighthouse run should be shown as commit "bbbbbbb", "Within budget", with "3 of 3 within budget"
    And the Lighthouse runs should be listed newest first, for the commits "bbbbbbb, aaaaaaa"
    And the Lighthouse run for commit "aaaaaaa" should be shown as "Over budget", with "2 of 3 within budget"

  Scenario: One sign-in serves every tab
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I click the "Lighthouse Test Results" tab
    Then the latest Lighthouse run should be shown as commit "bbbbbbb", "Within budget", with "3 of 3 within budget"

  Scenario: Opening a run shows every page and device, its scores and timings, and links to its reports
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    And I open the Lighthouse run for commit "aaaaaaa"
    Then the address should be that Lighthouse run's own address
    And the Lighthouse run should list, in order: "/ Phone 60 Over budget, / Laptop 98 Within budget, /about/ Phone 95 Within budget"
    And the Lighthouse run should say what was over budget: "Performance 60 (needs 75)" on "/ · Phone"
    And every Lighthouse report link should be a signed link to the results API that opens in a new tab
    And the run's index page and raw data should be linked, with how long the links last

  Scenario: A run with every page within budget says so
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    And I open the Lighthouse run for commit "bbbbbbb"
    Then the Lighthouse run should say "Every page was within its budget."

  Scenario: The way back from a run returns to the list, and so does the browser's Back button
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    And I open the Lighthouse run for commit "aaaaaaa"
    And I click the Lighthouse "← All runs" link
    Then the Lighthouse runs should be listed newest first, for the commits "bbbbbbb, aaaaaaa"
    When I open the Lighthouse run for commit "aaaaaaa"
    And I go back in the browser
    Then the Lighthouse runs should be listed newest first, for the commits "bbbbbbb, aaaaaaa"

  Scenario: A link to a run that doesn't exist says so
    When I open "/admin/#lighthouse-results/run/2020-01-01T00-00-00Z-nope-local"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    Then the Lighthouse Test Results tab should say "That run was not found."

  Scenario: With no Lighthouse runs published, the tab says how to publish one
    Given the results bucket holds no Lighthouse runs
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    Then the Lighthouse Test Results tab should say "No Lighthouse runs have been published yet."

  Scenario: Signing out at the top of the page signs this tab out too
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    And the latest Lighthouse run should be shown as commit "bbbbbbb", "Within budget", with "3 of 3 within budget"
    And I click "Sign out" at the top of the page
    Then the Lighthouse Test Results tab should ask for the admin token

  Scenario: The tab speaks Spanish on the Spanish page
    When I open "/es/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    Then the latest Lighthouse run should be shown as commit "bbbbbbb", "Dentro del presupuesto", with "3 de 3 dentro del presupuesto"

  Scenario Outline: The list and a run pass the automated accessibility audit, and don't scroll sideways on a phone
    Given the visitor uses a <device>
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    Then the page should pass the automated accessibility audit
    And the page should not scroll sideways
    When I open the Lighthouse run for commit "aaaaaaa"
    Then the page should pass the automated accessibility audit
    And the page should not scroll sideways

    Examples:
      | device |
      | laptop |
      | phone  |

  Scenario: Using the tab causes no script errors and no policy violations
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    And I open the Lighthouse run for commit "aaaaaaa"
    Then no script error should have been logged
    And no Content-Security-Policy violation should have been reported

  # --- Remove Results and Run in Production --------------------------------------------------------------------------------

  Scenario: On the dev box Cleanup Lighthouse Test Results opens straight away; without the dev server's service, Run in Production says it needs it
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    And I press "Cleanup Lighthouse Test Results" in the Lighthouse Test Results tab
    Then every run in the list should have a checkbox, none ticked
    And the Lighthouse Test Results tab should not say "only works on your own computer"
    When I press "Cancel" in the removal bar
    And I press "Run in Production" in the Lighthouse Test Results tab
    Then the Lighthouse Test Results tab should say "Running Lighthouse against production only works on your own computer"
    And "Run in Production" should be available in the Lighthouse Test Results tab
    And Lighthouse should have measured the production site 0 times

  Scenario: Remove Results deletes the ticked Lighthouse runs, after a confirmation naming them, and leaves the test results alone
    Given the local results service is running
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    And I press "Cleanup Lighthouse Test Results" in the Lighthouse Test Results tab
    Then every run in the list should have a checkbox, none ticked
    When I tick the runs "bbbbbbb"
    And I press "Delete selected" in the removal bar
    Then the removal bar should ask "Permanently delete this test run and all its reports? This cannot be undone."
    And the confirmation should name the runs "bbbbbbb"
    When I press "Delete 1 run" in the removal bar
    Then the Lighthouse Test Results tab should say "Deleted 1 test run."
    And the Lighthouse runs should be listed newest first, for the commits "aaaaaaa"
    And the latest Lighthouse run should be shown as commit "aaaaaaa", "Over budget", with "2 of 3 within budget"
    And no file of the Lighthouse runs "bbbbbbb" should be left in the results bucket
    And the test results should be untouched

  Scenario: Cancel leaves every Lighthouse run in place
    Given the local results service is running
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    And I press "Cleanup Lighthouse Test Results" in the Lighthouse Test Results tab
    And I press "Select all" in the removal bar
    Then the removal bar should say "2 selected", with "Delete selected" available
    When I press "Cancel" in the removal bar
    Then no run should have a checkbox
    And the local results service should not have been asked to remove anything

  Scenario: Cleanup Lighthouse Test Results comes first above the list, then Run in Production
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    Then the Lighthouse Test Results tab's buttons above the list should be "Cleanup Lighthouse Test Results, Run in Production"

  Scenario: Run in Production first asks which branch, defaulting to main, and starts nothing until asked
    Given the local results service is running
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    And I press "Run in Production" in the Lighthouse Test Results tab
    Then the branch dialog should offer "QA-feature_optimization (this checkout), main", with "main" chosen
    And the page should pass the automated accessibility audit
    And Lighthouse should have measured the production site 0 times
    When I press "Start Lighthouse run" in the branch dialog
    Then the branch dialog should be closed
    And the Lighthouse run should have been started from the tab on the branch "main"

  Scenario: Run in Production runs on another branch when one is chosen
    Given the local results service is running
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    And I press "Run in Production" in the Lighthouse Test Results tab
    And I choose the branch "QA-feature_optimization" in the branch dialog
    And I press "Start Lighthouse run" in the branch dialog
    Then the Lighthouse run should have been started from the tab on the branch "QA-feature_optimization"
    And the Lighthouse Test Results tab should say "from the branch QA-feature_optimization"
    And the Lighthouse Test Results tab should come to say "every page met its budget"

  Scenario: Cancel in Run in Production's branch dialog starts nothing
    Given the local results service is running
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    And I press "Run in Production" in the Lighthouse Test Results tab
    And I press "Cancel" in the branch dialog
    Then the branch dialog should be closed
    And "Run in Production" should be available in the Lighthouse Test Results tab
    And Lighthouse should have measured the production site 0 times

  Scenario: Run in Production measures the live site on GitHub, waits while it runs, then lists the new run
    Given the local results service is running
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    And I press "Run in Production" in the Lighthouse Test Results tab
    And I press "Start Lighthouse run" in the branch dialog
    Then the Lighthouse Test Results tab should say "Lighthouse is measuring the live site (https://diego-narvaez-photography.org) on GitHub Actions, from the branch main."
    And the Lighthouse Test Results tab should link to the run on GitHub
    And "Measuring production…" should be unavailable in the Lighthouse Test Results tab
    And the Lighthouse run should have been started from the tab on the branch "main"
    And the Lighthouse Test Results tab should come to say "every page met its budget"
    And the Lighthouse runs should be listed newest first, for the commits "ddddddd, bbbbbbb, aaaaaaa"
    And "Run in Production" should be available again in the Lighthouse Test Results tab
    And Lighthouse should have measured the production site 1 time

  Scenario: Run in Production is not done until the results API confirms it has the new run
    Given the local results service is running
    And the results API only has the new Lighthouse run 3 seconds after it is stored
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    And I press "Run in Production" in the Lighthouse Test Results tab
    And I press "Start Lighthouse run" in the branch dialog
    Then the Lighthouse Test Results tab should come to say "Waiting for the results API to confirm it has the run"
    And "Measuring production…" should be unavailable in the Lighthouse Test Results tab
    And the Lighthouse Test Results tab should not say "every page met its budget"
    And the Lighthouse Test Results tab should come to say "every page met its budget"
    And the results API should have been asked for the new Lighthouse run
    And the Lighthouse runs should be listed newest first, for the commits "ddddddd, bbbbbbb, aaaaaaa"
    And "Run in Production" should be available again in the Lighthouse Test Results tab

  Scenario: When the results API never confirms the new run, the tab stops waiting after 2 minutes and says so
    Given the page clock is under the test's control
    And the local results service is running
    And the results API never has the new Lighthouse run
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    And I press "Run in Production" in the Lighthouse Test Results tab
    And I press "Start Lighthouse run" in the branch dialog
    Then the Lighthouse Test Results tab should come to say "Waiting for the results API to confirm it has the run"
    When 2 minutes pass with nobody touching the page
    Then the Lighthouse Test Results tab should come to say "the results API still had not confirmed it after 2 minutes"
    And "Run in Production" should be available again in the Lighthouse Test Results tab

  Scenario: A run with pages over budget says so in its own words, and is listed too
    Given the local results service is running
    And a Lighthouse run of production ends with pages over budget
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    And I press "Run in Production" in the Lighthouse Test Results tab
    And I press "Start Lighthouse run" in the branch dialog
    Then the Lighthouse Test Results tab should come to say "Lighthouse ended: ✗ some pages over budget"
    And the Lighthouse runs should be listed newest first, for the commits "ddddddd, bbbbbbb, aaaaaaa"

  Scenario: Pressing Run in Production while a run is measuring follows that run instead of starting another
    Given the local results service is running
    And a Lighthouse run of production never ends
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    And I press "Run in Production" in the Lighthouse Test Results tab
    And I press "Start Lighthouse run" in the branch dialog
    And I reload the page
    And I press "Run in Production" in the Lighthouse Test Results tab
    And I press "Start Lighthouse run" in the branch dialog
    Then the Lighthouse Test Results tab should say "Lighthouse is measuring the live site"
    And "Measuring production…" should be unavailable in the Lighthouse Test Results tab
    And Lighthouse should have measured the production site 1 time

  Scenario: Run in Production is there even before the first Lighthouse run
    Given the results bucket holds no Lighthouse runs
    And the local results service is running
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    Then the Lighthouse Test Results tab's buttons above the list should be "Cleanup Lighthouse Test Results, Run in Production"
    And "Cleanup Lighthouse Test Results" should be unavailable in the Lighthouse Test Results tab
    When I press "Run in Production" in the Lighthouse Test Results tab
    And I press "Start Lighthouse run" in the branch dialog
    Then the Lighthouse Test Results tab should come to say "every page met its budget"
    And the Lighthouse runs should be listed newest first, for the commits "ddddddd"

  Scenario Outline: The buttons, the removal bar and the confirmation pass the automated accessibility audit, on laptop and phone
    Given the visitor uses a <device>
    And the local results service is running
    When I open "/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    Then the page should pass the automated accessibility audit
    When I press "Cleanup Lighthouse Test Results" in the Lighthouse Test Results tab
    And I tick the runs "aaaaaaa"
    Then the page should pass the automated accessibility audit
    And the page should not scroll sideways
    When I press "Delete selected" in the removal bar
    Then the page should pass the automated accessibility audit

    Examples:
      | device |
      | laptop |
      | phone  |

  Scenario: Remove Results and Run in Production speak Spanish
    Given the local results service is running
    When I open "/es/admin/#lighthouse-results"
    And I sign in to the Lighthouse Test Results tab with the token "browser-test-admin-token"
    And I press "Ejecutar en producción" in the Lighthouse Test Results tab
    And I press "Iniciar ejecución de Lighthouse" in the branch dialog
    Then the Lighthouse Test Results tab should say "Lighthouse está midiendo el sitio en línea (https://diego-narvaez-photography.org) en GitHub Actions, desde la rama main."
    When I press "Limpiar resultados de Lighthouse" in the Lighthouse Test Results tab
    Then the removal bar should say "0 seleccionadas", with "Eliminar las seleccionadas" unavailable

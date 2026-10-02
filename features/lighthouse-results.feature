Feature: Lighthouse runs are stored in R2, next to the test results, for the Admin page
  As the site owner
  I want every Lighthouse run kept in the private test bucket with an index of runs
  So that the Admin page's Lighthouse Test Results tab can show the latest run and every earlier one

  A run is the folder `npm run test:lighthouse` leaves (test-results/lighthouse/): each page's report, the index page
  and summary.json. It is published under lighthouse-results/ in photography-site-test. These scenarios use a fake
  bucket and made-up measurements, so they need neither Lighthouse nor the network.

  Background:
    Given a fake test-results bucket
    And a Lighthouse run folder that measured "/" on a phone (performance 91) and "/" on a laptop (performance 98)

  Scenario: A run's reports, index page and summary land under lighthouse-results/, never under results/
    When I publish the Lighthouse run from "local" at "2026-09-29T12:00:00Z" for commit "abc1234" on branch "main"
    Then the bucket should hold exactly these Lighthouse keys for run "2026-09-29T12-00-00Z-abc1234-local":
      | lighthouse-results/runs/<run>/desktop-home.html |
      | lighthouse-results/runs/<run>/index.html        |
      | lighthouse-results/runs/<run>/mobile-home.html  |
      | lighthouse-results/runs/<run>/summary.json      |
      | lighthouse-results/latest.json                  |
      | lighthouse-results/index.json                   |
    And nothing should be stored under "results/"

  Scenario: The summary records where and what was measured, and how every page did
    When I publish the Lighthouse run from "ci" at "2026-09-29T12:00:00Z" for commit "abc1234" on branch "main"
    Then the latest Lighthouse summary should say it measured "https://example.org" with 3 runs per page, from "GitHub", commit "abc1234" on "main"
    And the latest Lighthouse summary and its index entry should say source "GitHub" and target "example.org"
    And the latest Lighthouse summary should list "/ mobile" with performance 91 and "/ desktop" with performance 98
    And the latest Lighthouse summary should count 2 of 2 within budget, and be ok
    And the latest Lighthouse summary should list every file of the run

  Scenario: A run with a page over budget is not ok, and the index says which page
    Given a Lighthouse run folder that measured "/" on a phone (performance 60) and "/" on a laptop (performance 98)
    When I publish the Lighthouse run from "local" at "2026-09-29T12:00:00Z" for commit "abc1234" on branch "main"
    Then the latest Lighthouse summary should count 1 of 2 within budget, and not be ok
    And the Lighthouse index should list "/ mobile" as over budget in its newest run

  Scenario: The index lists runs newest first, each with its totals and its median performance per device
    When I publish the Lighthouse run from "local" at "2026-09-29T12:00:00Z" for commit "aaa1111" on branch "main"
    And I publish the Lighthouse run from "local" at "2026-09-29T13:00:00Z" for commit "bbb2222" on branch "main"
    Then the Lighthouse index should list 2 runs, newest first: "bbb2222, aaa1111"
    And the newest Lighthouse run in the index should show performance 91 on mobile and 98 on desktop, 2 of 2 within budget

  Scenario: The index is written last, so it never names a file that isn't there
    When I publish the Lighthouse run from "local" at "2026-09-29T12:00:00Z" for commit "abc1234" on branch "main"
    Then the Lighthouse index should have been written after every file it names

  Scenario Outline: Nothing usable to publish is refused before anything is uploaded
    Given the Lighthouse run folder <problem>
    When I try to publish the Lighthouse run
    Then publishing should fail with a message mentioning "<message>"
    And nothing should be stored under "lighthouse-results/"

    Examples:
      | problem                   | message                |
      | does not exist            | npm run test:lighthouse |
      | has no summary.json       | summary.json           |
      | has a broken summary.json | not valid JSON         |

  Scenario: Old runs beyond the retention limit are removed from the index and the bucket
    When I publish 3 Lighthouse runs keeping only the newest 2
    Then the Lighthouse index should list 2 runs
    And the oldest Lighthouse run's files should be gone from the bucket

  Scenario: Remove Results deletes chosen Lighthouse runs through the local results service, and the next run becomes the latest
    When I publish 3 Lighthouse runs keeping only the newest 3
    And the local results service is asked to remove the newest Lighthouse run
    Then the Lighthouse index should list 2 runs
    And the latest Lighthouse summary should be the newest run left
    And the removed Lighthouse run's files should be gone from the bucket
    And nothing should be stored under "results/"

  Scenario: Removing Lighthouse runs deletes their files several at a time, not one by one
    When I publish 3 Lighthouse runs keeping only the newest 3
    And every delete from the bucket takes 100 ms
    And the local results service is asked to remove every Lighthouse run
    Then the service should report every Lighthouse run removed, nothing missing or failed
    And the Lighthouse index should list 0 runs
    And no file of any removed Lighthouse run should be left in the bucket
    And the bucket should have been deleting more than 1 file at once, but never more than 8
    And the removal should have taken less than half as long as deleting the files one by one

  Scenario: A file that can't be deleted fails only its own run; every other run's files are still deleted
    When I publish 3 Lighthouse runs keeping only the newest 3
    And the bucket can't delete the files of the second Lighthouse run
    And the local results service is asked to remove every Lighthouse run
    Then the service should report the second Lighthouse run failed and the others removed
    And the Lighthouse index should list 0 runs
    And no file of the first and third Lighthouse runs should be left in the bucket

  Scenario: Run in Production starts the Lighthouse workflow on GitHub on the chosen branch, and follows it until GitHub says it completed
    When the local results service is asked to run Lighthouse in production on the branch "main"
    Then the service should answer 202 with a Lighthouse run on "main" measuring the production site, still going
    And the Lighthouse workflow should have been started once, on the branch "main"
    When the service is asked how the measurement is going
    Then it should say the measurement is still going
    When GitHub says the Lighthouse run completed with "success", its log saying it published "2026-10-01T18-30-00Z-abc1234-ci" and "✓ every page within budget"
    And the service is asked how the measurement is going
    Then it should say the measurement ended with "success", having published "2026-10-01T18-30-00Z-abc1234-ci", with "✓ every page within budget"

  Scenario: A run with pages over budget still names the run it published, and how the pages did
    When the local results service is asked to run Lighthouse in production on the branch "main"
    And GitHub says the Lighthouse run completed with "failure", its log saying it published "2026-10-01T18-30-00Z-abc1234-ci" and "✗ some pages over budget (see test-results/lighthouse/index.html)"
    And the service is asked how the measurement is going
    Then it should say the measurement ended with "failure", having published "2026-10-01T18-30-00Z-abc1234-ci", with "✗ some pages over budget (see test-results/lighthouse/index.html)"

  Scenario: A run that never got as far as publishing names no run
    When the local results service is asked to run Lighthouse in production on the branch "main"
    And GitHub says the Lighthouse run completed with "failure", its log saying nothing was published
    And the service is asked how the measurement is going
    Then it should say the measurement ended with "failure", having published no run

  Scenario: A log GitHub can't give yet is asked for again, and the run ends without it after 3 tries
    When the local results service is asked to run Lighthouse in production on the branch "main"
    And GitHub says the Lighthouse run completed with "success", but its log can't be read: "log not found"
    And the service is asked how the measurement is going
    Then it should say the measurement is still going
    When the service is asked how the measurement is going
    And the service is asked how the measurement is going
    Then it should say the measurement ended with "success", having published no run
    And it should say the error "log not found"

  Scenario: A log that comes on the next question still names the run
    When the local results service is asked to run Lighthouse in production on the branch "main"
    And GitHub says the Lighthouse run completed with "success", but its log can't be read: "log not found"
    And the service is asked how the measurement is going
    And the Lighthouse run's log can be read, saying it published "2026-10-01T18-30-00Z-abc1234-ci" and "✓ every page within budget"
    And the service is asked how the measurement is going
    Then it should say the measurement ended with "success", having published "2026-10-01T18-30-00Z-abc1234-ci", with "✓ every page within budget"

  Scenario: Run in Production only runs on a branch that is on GitHub
    When the local results service is asked to run Lighthouse in production on the branch "QA-not-pushed"
    Then the service should answer 400 with the error "not-on-github" saying "push it first"
    And the Lighthouse workflow should not have been started

  Scenario: Only one Lighthouse run at a time; asking again answers with the one going
    When the local results service is asked to run Lighthouse in production on the branch "main"
    And the local results service is asked to run Lighthouse in production on the branch "main"
    Then the service should answer 409 with the error "busy" and the measurement already running
    And the Lighthouse workflow should have been started once, on the branch "main"

  Scenario: A restarted dev server goes on following the Lighthouse run
    When the local results service is asked to run Lighthouse in production on the branch "main"
    And the dev server restarts while the Lighthouse run is going
    And the service is asked how the measurement is going
    Then it should say the measurement is still going
    And the Lighthouse workflow should have been started once, on the branch "main"

  Scenario: Run in Production only takes requests from the Admin page itself
    When another site asks the local results service to run Lighthouse in production
    Then the service should answer 403 with the error "not-local" saying "only takes requests from its own page"
    And the Lighthouse workflow should not have been started

  Scenario: Run in Production starts lighthouse.yml with the GitHub CLI, which measures the site's own production address
    Then the local results service should measure "https://diego-narvaez-photography.org", the site's own address
    And it should start "lighthouse.yml" with "gh workflow run", follow it with "gh run view", and read its log with "gh run view --log"
    And the Lighthouse workflow should leave LIGHTHOUSE_URL unset, so the suite measures that address

  Scenario: The run a workflow published is read from its log as GitHub prints it
    When the service reads this Lighthouse workflow log:
      """
      lighthouse	Measure the live site and store the run in R2	2026-10-01T18:39:58.1Z === publishing to photography-site-test ===
      lighthouse	Measure the live site and store the run in R2	2026-10-01T18:39:59.2Z   uploaded lighthouse-results/runs/2026-10-01T18-30-00Z-abc1234-ci/index.html
      lighthouse	Measure the live site and store the run in R2	2026-10-01T18:40:00.3Z ✓ published 2026-10-01T18-30-00Z-abc1234-ci: 6/6 within budget → photography-site-test/lighthouse-results/runs/2026-10-01T18-30-00Z-abc1234-ci/
      lighthouse	Measure the live site and store the run in R2	2026-10-01T18:40:00.4Z
      lighthouse	Measure the live site and store the run in R2	2026-10-01T18:40:00.5Z ✓ every page within budget
      """
    Then it should find the published run "2026-10-01T18-30-00Z-abc1234-ci" and the summary "✓ every page within budget"

  Scenario: The Lighthouse workflow is started by hand, measures the live site and stores the run when the R2 secrets exist
    Then the Lighthouse workflow should only run when started by hand
    And it should install Chromium and run "npm run test:lighthouse:record" when the R2 secrets exist, and "npm run test:lighthouse:record -- --no-publish" when they don't
    And it should keep the reports with the run even when pages are over budget

  Scenario: A Lighthouse run started from the Admin page says so, and names the host it measured
    When I publish the Lighthouse run from "ci" started from "localhost:4321" at "2026-09-29T12:00:00Z"
    Then the latest Lighthouse summary and its index entry should say source "localhost:4321" and target "example.org"

  Scenario: The Lighthouse workflow says where a run was started from
    Then the Lighthouse workflow should take a "source" input when started by hand, and publish with RESULTS_FROM set to it

  Scenario: Run in Production passes this page's host to GitHub as the run's source
    When the local results service at "localhost:4321" is asked to measure production on the branch "main"
    Then GitHub should have been asked to start the Lighthouse run with the input source "localhost:4321"

  Scenario: Lighthouse runs stored before they recorded it get a source and the host they measured
    When I publish the Lighthouse run from "ci" at "2026-09-29T12:00:00Z" for commit "abc1234" on branch "main"
    And the run is stored without a source or target, as before
    And I label the stored Lighthouse runs
    Then the latest Lighthouse summary and its index entry should say source "GitHub" and target "example.org"

  Scenario: The test results' own publisher leaves the Lighthouse folder alone
    Given the results folder also holds a report of 3 passing scenarios
    When I publish the test results
    Then nothing should be stored under "lighthouse-results/"
    And no stored test-results file should come from the Lighthouse folder

  # --- The command line ------------------------------------------------------------------------------------------

  Scenario: Publishing, listing and showing from the command line
    When I run the Lighthouse results command "publish"
    Then the Lighthouse results command should succeed and say "2/2 within budget"
    When I run the Lighthouse results command "list"
    Then the Lighthouse results command should succeed and say "mobile 91"
    When I run the Lighthouse results command "show latest"
    Then the Lighthouse results command should succeed and say "https://example.org"

  Scenario: Showing an unknown run fails and says where to find the runs
    When I run the Lighthouse results command "show 2020-01-01T00-00-00Z-nope-local"
    Then the Lighthouse results command should fail and say "lighthouse-results:list"

  Scenario: The Lighthouse results commands exist
    Then the "test:lighthouse:record" script should run the Lighthouse suite and then publish it
    And the Lighthouse results commands should publish to "lighthouse-results/" in the test bucket

  # --- The Admin tab's logic ----------------------------------------------------------------------------------------

  Scenario Outline: The tab's address says which view to show
    Then the Lighthouse tab address "<hash>" should show <view>

    Examples:
      | hash                                                        | view                                                 |
      | #lighthouse-results                                         | the list                                             |
      | #lighthouse-results/run/2026-09-29T18-49-00Z-6959246-local  | the run "2026-09-29T18-49-00Z-6959246-local"         |
      | #lighthouse-results/run/not-a-run                           | the list                                             |
      | #lighthouse-results/run/2026-09-29T18-49-00Z-6959246-local/x | the list                                            |
      | #test-results                                               | nothing                                              |

  Scenario Outline: Only the API's own Lighthouse file links are followed
    Then the Lighthouse link "<link>" should be <verdict>

    Examples:
      | link                                                                      | verdict     |
      | https://api.test/lighthouse/files/2026-09-29T18-49-00Z-a-local/index.html | followed    |
      | https://api.test/files/2026-09-29T18-49-00Z-a-local/offline.html          | not followed |
      | https://evil.test/lighthouse/files/2026-09-29T18-49-00Z-a-local/index.html | not followed |
      | not a link                                                                | not followed |

  Scenario Outline: Scores and timings read the way Lighthouse shows them
    Then the Lighthouse <what> <value> should read "<shown>" in "<locale>"

    Examples:
      | what                              | value  | locale | shown  |
      | score                             | 95     | en     | good    |
      | score                             | 74     | en     | average |
      | score                             | 30     | en     | poor    |
      | metric largest-contentful-paint   | 4560   | en     | 4.6 s   |
      | metric largest-contentful-paint   | 4560   | es     | 4,6 s   |
      | metric total-blocking-time        | 40     | en     | 40 ms   |
      | metric cumulative-layout-shift    | 0.0134 | en     | 0.013   |
      | size                              | 599040 | en     | 585 KB  |

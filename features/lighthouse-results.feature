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
    Then the latest Lighthouse summary should say it measured "https://example.org" with 3 runs per page, from "ci", commit "abc1234" on "main"
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

  Scenario: Run in Production measures the live site on this computer, and says how it is going until it ends
    When the local results service is asked to run Lighthouse in production
    Then the service should answer 202 with a measurement of the production site that is still running
    And Lighthouse should have been started once, against the production site
    When the service is asked how the measurement is going
    Then it should say the measurement is still running
    When the measurement ends with exit code 0 after printing "✓ every page within budget"
    And the service is asked how the measurement is going
    Then it should say the measurement ended ok, with "✓ every page within budget" as its last line

  Scenario: A measurement with pages over budget, or one that couldn't be published, ends not ok with its own last line
    When the local results service is asked to run Lighthouse in production
    And the measurement ends with exit code 1 after printing "✗ some pages over budget — and the run could not be published"
    And the service is asked how the measurement is going
    Then it should say the measurement ended not ok, with "✗ some pages over budget — and the run could not be published" as its last line

  Scenario: A measurement that can't start says why
    When the local results service is asked to run Lighthouse in production
    And the measurement can't start because "spawn node ENOENT"
    And the service is asked how the measurement is going
    Then it should say the measurement ended not ok, with the error "spawn node ENOENT"

  Scenario: Only one measurement runs at a time; asking again answers with the one running
    When the local results service is asked to run Lighthouse in production
    And the local results service is asked to run Lighthouse in production
    Then the service should answer 409 with the error "busy" and the measurement already running
    And Lighthouse should have been started once, against the production site

  Scenario: Run in Production only takes requests from the Admin page itself
    When another site asks the local results service to run Lighthouse in production
    Then the service should answer 403 with the error "not-local" saying "only takes requests from its own page"
    And Lighthouse should not have been started

  Scenario: Run in Production runs the recording script against production, in its own results folder
    Then the local results service should measure "https://diego-narvaez-photography.org", the site's own address
    And it should run "scripts/run-lighthouse.mjs" with LIGHTHOUSE_URL set to that address and its own results folder

  Scenario: The Lighthouse workflow is started by hand, measures the live site and stores the run when the R2 secrets exist
    Then the Lighthouse workflow should only run when started by hand
    And it should install Chromium and run "npm run test:lighthouse:record" when the R2 secrets exist, and "npm run test:lighthouse:record -- --no-publish" when they don't
    And it should keep the reports with the run even when pages are over budget

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

Feature: Test results are kept in R2
  As the site owner
  I want every test run's reports, failures and history stored in the private test bucket
  So that I can see what passed or failed, when, on which commit, and what keeps breaking - without
  keeping report files in git or on my disk

  Reports go to the `photography-site-test` bucket under `results/`. These scenarios use a fake bucket and
  no network; the summaries are checked against real Cucumber output from a small fixture suite.

  Background:
    Given a fake test-results bucket

  # --- Summarising real Cucumber output ---------------------------------------------------------

  Scenario: A real Cucumber JSON report is summarised accurately
    Given the JSON report of a real run of the fixture suite
    Then the summary should count 6 scenarios: 3 passed, 2 failed and 1 skipped
    And the summary should count 8 steps: 4 passed, 2 failed and 2 skipped
    And the summary should list the feature "mini.feature" with 6 scenarios and 2 failures

  Scenario: Each failure names its scenario, the step that broke it and why
    Given the JSON report of a real run of the fixture suite
    Then the summary should list these failures:
      | scenario               | step contains                          | message contains                |
      | Fails halfway          | a step that fails with                 | boom: expected 1 to equal 2     |
      | Has an undefined step  | a step nobody defined                  | undefined                       |

  Scenario: The slowest scenarios are listed, slowest first
    Given the JSON report of a real run of the fixture suite
    Then the summary should list at most 5 slowest scenarios, in descending order of time

  Scenario: A scenario that only skipped is counted as skipped, not as passed
    Given the JSON report of a real run of the fixture suite
    Then the summary should list "Is skipped" as neither passed nor failed

  Scenario: A run with skipped scenarios is not reported as ok, even with no failures
    Given a results folder with one report of 3 passing scenarios and 1 skipped
    When I publish the results at "2026-09-21T04:30:12Z" from commit "e786ff8" as "local"
    Then the run's summary should say: commit "e786ff8", source "local", ok "no", 4 scenarios with 0 failed
    And the newest index entry should be marked as not ok

  Scenario: The smoke check's results are summarised too
    Given a smoke result of 10 checks where "robots.txt points at the real sitemap" failed with "sitemap host differs"
    Then the smoke summary should count 10 checks: 9 passed and 1 failed, naming that check and its detail

  # --- Run ids ----------------------------------------------------------------------------------------------

  Scenario Outline: A run id sorts by time and says where it came from
    Then the run id for "<time>", commit "<commit>", uncommitted changes "<dirty>" and source "<source>" should be "<id>"

    Examples:
      | time                 | commit  | dirty | source | id                                        |
      | 2026-09-21T04:30:12Z | e786ff8 | no    | local  | 2026-09-21T04-30-12Z-e786ff8-local        |
      | 2026-09-21T04:30:12Z | e786ff8 | yes   | local  | 2026-09-21T04-30-12Z-e786ff8-dirty-local  |
      | 2026-12-01T23:59:59Z | 1a2b3c4 | no    | ci     | 2026-12-01T23-59-59Z-1a2b3c4-ci           |

  # --- Publishing a run ----------------------------------------------------------------------------------------

  Scenario: A run's reports, summary, latest pointer and index all land under results/ in the test bucket
    Given a results folder holding the offline and browser reports of a real run
    When I publish the results at "2026-09-21T04:30:12Z" from commit "e786ff8" as "local"
    Then the bucket should hold these objects:
      | results/runs/2026-09-21T04-30-12Z-e786ff8-local/offline.json    |
      | results/runs/2026-09-21T04-30-12Z-e786ff8-local/offline.html    |
      | results/runs/2026-09-21T04-30-12Z-e786ff8-local/browser.json    |
      | results/runs/2026-09-21T04-30-12Z-e786ff8-local/browser.html    |
      | results/runs/2026-09-21T04-30-12Z-e786ff8-local/summary.json    |
      | results/latest.json                                             |
      | results/index.json                                              |
    And every object in the bucket should be under the "results/" prefix
    And the objects should have these content types:
      | offline.json | application/json           |
      | offline.html | text/html; charset=utf-8   |
      | summary.json | application/json           |
    And no object should be cached, so the newest results are always the ones read

  Scenario: The summary records what ran, where, and how it went
    Given a results folder holding the offline and browser reports of a real run
    When I publish the results at "2026-09-21T04:30:12Z" from commit "e786ff8" as "ci"
    Then the run's summary should say: commit "e786ff8", source "GitHub", ok "no", 12 scenarios with 4 failed
    And the run's summary and its index entry should say it ran in "GitHub CI"
    And the run's summary should list every file it uploaded
    And latest.json should be identical to that summary

  Scenario: The index lists runs newest first, each with its totals and failures
    Given a results folder holding the offline and browser reports of a real run
    When I publish the results at "2026-09-21T04:30:12Z" from commit "aaaaaaa" as "local"
    And I publish the results at "2026-09-22T09:00:00Z" from commit "bbbbbbb" as "local"
    Then the index should list these runs, newest first:
      | 2026-09-22T09-00-00Z-bbbbbbb-local |
      | 2026-09-21T04-30-12Z-aaaaaaa-local |
    And the newest index entry should show 12 scenarios, 4 failed, and 4 named failures

  Scenario: Two runs in the same second get different ids
    Given a results folder holding the offline and browser reports of a real run
    When I publish the results at "2026-09-21T04:30:12Z" from commit "e786ff8" as "local"
    And I publish the results at "2026-09-21T04:30:12Z" from commit "e786ff8" as "local"
    Then the index should list these runs, newest first:
      | 2026-09-21T04-30-12Z-e786ff8-local-2 |
      | 2026-09-21T04-30-12Z-e786ff8-local   |

  Scenario: A passing suite is reported as ok
    Given a results folder with one passing offline report
    When I publish the results at "2026-09-21T04:30:12Z" from commit "e786ff8" as "local"
    Then the run's summary should say: commit "e786ff8", source "local", ok "yes", 4 scenarios with 0 failed

  Scenario: Screenshots, traces and notes of failed browser scenarios are kept with the run
    Given a results folder holding the offline and browser reports of a real run
    And failure artifacts for the scenario "checkout-fails" in the results folder
    When I publish the results at "2026-09-21T04:30:12Z" from commit "e786ff8" as "local"
    Then the bucket should hold these objects:
      | results/runs/2026-09-21T04-30-12Z-e786ff8-local/artifacts/browser/checkout-fails.png |
      | results/runs/2026-09-21T04-30-12Z-e786ff8-local/artifacts/browser/checkout-fails.zip |
      | results/runs/2026-09-21T04-30-12Z-e786ff8-local/artifacts/browser/checkout-fails.txt |
    And the objects should have these content types:
      | checkout-fails.png | image/png                |
      | checkout-fails.zip | application/zip          |
      | checkout-fails.txt | text/plain; charset=utf-8 |

  Scenario: The live smoke check's results are stored like any other suite
    Given a results folder with only a smoke result of 10 checks where "robots.txt points at the real sitemap" failed with "sitemap host differs"
    When I publish the results at "2026-09-21T04:30:12Z" from commit "e786ff8" as "ci"
    Then the run's summary should say: commit "e786ff8", source "GitHub", ok "no", 10 scenarios with 1 failed
    And the bucket should hold these objects:
      | results/runs/2026-09-21T04-30-12Z-e786ff8-ci/smoke.json |

  # --- Failing safely ------------------------------------------------------------------------------------------------

  Scenario: The index is written last, so it never names a file that isn't there
    Given a results folder holding the offline and browser reports of a real run
    And the bucket refuses to store anything matching "browser.json"
    When I try to publish the results at "2026-09-21T04:30:12Z" from commit "e786ff8" as "local"
    Then the attempt should fail naming "browser.json"
    And the bucket should not hold a results index or a latest pointer

  Scenario: A failed upload leaves earlier runs and their index untouched
    Given a results folder holding the offline and browser reports of a real run
    When I publish the results at "2026-09-21T04:30:12Z" from commit "aaaaaaa" as "local"
    And the bucket refuses to store anything matching "browser.json"
    And I try to publish the results at "2026-09-22T09:00:00Z" from commit "bbbbbbb" as "local"
    Then the attempt should fail naming "browser.json"
    And the index should list these runs, newest first:
      | 2026-09-21T04-30-12Z-aaaaaaa-local |

  Scenario Outline: Nothing usable to publish is refused before anything is uploaded
    Given <situation>
    When I try to publish the results at "2026-09-21T04:30:12Z" from commit "e786ff8" as "local"
    Then the attempt should fail saying "<message>"
    And the bucket should hold no objects

    Examples:
      | situation                                              | message                     |
      | a results folder that is empty                         | No test results found       |
      | a results folder whose offline.json is not valid JSON  | offline.json is not valid   |

  # --- Retention -----------------------------------------------------------------------------------------------------------

  Scenario: Old runs beyond the retention limit are removed from the index and the bucket
    Given a results folder holding the offline and browser reports of a real run
    When I publish the results at "2026-09-21T04:30:12Z" from commit "aaaaaaa" as "local"
    And I publish the results at "2026-09-22T09:00:00Z" from commit "bbbbbbb" as "local"
    And I publish the results at "2026-09-23T09:00:00Z" from commit "ccccccc" as "local" keeping only 2 runs
    Then the index should list these runs, newest first:
      | 2026-09-23T09-00-00Z-ccccccc-local |
      | 2026-09-22T09-00-00Z-bbbbbbb-local |
    And no object of the run "2026-09-21T04-30-12Z-aaaaaaa-local" should remain in the bucket
    And every object of the run "2026-09-22T09-00-00Z-bbbbbbb-local" should still be in the bucket

  Scenario: Pruning by hand keeps the newest runs
    Given a results folder holding the offline and browser reports of a real run
    When I publish the results at "2026-09-21T04:30:12Z" from commit "aaaaaaa" as "local"
    And I publish the results at "2026-09-22T09:00:00Z" from commit "bbbbbbb" as "local"
    And I run the results command "prune --keep 1"
    Then the command should succeed and say "pruned 1 run"
    And the index should list these runs, newest first:
      | 2026-09-22T09-00-00Z-bbbbbbb-local |

  # --- Where a run was started from, and where it ran -------------------------------------------------------------------

  Scenario Outline: A run records where it was started from and where it ran; its id still ends with its kind
    Given a results folder holding the offline and browser reports of a real run
    When I publish the results at "2026-09-21T04:30:12Z" from commit "e786ff8" as "<kind>", started from "<from>" and run in "<target>"
    Then the run's summary and its index entry should say source "<source>" and target "<ran in>"
    And the newest run's id should end with "-<kind>"

    Examples:
      | kind  | from           | target         | source         | ran in         |
      | ci    |                |                | GitHub         | GitHub CI      |
      | ci    | localhost:4321 | GitHub CI      | localhost:4321 | GitHub CI      |
      | local |                |                | local          | local checkout |
      | local | localhost:4321 | local checkout | localhost:4321 | local checkout |
      | ci    | <b>x</b>       | GitHub CI      | GitHub         | GitHub CI      |

  Scenario: The publish command takes where the run was started from and ran from the environment, as Run in CI sets it
    Given a results folder holding the offline and browser reports of a real run
    When I run the results command "publish --source ci" with RESULTS_FROM "localhost:4321" and RESULTS_TARGET "GitHub CI"
    Then the run's summary and its index entry should say source "localhost:4321" and target "GitHub CI"

  Scenario: CI says where a run was started from: the host that started it by hand, else (empty) the GitHub event
    Then the CI workflow should take a "source" input when started by hand
    And it should publish with RESULTS_FROM set to that input and RESULTS_TARGET "GitHub CI"

  Scenario Outline: A run says where it was started from, wherever it runs
    Then a run started with <environment> should say it was started from "<source>"

    Examples:
      | environment                                    | source                       |
      | RESULTS_FROM "localhost:4321"                  | localhost:4321               |
      | GitHub's "push" event                          | GitHub push                  |
      | GitHub's "pull_request" event                  | GitHub pull request          |
      | GitHub's "schedule" event                      | GitHub schedule              |
      | GitHub's "workflow_dispatch" event             | GitHub manual run            |
      | nothing, on the computer "MBP-M3.local"        | MBP-M3.local (terminal)      |
      | RESULTS_FROM "<script>", on "MBP-M3.local"     | MBP-M3.local (terminal)      |

  Scenario: A run of only the smoke check says it tested the live site
    Given a results folder with only a smoke result of 10 checks where "robots.txt points at the real sitemap" failed with "sitemap host differs"
    When I publish the results at "2026-09-21T04:30:12Z" from commit "e786ff8" as "ci"
    Then the run's summary and its index entry should say source "GitHub" and target "example.test"

  Scenario: Runs stored before they recorded it get a source and target from what they can still tell
    Given a results folder holding the offline and browser reports of a real run
    When I publish the results at "2026-09-21T04:30:12Z" from commit "aaaaaaa" as "local"
    And I publish the results at "2026-09-22T09:00:00Z" from commit "bbbbbbb" as "ci"
    And the stored runs lose their source and target, as before
    And I label the stored test runs, only saying what would change
    Then the stored runs should still have no target
    When I label the stored test runs
    Then the stored run "2026-09-22T09-00-00Z-bbbbbbb-ci" should say source "GitHub" and target "GitHub CI"
    And the stored run "2026-09-21T04-30-12Z-aaaaaaa-local" should say source "this computer (terminal)" and target "local checkout"
    And latest.json should say source "GitHub" and target "GitHub CI"
    When I label the stored test runs
    Then labelling should find every run already labelled

  Scenario: Run in CI passes this page's host to GitHub, and the run records it with its target
    When the local results service at "localhost:4321" is asked to run every test in CI on the branch "main"
    Then GitHub should have been asked to start the run with the input source "localhost:4321"
    And the service should say the CI run came from "localhost:4321" and runs in "GitHub CI"

  Scenario: Run in CI's local checkout runs every test on this computer, recording where it came from and ran
    When the local results service at "localhost:4321" is asked to run every test in the local checkout
    Then the tests should have been recorded locally once, from "localhost:4321" in "local checkout"
    And the service should say the local run is going, on this checkout's branch "QA-feature_x"
    When the local run ends with exit code 0 after printing "✓ all suites passed"
    And the service is asked how the CI run is going
    Then the service should say the CI run finished with "success"

  Scenario: One test run at a time from here, wherever it runs
    When the local results service at "localhost:4321" is asked to run every test in the local checkout
    And the local results service at "localhost:4321" is asked to run every test in CI on the branch "main"
    Then it should answer 409 with the error "busy"
    And the CI workflow should not have been started

  Scenario: A local run a dev server restart cut off ends as interrupted
    When the local results service at "localhost:4321" is asked to run every test in the local checkout
    And the dev server restarts
    And the service is asked how the CI run is going
    Then the service should say the CI run finished with "interrupted"

  Scenario: Builds never share the dev server's Vite cache
    Then the dev server should keep its Vite cache in "node_modules/.vite" and every build in "node_modules/.vite-build"

  # --- Removing runs on demand (the Admin page's Remove Results) ---------------------------------------------------------------

  Scenario: Removing runs takes them off the index first, then deletes their files, and leaves the others alone
    Given a results folder holding the offline and browser reports of a real run
    When I publish the results at "2026-09-21T04:30:12Z" from commit "aaaaaaa" as "local"
    And I publish the results at "2026-09-22T09:00:00Z" from commit "bbbbbbb" as "local"
    And I publish the results at "2026-09-23T09:00:00Z" from commit "ccccccc" as "local"
    And I remove the runs "2026-09-21T04-30-12Z-aaaaaaa-local, 2026-09-22T09-00-00Z-bbbbbbb-local"
    Then the removal should report removed "2026-09-21T04-30-12Z-aaaaaaa-local, 2026-09-22T09-00-00Z-bbbbbbb-local" and nothing missing or failed
    And the index should list these runs, newest first:
      | 2026-09-23T09-00-00Z-ccccccc-local |
    And no object of the run "2026-09-21T04-30-12Z-aaaaaaa-local" should remain in the bucket
    And no object of the run "2026-09-22T09-00-00Z-bbbbbbb-local" should remain in the bucket
    And every object of the run "2026-09-23T09-00-00Z-ccccccc-local" should still be in the bucket
    And latest.json should name the run "2026-09-23T09-00-00Z-ccccccc-local"

  Scenario: Removing runs deletes their files several at a time, not one by one
    Given a results folder holding the offline and browser reports of a real run
    When I publish the results at "2026-09-21T04:30:12Z" from commit "aaaaaaa" as "local"
    And I publish the results at "2026-09-22T09:00:00Z" from commit "bbbbbbb" as "local"
    And I publish the results at "2026-09-23T09:00:00Z" from commit "ccccccc" as "local"
    And every delete from the bucket takes 100 ms
    And I remove the runs "2026-09-21T04-30-12Z-aaaaaaa-local, 2026-09-22T09-00-00Z-bbbbbbb-local, 2026-09-23T09-00-00Z-ccccccc-local"
    Then the removal should report removed "2026-09-21T04-30-12Z-aaaaaaa-local, 2026-09-22T09-00-00Z-bbbbbbb-local, 2026-09-23T09-00-00Z-ccccccc-local" and nothing missing or failed
    And the index should list no runs
    And no object of the run "2026-09-21T04-30-12Z-aaaaaaa-local" should remain in the bucket
    And no object of the run "2026-09-22T09-00-00Z-bbbbbbb-local" should remain in the bucket
    And no object of the run "2026-09-23T09-00-00Z-ccccccc-local" should remain in the bucket
    And the bucket should have been deleting more than 1 file at once, but never more than 8
    And the removal should have taken less than half as long as deleting the files one by one

  Scenario: Removing the newest run makes the next one the latest
    Given a results folder holding the offline and browser reports of a real run
    When I publish the results at "2026-09-22T09:00:00Z" from commit "bbbbbbb" as "local"
    And I publish the results at "2026-09-23T09:00:00Z" from commit "ccccccc" as "local"
    And I remove the runs "2026-09-23T09-00-00Z-ccccccc-local"
    Then latest.json should name the run "2026-09-22T09-00-00Z-bbbbbbb-local"
    And latest.json should be that run's own summary

  Scenario: Removing every run leaves an empty index and no latest pointer
    Given a results folder holding the offline and browser reports of a real run
    When I publish the results at "2026-09-23T09:00:00Z" from commit "ccccccc" as "local"
    And I remove the runs "2026-09-23T09-00-00Z-ccccccc-local"
    Then the index should list no runs
    And the bucket should hold nothing but the empty index

  Scenario: A run that isn't in the index is reported as missing and changes nothing
    Given a results folder holding the offline and browser reports of a real run
    When I publish the results at "2026-09-23T09:00:00Z" from commit "ccccccc" as "local"
    And I remove the runs "2020-01-01T00-00-00Z-nothing-local"
    Then the removal should report removed "" and missing "2020-01-01T00-00-00Z-nothing-local"
    And every object of the run "2026-09-23T09-00-00Z-ccccccc-local" should still be in the bucket

  Scenario: A run whose files can't all be deleted is still off the index, and reported, so removing it again is safe
    Given a results folder holding the offline and browser reports of a real run
    When I publish the results at "2026-09-22T09:00:00Z" from commit "bbbbbbb" as "local"
    And I publish the results at "2026-09-23T09:00:00Z" from commit "ccccccc" as "local"
    And deleting "bbbbbbb" fails in the bucket
    And I remove the runs "2026-09-22T09-00-00Z-bbbbbbb-local"
    Then the removal should report the run "2026-09-22T09-00-00Z-bbbbbbb-local" as failed
    And the index should list these runs, newest first:
      | 2026-09-23T09-00-00Z-ccccccc-local |

  Scenario Outline: The local results service answers only the Admin page on localhost, and only with run ids
    Given a results folder holding the offline and browser reports of a real run
    When I publish the results at "2026-09-23T09:00:00Z" from commit "ccccccc" as "local"
    And the local results service gets <request>
    Then it should answer <status> with <answer>

    Examples:
      | request                                                                                    | status | answer                    |
      | GET /__results/status on localhost                                                         | 200    | {"ok":true}               |
      | GET /__results/status on example.com                                                       | 403    | the error "not-local"     |
      | POST /__results/remove on localhost from another site, removing "2026-09-23T09-00-00Z-ccccccc-local" | 403 | the error "not-local" |
      | POST /__results/remove on localhost from its own page, removing "../../index.json"          | 400    | the error "bad-request"   |
      | POST /__results/remove on localhost from its own page, removing nothing                    | 400    | the error "bad-request"   |
      | POST /__results/remove on localhost from its own page, removing 101 runs                   | 400    | the error "bad-request"   |
      | POST /__results/remove on localhost from its own page, removing "2026-09-23T09-00-00Z-ccccccc-local" | 200 | the run removed |

  Scenario: Run in CI starts the CI workflow on main and follows it until GitHub says it is done
    When the local results service is asked to run every test in CI, and GitHub names the run 4242
    Then the service should answer 202 with the CI run 4242 on "main", queued
    And the CI workflow should have been started once
    When GitHub says the CI run is "in_progress"
    And the service is asked how the CI run is going
    Then the service should say the CI run is "in_progress", not finished
    When GitHub says the CI run is "completed" with "failure"
    And the service is asked how the CI run is going
    Then the service should say the CI run finished with "failure"

  Scenario: Only one CI run at a time from here; asking again while it goes answers with that run
    When the local results service is asked to run every test in CI, and GitHub names the run 4242
    And the local results service is asked to run every test in CI, and GitHub names the run 4243
    Then the service should answer 409 with the error "busy" and the CI run 4242
    And the CI workflow should have been started once
    When GitHub says the CI run is "completed" with "success"
    And the local results service is asked to run every test in CI, and GitHub names the run 4243
    Then the service should answer 202 with the CI run 4243 on "main", queued

  Scenario: A run GitHub doesn't name when it starts is looked for until GitHub lists it, then followed to the end
    Given GitHub doesn't name the CI run when it starts
    When the local results service is asked to run every test in CI, and GitHub names the run 0
    And the service is asked how the CI run is going
    Then the service should say the CI run is not found yet, still "queued"
    When GitHub lists the CI run as 5150
    And GitHub says the CI run is "in_progress"
    And the service is asked how the CI run is going
    Then the service should say it is following the CI run 5150, "in_progress"
    When GitHub says the CI run is "completed" with "success"
    And the service is asked how the CI run is going
    Then the service should say the CI run finished with "success"

  Scenario: A run GitHub never lists ends as not found, never as done
    Given GitHub never lists the CI run, and the service looks for it for 50 ms
    When the local results service is asked to run every test in CI, and GitHub names the run 0
    And the service is asked how the CI run is going
    Then the service should say the CI run is not found yet, still "queued"
    When 80 ms pass
    And the service is asked how the CI run is going
    Then the service should say the CI run finished with "not-found"

  Scenario: A dev server restart goes on following the CI run it was following
    When the local results service is asked to run every test in CI, and GitHub names the run 4242
    And the dev server restarts
    And GitHub says the CI run is "in_progress"
    And the service is asked how the CI run is going
    Then the service should say it is following the CI run 4242, "in_progress"
    When GitHub says the CI run is "completed" with "failure"
    And the service is asked how the CI run is going
    Then the service should say the CI run finished with "failure"

  Scenario: Run in CI lists the branches on GitHub, and the branch this checkout is on
    When the local results service is asked which branches CI can run on
    Then it should list the branches "QA-feature_x, main", with "QA-feature_x" as this checkout's, "on GitHub"

  Scenario: A checkout on a branch that isn't on GitHub yet is named as such
    Given this checkout is on the branch "QA-not-pushed", which is not on GitHub
    When the local results service is asked which branches CI can run on
    Then it should list the branches "QA-feature_x, main", with "QA-not-pushed" as this checkout's, "not on GitHub"

  Scenario: Run in CI starts on the branch chosen
    When the local results service is asked to run every test in CI on the branch "QA-feature_x"
    Then the CI run should have been started on the branch "QA-feature_x"

  Scenario Outline: Run in CI only starts on a branch GitHub has, named plainly
    When the local results service is asked to run every test in CI on the branch "<branch>"
    Then it should answer 400 with the error "<error>"
    And the CI workflow should not have been started

    Examples:
      | branch        | error         |
      | QA-not-pushed | not-on-github |
      | --upload-pack | bad-request   |
      | main; rm -rf  | bad-request   |

  Scenario: Run in CI says why the workflow could not be started
    When the local results service is asked to run every test in CI, and gh fails with "HTTP 422: Workflow does not have 'workflow_dispatch' trigger"
    Then it should answer 502 with the error "ci-failed"

  Scenario: Run in CI only takes requests from the Admin page itself
    When another site asks the local results service to run every test in CI
    Then it should answer 403 with the error "not-local"
    And the CI workflow should not have been started

  Scenario: Run in CI starts ci.yml on the chosen branch with the GitHub CLI, and lists branches without changing anything
    Then the local results service should start CI with "gh workflow run ci.yml --ref <branch>" and follow it with "gh run view"
    And it should list the branches with "git ls-remote --heads origin" and this checkout's with "git rev-parse --abbrev-ref HEAD"

  Scenario: The service is part of the dev server only, never of the built site
    Then the dev server's integrations should include the results service
    And the built site should hold nothing under "/__results/"

  # --- Trends --------------------------------------------------------------------------------------------------------------------

  Scenario: A scenario that fails only sometimes is called flaky, and one that always fails is not
    Given these runs, oldest first, where "Checkout flow" and "Login" fail as shown:
      | run | Checkout flow | Login |
      | 1   | fail          | fail  |
      | 2   | pass          | fail  |
      | 3   | fail          | fail  |
      | 4   | pass          | fail  |
    When I look at the trend over the last 4 runs
    Then the trend should say "Login" failed in 4 of 4 runs, is failing now and is not flaky
    And the trend should say "Checkout flow" failed in 2 of 4 runs, is passing now and is flaky

  Scenario: A clean history has no trend to report
    Given these runs, oldest first, where "Checkout flow" and "Login" fail as shown:
      | run | Checkout flow | Login |
      | 1   | pass          | pass  |
      | 2   | pass          | pass  |
    When I look at the trend over the last 2 runs
    Then the trend should list no failures

  # --- The command line ---------------------------------------------------------------------------------------------------------------

  Scenario: Publishing from the command line reports what it stored
    Given a results folder holding the offline and browser reports of a real run
    When I run the results command "publish --source local"
    Then the command should succeed and say "published 2026-09-21T04-30-12Z-e786ff8-local: 6/12 passed, 4 failed"
    And the results output should mention "photography-site-test/results/runs/2026-09-21T04-30-12Z-e786ff8-local/"

  Scenario: Listing shows recent runs with their outcome, and says so when there are none
    When I run the results command "list"
    Then the command should succeed and say "No runs yet"
    Given a results folder holding the offline and browser reports of a real run
    When I publish the results at "2026-09-21T04:30:12Z" from commit "aaaaaaa" as "local"
    And I run the results command "list"
    Then the command should succeed and say "2026-09-21T04-30-12Z-aaaaaaa-local"
    And the results output should mention "6/12"
    And the results output should mention "failing: 4"

  Scenario: Showing a run lists its failures; an unknown run is an error
    Given a results folder holding the offline and browser reports of a real run
    When I publish the results at "2026-09-21T04:30:12Z" from commit "aaaaaaa" as "local"
    And I run the results command "show latest"
    Then the command should succeed and say "Fails halfway"
    And the results output should mention "boom: expected 1 to equal 2"
    When I run the results command "show 1999-01-01T00-00-00Z-nothing-local"
    Then the command should fail saying "No run"

  Scenario: Publishing with no results folder fails with the way to make one
    When I run the results command "publish" with no results folder
    Then the command should fail saying "npm run test:record"

  Scenario: Help is shown, and an unknown command fails
    When I run the results command "help"
    Then the command should succeed and say "photography-site-test"
    When I run the results command "frobnicate"
    Then the command should fail saying "Test results in R2"

  # --- The real R2 adapter ---------------------------------------------------------------------------------------

  Scenario: A missing object is recognised from wrangler's real output, wherever its ERROR line lands
    Given wrangler failed with the real output for a missing object
    Then the failure should be recognised as a missing object
    And the failure's reason should be "The specified key does not exist."

  Scenario Outline: Genuine problems are not mistaken for a missing object
    Given wrangler failed with the real output for <problem>
    Then the failure should not be recognised as a missing object
    And the failure's reason should mention "<reason>"

    Examples:
      | problem                          | reason                       |
      | an authentication failure        | Authentication error         |
      | an unreachable network           | fetch failed                 |

  # --- The runner and configuration -------------------------------------------------------------------------------------------------------

  Scenario Outline: The test runner plans the right suites and reporters
    Then planning a test run with arguments "<arguments>" should run "<suites>" and publish "<publish>"

    Examples:
      | arguments                | suites          | publish |
      |                          | offline,browser | yes     |
      | --suite offline          | offline         | yes     |
      | --suite browser          | browser         | yes     |
      | --no-publish             | offline,browser | no      |
      | --suite all --no-publish | offline,browser | no      |

  Scenario: Every planned suite writes both a JSON and an HTML report where the publisher looks
    Then every planned suite should write "<name>.json" and "<name>.html" into the results folder

  Scenario: An unknown suite is refused
    Then planning a test run with the suite "smoke-test" should fail saying "Unknown suite"

  Scenario: The results go to the right bucket and stay out of git
    Then the results bucket should be "photography-site-test" with the prefix "results/"
    And it should not be either of the photo buckets
    And the test-results folder should be ignored by git
    And no page, header or site code should reference the results bucket, so it stays private

  Scenario: The GitHub workflows publish results only when the R2 credentials are configured
    Then the CI workflow should write JSON and HTML reports for both suites
    And the CI workflow should publish the results, even after failures, only when the R2 secrets exist
    And the smoke workflow should save and publish its result only when the R2 secrets exist

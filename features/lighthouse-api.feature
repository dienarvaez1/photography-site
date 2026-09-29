Feature: The results API serves the Lighthouse runs safely, behind the admin token
  As the site owner
  I want the Admin page's Lighthouse Test Results tab to read the runs from the private bucket through the results API
  So that the runs stay private and only someone with the admin token can see them

  These scenarios call the real request handler (workers/results-api) with Lighthouse runs published by the real
  publisher into a fake bucket, so the stored format and the API agree.

  Background:
    Given a results API with the admin token "correct-admin-token-123" and these Lighthouse runs:
      | time                 | commit  | phone performance | laptop performance |
      | 2026-09-28T10:00:00Z | aaaaaaa | 60                | 98                 |
      | 2026-09-29T10:00:00Z | bbbbbbb | 91                | 98                 |

  # --- The entry points ---------------------------------------------------------------------------------------

  Scenario: The index of Lighthouse runs is served, newest first
    When I call the Lighthouse route "/lighthouse/index" with the admin token
    Then the Lighthouse response should be 200 and be exactly the stored "lighthouse-results/index.json"
    And it should list the Lighthouse runs, newest first, for the commits "bbbbbbb, aaaaaaa"

  Scenario: The newest run's summary is served
    When I call the Lighthouse route "/lighthouse/latest" with the admin token
    Then the Lighthouse response should be 200 and be exactly the stored "lighthouse-results/latest.json"

  Scenario: One run is served with a signed link to each of its files, on the API's own address
    When I call the newest Lighthouse run with the admin token
    Then the Lighthouse response should be 200 with the summary of commit "bbbbbbb"
    And there should be a signed Lighthouse link for "index.html", "mobile-home.html", "desktop-home.html" and "summary.json", valid for 900 seconds

  Scenario: With no Lighthouse runs yet, the index is empty and there is no latest run
    Given no Lighthouse run has been published
    When I call the Lighthouse route "/lighthouse/index" with the admin token
    Then the Lighthouse response should be 200 and list no runs
    When I call the Lighthouse route "/lighthouse/latest" with the admin token
    Then the Lighthouse response should be 404 with the error "not-found"

  # --- The admin token ---------------------------------------------------------------------------------------

  Scenario Outline: Every Lighthouse route but the signed files needs the admin token
    When I call the Lighthouse route "<route>" <how>
    Then the Lighthouse response should be <status> with the error "<error>"
    And the bucket should not have been asked for any Lighthouse run

    Examples:
      | route                                             | how                           | status | error        |
      | /lighthouse/index                                 | with no token                 | 401    | unauthorized |
      | /lighthouse/latest                                | with the token "wrong-token-xyz-123" | 401 | unauthorized |
      | /lighthouse/runs/2026-09-29T10-00-00Z-bbbbbbb-local | with no token               | 401    | unauthorized |

  Scenario: Without an admin token set up, the Lighthouse routes refuse everything
    Given the Lighthouse API has no admin token set
    When I call the Lighthouse route "/lighthouse/index" with the admin token
    Then the Lighthouse response should be 503 with the error "not-configured"

  Scenario Outline: Malformed run ids and unknown routes are refused
    When I call the Lighthouse route "<route>" with the admin token
    Then the Lighthouse response should be <status> with the error "<error>"

    Examples:
      | route                                     | status | error       |
      | /lighthouse/runs/not-a-run                | 400    | bad-request |
      | /lighthouse/runs/2020-01-01T00-00-00Z-nope-local | 404 | not-found |
      | /lighthouse/everything                    | 404    | not-found   |
      | /lighthouse/files/not-a-run/index.html    | 400    | bad-request |

  # --- Signed report links -----------------------------------------------------------------------------------

  Scenario: A signed link opens a report, sandboxed and uncached
    When I open the signed Lighthouse link for "mobile-home.html" of the newest run
    Then the Lighthouse response should be 200 with the content type "text/html; charset=utf-8"
    And it should be exactly the stored report, sandboxed and never cached

  Scenario: The run's index page is served with its report links signed, and those links work
    When I open the signed Lighthouse link for "index.html" of the newest run
    Then the Lighthouse response should be 200 with the content type "text/html; charset=utf-8"
    And every report link on the index page should be a signed Lighthouse link on the API's own address
    When I follow the index page's link to "mobile-home.html"
    Then the Lighthouse response should be 200 with the content type "text/html; charset=utf-8"

  Scenario Outline: A link that is expired, tampered with or meant for the test results is refused
    When I open the signed Lighthouse link for "mobile-home.html" of the newest run, but <problem>
    Then the Lighthouse response should be 403 with the error "<error>"

    Examples:
      | problem                                        | error     |
      | an hour later                                  | expired   |
      | with a changed signature                       | forbidden |
      | with the signature of a test-results link      | forbidden |

  Scenario: A Lighthouse link does not open a test-results file, and the reverse
    When I open a Lighthouse-signed link on the test results' file route
    Then the Lighthouse response should be 403 with the error "forbidden"

  Scenario: The API only ever reads the Lighthouse runs under lighthouse-results/
    When I call the Lighthouse route "/lighthouse/index" with the admin token
    And I call the newest Lighthouse run with the admin token
    And I open the signed Lighthouse link for "mobile-home.html" of the newest run
    Then the bucket should not have been asked for anything outside "lighthouse-results/" for Lighthouse

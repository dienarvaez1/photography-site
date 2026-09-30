Feature: The results API serves the site's GitHub issues, behind the admin token
  As the site owner
  I want the Admin page's GitHub Issues tab to read the site's issues from GitHub through the results API
  So that I can see what's open next to the test results, without GitHub being asked by anyone without the token

  These scenarios call the real request handler (workers/results-api) with a stand-in for GitHub's API that answers
  the way GitHub does, pull requests included.

  Background:
    Given a results API with the admin token "correct-admin-token-123" for the repository "owner/site", where GitHub has:
      | number | title                          | state       | labels          | author | comments | updated              | kind         |
      | 1      | Hero photo loads slowly        | open        | bug, performance | diego  | 2        | 2026-09-25T10:00:00Z | issue        |
      | 2      | Add a Birds category           | open        | enhancement     | diego  | 0        | 2026-09-28T10:00:00Z | issue        |
      | 3      | Footer email typo              | closed      | bug             | diego  | 1        | 2026-09-20T10:00:00Z | issue        |
      | 4      | Dark mode for the lightbox     | not planned |                 | guest  | 3        | 2026-09-10T10:00:00Z | issue        |
      | 5      | Fix the footer                 | open        |                 | diego  | 0        | 2026-09-29T10:00:00Z | pull request |

  Scenario: The open issues are served, newest-updated first, without the pull requests
    When I call the issues route "/github/issues" with the admin token
    Then the issues response should be 200, for the repository "owner/site", listing issues "2, 1"
    And the issues list should be complete

  Scenario Outline: Each state shows its own issues
    When I call the issues route "/github/issues?state=<state>" with the admin token
    Then the issues response should be 200, for the repository "owner/site", listing issues "<issues>"

    Examples:
      | state  | issues     |
      | open   | 2, 1       |
      | closed | 3, 4       |
      | all    | 2, 1, 3, 4 |

  Scenario: Only what the tab shows is passed on, and a closed issue says why it was closed
    When I call the issues route "/github/issues?state=all" with the admin token
    Then issue 1 should be passed on as open, by "diego", with 2 comments, the labels "bug, performance" and a link to "https://github.com/owner/site/issues/1"
    And issue 4 should be passed on as closed, not planned
    And no issue should carry its body

  Scenario: GitHub is asked once, for the configured repository, as a read-only JSON client
    When I call the issues route "/github/issues?state=closed" with the admin token
    Then GitHub should have been asked once for "https://api.github.com/repos/owner/site/issues?state=closed&sort=updated&direction=desc&per_page=100"
    And GitHub should have been asked without a GitHub token

  Scenario: With a GitHub token set, GitHub is asked with it
    Given the results API has the GitHub token "github_pat_example"
    When I call the issues route "/github/issues" with the admin token
    Then GitHub should have been asked with the GitHub token "github_pat_example"

  Scenario: A full page from GitHub says there may be more
    Given GitHub has 100 more open issues
    When I call the issues route "/github/issues" with the admin token
    Then the issues list should not be complete

  # --- The admin token ---------------------------------------------------------------------------------------

  Scenario Outline: The issues need the admin token, and GitHub isn't asked without it
    When I call the issues route "/github/issues" <how>
    Then the issues response should be <status> with the error "<error>"
    And GitHub should not have been asked

    Examples:
      | how                                  | status | error        |
      | with no token                        | 401    | unauthorized |
      | with the token "wrong-token-xyz-123" | 401    | unauthorized |

  Scenario: Without an admin token set up, the issues route refuses
    Given the results API has no admin token set for the issues
    When I call the issues route "/github/issues" with the admin token
    Then the issues response should be 503 with the error "not-configured"
    And GitHub should not have been asked

  # --- Things going wrong ------------------------------------------------------------------------------------

  Scenario Outline: Bad requests and GitHub's problems are answered with their own errors
    Given GitHub is <condition>
    When I call the issues route "<route>" with the admin token
    Then the issues response should be <status> with the error "<error>"

    Examples:
      | condition    | route                          | status | error        |
      | answering    | /github/issues?state=everything | 400   | bad-request  |
      | answering    | /github/pulls                  | 404    | not-found    |
      | rate-limited | /github/issues                 | 429    | rate-limited |
      | down         | /github/issues                 | 502    | upstream     |
      | unreachable  | /github/issues                 | 502    | upstream     |

  Scenario: Without a repository configured, the route says so and GitHub isn't asked
    Given the results API has no repository configured
    When I call the issues route "/github/issues" with the admin token
    Then the issues response should be 500 with the error "misconfigured"
    And GitHub should not have been asked

  Scenario: The Worker's configuration names this site's repository
    Then the results Worker's configuration should read the issues of "dienarvaez1/photography-site"

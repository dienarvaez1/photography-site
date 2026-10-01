@browser
Feature: The Admin page's GitHub Issues tab lists the site's issues, behind the admin token
  As the site owner
  I want a tab that shows the site's GitHub issues next to its test results
  So that I can see what's open, and get to it on GitHub, from the same place

  The tab reads the issues through the real results API code, which asks a stand-in for GitHub's API holding made-up
  issues (and a pull request, which the tab never shows).

  Background:
    Given the results API holds the admin token "browser-test-admin-token" and these published runs:
      | time                 | commit  | offline results | browser results | smoke | artifacts |
      | 2026-09-21T10:00:00Z | ccccccc | 3 passed        |                 |       |           |
    And GitHub holds these issues of "owner/site":
      | number | title                   | state       | labels           | author | comments | updated              | kind         |
      | 1      | Hero photo loads slowly | open        | bug, performance | diego  | 2        | 2026-09-25T10:00:00Z | issue        |
      | 2      | Add a Birds category    | open        | enhancement      | diego  | 0        | 2026-09-28T10:00:00Z | issue        |
      | 3      | Footer email typo       | closed      | bug              | diego  | 1        | 2026-09-20T10:00:00Z | issue        |
      | 4      | Dark mode for lightbox  | not planned |                  | guest  | 3        | 2026-09-10T10:00:00Z | issue        |
      | 5      | Fix the footer          | open        |                  | diego  | 0        | 2026-09-29T10:00:00Z | pull request |

  Scenario: The tab asks for the admin token before showing or requesting anything
    When I open "/admin/#github-issues"
    Then the GitHub Issues tab should ask for the admin token
    And the results API should not have been asked for the issues

  Scenario: Signing in shows the open issues, newest-updated first, each linked to GitHub in a new tab
    When I open "/admin/#github-issues"
    And I sign in to the GitHub Issues tab with the token "browser-test-admin-token"
    Then the GitHub Issues tab should list "#2 Add a Birds category, #1 Hero photo loads slowly"
    And the GitHub Issues tab should say "2 issues"
    And issue 1 should show "Open", "Comments: 2" and the labels "bug, performance"
    And every issue should link to GitHub in a new tab
    And the tab should link to "New issue" at "https://github.com/owner/site/issues/new"

  Scenario: The filter shows the closed issues, or all of them
    When I open "/admin/#github-issues"
    And I sign in to the GitHub Issues tab with the token "browser-test-admin-token"
    And I show the "Closed" issues
    Then the GitHub Issues tab should list "#3 Footer email typo, #4 Dark mode for lightbox"
    And issue 4 should show "Not planned", "Comments: 3" and no labels
    When I show the "All" issues
    Then the GitHub Issues tab should list "#2 Add a Birds category, #1 Hero photo loads slowly, #3 Footer email typo, #4 Dark mode for lightbox"

  Scenario: One sign-in serves every tab
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I click the "GitHub Issues" tab
    Then the GitHub Issues tab should list "#2 Add a Birds category, #1 Hero photo loads slowly"

  Scenario: With no open issues, the tab says so
    Given GitHub holds no open issues
    When I open "/admin/#github-issues"
    And I sign in to the GitHub Issues tab with the token "browser-test-admin-token"
    Then the GitHub Issues tab should say "No open issues."

  Scenario Outline: GitHub's problems are explained, and the tab stays signed in
    Given GitHub is <condition> for the Admin page
    When I open "/admin/#github-issues"
    And I sign in to the GitHub Issues tab with the token "browser-test-admin-token"
    Then the GitHub Issues tab should say "<message>"
    And the Open, Closed and All filter should still be offered

    Examples:
      | condition    | message                                  |
      | rate-limited | GitHub's rate limit was reached.         |
      | unreachable  | GitHub did not answer as expected.       |

  Scenario: The tab speaks Spanish on the Spanish page
    When I open "/es/admin/#github-issues"
    And I sign in to the GitHub Issues tab with the token "browser-test-admin-token"
    Then the GitHub Issues tab should say "2 incidencias"
    And issue 1 should show "Abierta", "Comentarios: 2" and the labels "bug, performance"

  Scenario Outline: The list passes the automated accessibility audit, and doesn't scroll sideways on a phone
    Given the visitor uses a <device>
    When I open "/admin/#github-issues"
    And I sign in to the GitHub Issues tab with the token "browser-test-admin-token"
    And I show the "All" issues
    Then the page should pass the automated accessibility audit
    And the page should not scroll sideways

    Examples:
      | device |
      | laptop |
      | phone  |

  Scenario: Using the tab causes no script errors and no policy violations
    When I open "/admin/#github-issues"
    And I sign in to the GitHub Issues tab with the token "browser-test-admin-token"
    And I show the "All" issues
    Then no script error should have been logged
    And no Content-Security-Policy violation should have been reported

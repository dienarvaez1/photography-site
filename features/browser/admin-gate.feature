@browser
Feature: The Admin page shows nothing but the token box until the admin token is accepted
  As the site owner
  I want the Admin page to show only a token box and its button until the token has been checked
  So that nobody without the token sees its tabs, their titles or their descriptions, let alone their data

  The token is checked against the real results API code (GET /auth). The tabs are hidden in the page's own HTML and
  revealed by script only after that check, so they stay hidden without JavaScript too.

  Scenario Outline: Until the admin token is accepted, the page shows only the token box, whichever tab is asked for
    When I open "/admin/#<tab>"
    Then the page should offer only the admin token box and its button
    And the results API should not have been asked for anything
    And no local service or API should have been asked for anything

    Examples:
      | tab                  |
      | access-info          |
      | test-results         |
      | lighthouse-results   |
      | pics-viewer          |
      | category-maintenance |
      | github-issues        |

  Scenario: A wrong token is refused and the tabs stay hidden; the right one shows them, on the tab that was asked for
    Given the results API holds the admin token "browser-test-admin-token" and no published runs
    When I open "/admin/#pics-viewer"
    And I sign in with the token "definitely-the-wrong-one"
    Then the token box should say "That token was not accepted."
    And the page should offer only the admin token box and its button
    When I sign in with the token "browser-test-admin-token"
    Then the "Pics Viewer" tab should be selected, its panel visible and every other panel hidden
    When I click "Sign out" at the top of the page
    Then the page should offer only the admin token box and its button

  Scenario: The keyboard reaches the token box, and Enter signs in
    Given the results API holds the admin token "browser-test-admin-token" and no published runs
    When I open "/admin/"
    And I type the token "browser-test-admin-token" into the focused token field and press Enter
    Then the "Access Info" tab should be selected, its panel visible and every other panel hidden

  Scenario: Without JavaScript the page says it needs JavaScript, and shows no tabs
    Given JavaScript is switched off
    When I open "/admin/"
    Then the token box should say "The Admin page needs JavaScript to check the admin token."
    And no tab, tab title or tab description should be shown

  Scenario: The token box passes the automated accessibility audit, in both languages
    When I open "/admin/"
    Then the page should pass the automated accessibility audit
    When I open "/es/admin/"
    Then the token box should say "Introduce el token de administración para continuar."
    And the page should pass the automated accessibility audit

  Scenario: A results API from before the sign-in existed is named as the problem, not a missing run (issue #6)
    Given the results API holds the admin token "browser-test-admin-token" and no published runs
    And the results API has no sign-in route yet
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    Then the token box should say "The results service can't check tokens yet: deploy it again with npm run results-api:deploy."
    And the page should offer only the admin token box and its button

  Scenario Outline: The token page is centred on a <device>, and the signed-in page is not
    Given the visitor uses a <device>
    And the results API holds the admin token "browser-test-admin-token" and these published runs:
      | time                 | commit  | offline results | browser results | smoke | artifacts |
      | 2026-09-21T10:00:00Z | ccccccc | 3 passed        |                 |       |           |
    When I open "/admin/"
    Then the token box should be centred across the page, between the header and the footer, with "ADMIN" and the title flush with its left edge
    When I sign in with the token "browser-test-admin-token"
    Then the title should be back at the left of the page

    Examples:
      | device |
      | laptop |
      | phone  |

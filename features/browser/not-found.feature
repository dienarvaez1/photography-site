@browser
Feature: A mistyped URL leads somewhere useful
  As a visitor who followed a broken link
  I want a clear message and a way back, in my language
  So that I don't hit a blank page

  Scenario Outline: An unknown address gets a real 404 status and the right page
    When I open the unknown address "<address>"
    Then the response status should be 404
    And the page language should be "<language>"
    And the page should show the "<language>" 404 message
    And the page should ask search engines not to index it

    Examples:
      | address                    | language |
      | /no-such-page/             | en       |
      | /work/no-such-category/    | en       |
      | /about/typo                | en       |
      | /es/no-such-page/          | es       |
      | /es/work/no-such-category/ | es       |

  Scenario Outline: The error page offers ways back that work
    When I open the unknown address "<address>"
    And I click the link "<link>"
    Then the page path should be "<destination>"
    And the response status should be 200

    Examples:
      | address           | link                    | destination           |
      | /nope/            | Back to the homepage    | /                     |
      | /nope/            | View the work           | /work/landscape/      |
      | /nope/            | Get in touch            | /contact/             |
      | /es/nope/         | Volver al inicio        | /es/                  |
      | /es/nope/         | Ver el trabajo          | /es/work/landscape/   |
      | /es/nope/         | Ponte en contacto       | /es/contact/          |

  Scenario: The language switcher on an error page goes to the other language's home page
    When I open the unknown address "/nope/"
    And I click the language switcher link "ES"
    Then the page path should be "/es/"
    And the response status should be 200

  Scenario: Real pages without a trailing slash are redirected, not treated as errors
    When I open "/about"
    Then the page path should be "/about/"
    And the response status should be 200

  Scenario: The error page loads with no errors under the security policy
    When I open the unknown address "/nope/"
    Then no Content-Security-Policy violation should have been reported
    And no script error should have been logged

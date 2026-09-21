@browser
Feature: Browser fixture

  Scenario: Fails on purpose
    When I open "/"
    Then this scenario fails on purpose

  Scenario: Passes
    When I open "/about/"
    Then the page path should be "/about/"

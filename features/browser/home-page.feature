@browser
Feature: The home page's hero tagline lines up with the About page's eyebrow
  As a visitor moving between the home page and the About page
  I want the site's tagline and the "About" label to sit at the same height
  So that the two pages feel like one consistent design, not two unrelated layouts

  Scenario: The tagline sits at the same height as the About page's eyebrow
    When I open "/"
    And I remember the tagline's height
    And I open "/about/"
    Then the About page's eyebrow should be at the remembered height

  Scenario: The same is true in Spanish
    When I open "/es/"
    And I remember the tagline's height
    And I open "/es/about/"
    Then the About page's eyebrow should be at the remembered height

  # --- Sections that fade in as they are scrolled to ---------------------------------------------------------------

  Scenario: A section already on screen when the page loads never fades, not even for a moment
    Given I watch every fading section's opacity while the page loads
    When I open "/"
    And I wait for the page to settle
    Then no section that was on screen should ever have been partly transparent

  Scenario: A section out of sight starts hidden without fading out, then fades in when scrolled to
    Given the browser window is 1280 by 420 pixels
    And I watch every fading section's opacity while the page loads
    When I open "/"
    And I wait for the page to settle
    Then the "Explore by Category" section should be out of sight and hidden
    And it should never have faded out
    When I scroll the "Explore by Category" section into view
    Then the "Explore by Category" section should become fully visible

  Scenario: The home page passes the accessibility audit even while its sections are still settling
    When I open "/"
    Then the page should pass the automated accessibility audit


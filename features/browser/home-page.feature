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

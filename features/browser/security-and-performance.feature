@browser
Feature: The security policy and the performance work, checked in a real browser
  As the site owner
  I want the Content-Security-Policy to be enforced without breaking anything, and images to load efficiently
  So that the strict policy and the responsive images really work for visitors

  # --- Content-Security-Policy ------------------------------------------------------------------------------

  Scenario: Every page loads under the real policy with no violations and no errors
    Then every page and both error pages should load with no Content-Security-Policy violation, no script error and no blocked request

  Scenario: The policy is actually being enforced by the browser
    When I open "/"
    Then the page should have been served with a Content-Security-Policy
    And an inline script injected into the page should be blocked and reported

  Scenario: Using the lightbox and the language switcher breaks nothing under the policy
    When I open "/work/nature/"
    And I click photo number 1
    And I press the key "ArrowRight"
    And I press the key "Escape"
    And I click the language switcher link "ES"
    Then no Content-Security-Policy violation should have been reported
    And no script error should have been logged

  # --- Responsive images ----------------------------------------------------------------------------------------

  Scenario Outline: The browser picks the right image size for its screen
    Given the visitor uses a <device>
    When I open "/work/nature/"
    Then the first gallery photo should have loaded the "<size>" size

    Examples:
      | device                        | size  |
      | laptop                        | w400  |
      | laptop with a sharp screen    | thumb |
      | phone                         | w1000 |

  Scenario: The photos in the first row are requested straight away
    When I open "/work/nature/"
    Then the first 3 gallery photos should have been requested

  Scenario: Category cards on the home page pick a sensible size too
    Given the visitor uses a phone
    When I open "/"
    And I scroll to the category cards
    Then the category card images should have loaded a size between 400 and 1000 pixels wide

  # --- Layout stability ------------------------------------------------------------------------------------------

  Scenario Outline: The page does not jump around while images arrive slowly
    Given every image takes 400 ms to arrive
    When I open "<page>" and wait for everything to load
    Then the layout shift score should be at most 0.02

    Examples:
      | page              |
      | /                 |
      | /es/              |
      | /work/nature/     |
      | /es/work/nature/  |
      | /contact/         |
      | /about/           |

  Scenario: The header keeps its size while its logos load on a phone
    Given the visitor uses a phone
    And every image takes 400 ms to arrive
    When I open "/" and wait for everything to load
    Then the layout shift score should be at most 0.02
    And the header should be as tall before the logos arrive as after

  Scenario Outline: The logos take up their final space before they have loaded
    Given the visitor uses a <device>
    And every image takes 400 ms to arrive
    When I open "/" and measure the header logos before they have loaded
    Then the header logos should occupy exactly the same space after they have loaded

    Examples:
      | device |
      | laptop |
      | phone  |

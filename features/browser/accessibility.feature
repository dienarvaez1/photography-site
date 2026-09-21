@browser
Feature: Accessibility, checked in a real browser
  As a visitor using a keyboard, a screen reader, a phone or reduced motion
  I want every page to meet WCAG 2 AA and to behave on my device
  So that nobody is locked out

  Scenario Outline: Every page passes the automated accessibility audit (axe, WCAG 2.0/2.1 A and AA)
    Given the visitor uses a <device>
    Then every page and both error pages should pass the automated accessibility audit

    Examples:
      | device |
      | laptop |
      | phone  |

  Scenario Outline: No page scrolls sideways
    Given the visitor uses a <device>
    Then no page and neither error page should scroll sideways

    Examples:
      | device |
      | laptop |
      | phone  |

  Scenario: Reduced-motion visitors get no meaningful transitions
    Given the visitor asks for reduced motion
    When I open "/work/nature/"
    Then transitions on the gallery should be effectively instant

  Scenario: Everyone else keeps the hover animation
    When I open "/work/nature/"
    Then transitions on the gallery should take a visible amount of time

  Scenario: Keyboard focus is always visible
    When I open "/contact/"
    And I press the key "Tab"
    And I press the key "Tab"
    Then the focused element should have a clearly visible outline

  Scenario: The contact form's fields are labelled and their boundaries are visible
    When I open "/contact/"
    Then every form field should have a visible label
    And every text field's border should stand out from the page by at least 3:1

  Scenario: The page can be zoomed to 200% without losing content
    Given the visitor uses a laptop
    When I open "/contact/" zoomed to 200 percent
    Then the contact form should still be fully visible without sideways scrolling

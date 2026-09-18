Feature: Accessibility and cross-browser compatibility
  As a visitor using a keyboard, a screen reader, or an older browser
  I want the site to remain usable and render correctly
  So that no one is silently locked out of navigating or reading the content

  Scenario: No built CSS uses the unsupported range media-query syntax
    Then no built CSS should use range media-query syntax

  Scenario: The header "Work" menu trigger is a real, keyboard-focusable button
    When I load the built page "/"
    Then the "Work" menu trigger should be a real button element

  Scenario: The lightbox dialog exposes proper ARIA semantics
    When I load the built page "/"
    Then the lightbox should declare dialog role and modal attributes

  Scenario Outline: Every image on every page has an alt attribute
    When I load the built page "<route>"
    Then every image on the page should have an alt attribute

    Examples:
      | route     |
      | /         |
      | /about/   |
      | /contact/ |

  Scenario: Every link that opens in a new tab is protected against tabnabbing
    When I load the built page "/contact/"
    Then every link that opens in a new tab should set rel to noopener and noreferrer

  Scenario: The site declares HTTPS security headers for deployment
    Then the deployment headers file should declare the baseline security headers

  Scenario: Every page declares a document language
    When I load the built page "/"
    Then the page should declare a non-empty html lang attribute

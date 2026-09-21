Feature: Accessibility and cross-browser compatibility (English and Spanish)
  As a visitor using a keyboard, a screen reader, or an older browser, in either language
  I want the site to remain usable and render correctly
  So that no one is silently locked out of navigating or reading the content

  Scenario: No built CSS uses the unsupported range media-query syntax
    Then no built CSS should use range media-query syntax

  Scenario: The header "Work" menu trigger is a real, keyboard-focusable button on every page
    When I load every built page
    Then the "Work" menu trigger should be a real button element on every page

  Scenario: The language switcher is an accessible, labelled group on every page
    When I load every built page
    Then the language switcher on every page should be a group labelled in its language

  Scenario: Every page with a photo gallery has an accessible, localized lightbox dialog
    When I load every built page
    Then every page with a gallery should have a lightbox with dialog semantics and controls labelled in its language

  Scenario: Every image on every page has an alt attribute
    When I load every built page
    Then every image on every page should have an alt attribute

  Scenario: Every link that opens in a new tab is protected against tabnabbing on every page
    When I load every built page
    Then every link that opens in a new tab on every page should set rel to noopener and noreferrer

  Scenario: The site declares HTTPS security headers for deployment
    Then the deployment headers file should declare the baseline security headers

  Scenario: Every page declares a document language matching its URL
    When I load every built page
    Then every page should declare an html lang attribute matching its URL's locale

  # --- Contrast (WCAG 2.x): 4.5:1 for text, 3:1 for the boundary of form fields ------------------

  Scenario Outline: Colours have enough contrast
    Then the colour "<foreground>" on "<background>" should have at least <minimum>:1 contrast

    Examples:
      | foreground    | background    | minimum |
      | --fg          | --bg          | 4.5     |
      | --fg-muted    | --bg          | 4.5     |
      | --fg-muted    | --bg-elevated | 4.5     |
      | --accent      | --bg          | 4.5     |
      | --accent-fg   | --accent      | 4.5     |
      | --lang-switch | --bg          | 4.5     |
      | --lang-switch-hover | --bg    | 4.5     |
      | --field-border | --bg-elevated | 3      |
      | --field-border | --bg          | 3      |
      | --accent      | --bg          | 3       |

  Scenario: Form fields use the high-contrast border, and keyboard focus stays visible
    Then the contact form's fields should use the high-contrast border colour
    And the keyboard focus outline should use a colour with enough contrast against the page

  Scenario: Reduced-motion preferences are respected
    Then the built styles should switch off transitions and animations for visitors who ask for reduced motion

  # --- Forms that still work without JavaScript ---------------------------------------------------

  Scenario Outline: The contact form falls back to a normal form post when JavaScript is off
    When I load the built page "<route>"
    Then the contact form should post to the Web3Forms API with the POST method
    And every contact form control should have a name so a plain submit carries the message

    Examples:
      | route        |
      | /contact/    |
      | /es/contact/ |

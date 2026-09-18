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

@browser
Feature: Every button that edits or submits wears the same font and size as the Access Info controls
  As the site owner
  I want the buttons that change something or send a form to look alike everywhere
  So that the site feels consistent, and they read as one family of controls

  The reference is the Access Info tab's date-range field: the site's own font, a little smaller than body text on a
  laptop and the full 16px on a phone. The main menu and the Portfolio page's category buttons keep their own.

  Scenario Outline: The Admin page's editing and submitting buttons match Access Info on a <device>
    Given the visitor uses a <device>
    And I am signed in to the Admin page
    When I open "/admin/"
    And I note the font of the Access Info date-range field
    Then the buttons of these tabs should wear exactly that font: "Test Results, Pics Viewer, Category Maintenance"

    Examples:
      | device |
      | laptop |
      | phone  |

  Scenario Outline: The token box's Sign in, the contact form's Send and the page editor's buttons match too, on a <device>
    Given the visitor uses a <device>
    And I am signed in to the Admin page
    When I open "/admin/"
    And I note the font of the Access Info date-range field
    Then these buttons should wear exactly that font: "/contact/ .contact-form button[type=submit], /about/ .page-editor button"
    And after signing out on "/admin/" the token box's Sign in button should wear exactly that font

    Examples:
      | device |
      | laptop |
      | phone  |

  Scenario: The main menu and the Portfolio page's category buttons keep their own size
    Given the visitor uses a laptop
    When I open "/work/nature/"
    Then the main menu's links should be 16px and the category buttons 13.6px, in the site's font

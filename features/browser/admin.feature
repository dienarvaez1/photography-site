@browser
Feature: The Admin page's tabs work in a real browser
  As the site owner
  I want the Test Results and Pics Viewer tabs to sit side by side and switch properly
  So that the Admin page is usable with the mouse, the keyboard and on a phone

  Scenario Outline: The two tabs sit side by side on one row, and the first one is showing
    Given the visitor uses a <device>
    When I open "/admin/"
    Then the two tabs should sit side by side on one row, the second to the right of the first
    And the "Test Results" tab should be selected, its panel visible and the other panel hidden

    Examples:
      | device |
      | laptop |
      | phone  |

  Scenario: Clicking a tab shows its panel and the address remembers it
    When I open "/admin/"
    And I click the "Pics Viewer" tab
    Then the "Pics Viewer" tab should be selected, its panel visible and the other panel hidden
    And the address should end with "#pics-viewer"
    When I click the "Test Results" tab
    Then the "Test Results" tab should be selected, its panel visible and the other panel hidden

  Scenario: Arrow keys, Home and End move between tabs and wrap around
    When I open "/admin/"
    And I focus the "Test Results" tab
    And I press the key "ArrowRight"
    Then the "Pics Viewer" tab should be selected and focused
    When I press the key "ArrowRight"
    Then the "Test Results" tab should be selected and focused
    When I press the key "ArrowLeft"
    Then the "Pics Viewer" tab should be selected and focused
    When I press the key "Home"
    Then the "Test Results" tab should be selected and focused
    When I press the key "End"
    Then the "Pics Viewer" tab should be selected and focused

  Scenario: Only the selected tab is in the tab order; Tab moves on into its panel
    When I open "/admin/"
    And I focus the "Test Results" tab
    And I press the key "Tab"
    Then keyboard focus should be on the "Test Results" panel

  Scenario: A link to #pics-viewer opens the TBD tab
    When I open "/admin/#pics-viewer"
    Then the "Pics Viewer" tab should be selected, its panel visible and the other panel hidden

  Scenario: The tabs work in Spanish
    When I open "/es/admin/"
    Then the "Resultados de pruebas" tab should be selected, its panel visible and the other panel hidden
    When I click the "Visor de fotos" tab
    Then the "Visor de fotos" tab should be selected, its panel visible and the other panel hidden

  Scenario: Without JavaScript both panels can be read
    Given JavaScript is switched off
    When I open "/admin/"
    Then both panels should be visible

  Scenario: The Admin page is not linked from the header, but its address still works
    When I open "/contact/"
    Then the header should offer no "Admin" link
    When I open "/admin/"
    Then the header should offer no "Admin" link
    And the "Test Results" tab should be selected, its panel visible and the other panel hidden

  Scenario: Using the tabs reports no errors and no policy violations
    When I open "/admin/"
    And I click the "Pics Viewer" tab
    And I press the key "ArrowLeft"
    Then no script error should have been logged
    And no Content-Security-Policy violation should have been reported

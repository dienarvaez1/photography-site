@browser
Feature: The Admin page's tabs work in a real browser
  As the site owner
  I want the Test Results, Pics Viewer and Category Maintenance tabs to sit side by side and switch properly
  So that the Admin page is usable with the mouse, the keyboard and on a phone

  Scenario Outline: The tabs sit side by side on one row, and the first one is showing
    Given the visitor uses a <device>
    When I open "/admin/"
    Then the tabs should sit side by side on one row, left to right
    And the "Test Results" tab should be selected, its panel visible and every other panel hidden

    Examples:
      | device |
      | laptop |
      | phone  |

  Scenario: Clicking a tab shows its panel and the address remembers it
    When I open "/admin/"
    And I click the "Pics Viewer" tab
    Then the "Pics Viewer" tab should be selected, its panel visible and every other panel hidden
    And the address should end with "#pics-viewer"
    When I click the "Category Maintenance" tab
    Then the "Category Maintenance" tab should be selected, its panel visible and every other panel hidden
    And the address should end with "#category-maintenance"
    When I click the "Test Results" tab
    Then the "Test Results" tab should be selected, its panel visible and every other panel hidden

  Scenario: Arrow keys, Home and End move between tabs and wrap around
    When I open "/admin/"
    And I focus the "Test Results" tab
    And I press the key "ArrowRight"
    Then the "Pics Viewer" tab should be selected and focused
    When I press the key "ArrowRight"
    Then the "Category Maintenance" tab should be selected and focused
    When I press the key "ArrowRight"
    Then the "Test Results" tab should be selected and focused
    When I press the key "ArrowLeft"
    Then the "Category Maintenance" tab should be selected and focused
    When I press the key "Home"
    Then the "Test Results" tab should be selected and focused
    When I press the key "End"
    Then the "Category Maintenance" tab should be selected and focused

  Scenario: Only the selected tab is in the tab order; Tab moves on into its panel
    When I open "/admin/"
    And I focus the "Test Results" tab
    And I press the key "Tab"
    Then keyboard focus should be on the "Test Results" panel

  Scenario: A link to #category-maintenance opens that tab
    When I open "/admin/#category-maintenance"
    Then the "Category Maintenance" tab should be selected, its panel visible and every other panel hidden

  Scenario: The tabs work in Spanish
    When I open "/es/admin/"
    Then the "Resultados de pruebas" tab should be selected, its panel visible and every other panel hidden
    When I click the "Visor de fotos" tab
    Then the "Visor de fotos" tab should be selected, its panel visible and every other panel hidden
    When I click the "Mantenimiento de categorías" tab
    Then the "Mantenimiento de categorías" tab should be selected, its panel visible and every other panel hidden

  Scenario: Without JavaScript every panel can be read
    Given JavaScript is switched off
    When I open "/admin/"
    Then every panel should be visible

  Scenario: The Admin page is not linked from the header, but its address still works
    When I open "/contact/"
    Then the header should offer no "Admin" link
    When I open "/admin/"
    Then the header should offer no "Admin" link
    And the "Test Results" tab should be selected, its panel visible and every other panel hidden

  Scenario: Using the tabs reports no errors and no policy violations
    When I open "/admin/"
    And I click the "Pics Viewer" tab
    And I press the key "ArrowLeft"
    Then no script error should have been logged
    And no Content-Security-Policy violation should have been reported

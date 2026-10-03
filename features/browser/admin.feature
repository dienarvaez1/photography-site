@browser
Feature: The Admin page's tabs work in a real browser
  As the site owner
  I want the Access Info, Test Results, Lighthouse Test Results, Pics Viewer, Category Maintenance and GitHub Issues tabs to
  sit side by side
  and switch properly
  So that the Admin page is usable with the mouse, the keyboard and on a phone

  Background:
    Given I am signed in to the Admin page

  Scenario: On a laptop the tabs sit side by side on one row, and the first one is showing
    Given the visitor uses a laptop
    When I open "/admin/"
    Then the tabs should sit side by side on one row, left to right
    And the "Access Info" tab should be selected, its panel visible and every other panel hidden

  Scenario Outline: On a phone the tabs stack three over three, all on screen, in order (<page>)
    Given the visitor uses a phone
    When I open "<page>"
    Then the tabs should stack in two rows of three, left to right and top to bottom, all on screen
    And the "<first>" tab should be selected, its panel visible and every other panel hidden
    And the page should not scroll sideways

    Examples:
      | page       | first              |
      | /admin/    | Access Info        |
      | /es/admin/ | Información de acceso |

  Scenario: The tab under the pointer stands out clearly, and never looks like the chosen one
    Given the visitor uses a laptop
    When I open "/admin/"
    And I hover over the "Test Results" tab
    Then the "Test Results" tab should be highlighted: a gold-tinted face, a gold border and a gold bar along its bottom
    And the "Access Info" tab should still look chosen: its dark face and its bar on top
    And the "Test Results" tab's highlight should be the same color as "About" when highlighted
    When I hover over the "Access Info" tab
    Then the "Access Info" tab should not take the hover highlight

  Scenario: Clicking a tab shows its panel and the address remembers it
    When I open "/admin/"
    And I click the "Test Results" tab
    Then the "Test Results" tab should be selected, its panel visible and every other panel hidden
    And the address should end with "#test-results"
    When I click the "Lighthouse Test Results" tab
    Then the "Lighthouse Test Results" tab should be selected, its panel visible and every other panel hidden
    And the address should end with "#lighthouse-results"
    When I click the "Pics Viewer" tab
    Then the "Pics Viewer" tab should be selected, its panel visible and every other panel hidden
    And the address should end with "#pics-viewer"
    When I click the "Category Maintenance" tab
    Then the "Category Maintenance" tab should be selected, its panel visible and every other panel hidden
    And the address should end with "#category-maintenance"
    When I click the "GitHub Issues" tab
    Then the "GitHub Issues" tab should be selected, its panel visible and every other panel hidden
    And the address should end with "#github-issues"
    When I click the "Access Info" tab
    Then the "Access Info" tab should be selected, its panel visible and every other panel hidden
    And the address should end with "#access-info"

  Scenario: Arrow keys, Home and End move between tabs and wrap around
    When I open "/admin/"
    And I focus the "Access Info" tab
    And I press the key "ArrowRight"
    Then the "Test Results" tab should be selected and focused
    When I press the key "ArrowRight"
    Then the "Lighthouse Test Results" tab should be selected and focused
    When I press the key "ArrowRight"
    Then the "Pics Viewer" tab should be selected and focused
    When I press the key "ArrowRight"
    Then the "Category Maintenance" tab should be selected and focused
    When I press the key "ArrowRight"
    Then the "GitHub Issues" tab should be selected and focused
    When I press the key "ArrowRight"
    Then the "Access Info" tab should be selected and focused
    When I press the key "ArrowLeft"
    Then the "GitHub Issues" tab should be selected and focused
    When I press the key "Home"
    Then the "Access Info" tab should be selected and focused
    When I press the key "End"
    Then the "GitHub Issues" tab should be selected and focused

  Scenario: Only the selected tab is in the tab order; Tab moves on into its panel
    When I open "/admin/"
    And I focus the "Access Info" tab
    And I press the key "Tab"
    Then keyboard focus should be on the "Access Info" panel

  Scenario: A link to #category-maintenance opens that tab
    When I open "/admin/#category-maintenance"
    Then the "Category Maintenance" tab should be selected, its panel visible and every other panel hidden

  Scenario: The tabs work in Spanish
    When I open "/es/admin/"
    Then the "Información de acceso" tab should be selected, its panel visible and every other panel hidden
    When I click the "Resultados de Lighthouse" tab
    Then the "Resultados de Lighthouse" tab should be selected, its panel visible and every other panel hidden
    When I click the "Visor de fotos" tab
    Then the "Visor de fotos" tab should be selected, its panel visible and every other panel hidden
    When I click the "Mantenimiento de categorías" tab
    Then the "Mantenimiento de categorías" tab should be selected, its panel visible and every other panel hidden
    When I click the "Incidencias de GitHub" tab
    Then the "Incidencias de GitHub" tab should be selected, its panel visible and every other panel hidden

  Scenario: The Admin page is not linked from the header, but its address still works
    When I open "/contact/"
    Then the header should offer no "Admin" link
    When I open "/admin/"
    Then the header should offer no "Admin" link
    And the "Access Info" tab should be selected, its panel visible and every other panel hidden

  Scenario: Using the tabs reports no errors and no policy violations
    When I open "/admin/"
    And I click the "Pics Viewer" tab
    And I press the key "ArrowLeft"
    Then no script error should have been logged
    And no Content-Security-Policy violation should have been reported

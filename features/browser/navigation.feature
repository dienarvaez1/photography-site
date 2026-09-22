@browser
Feature: The navigation works on phones and with the keyboard
  As a visitor
  I want the menu to open, close and be reachable however I browse
  So that I can always get to every page

  Scenario: On a phone the menu starts closed and the button opens it
    Given the visitor uses a phone
    When I open "/"
    Then the mobile menu should be collapsed
    When I open the mobile menu
    Then the mobile menu should be open with the About and Contact links visible

  Scenario: Escape closes the open mobile menu and returns focus to its button
    Given the visitor uses a phone
    When I open "/"
    And I open the mobile menu
    And I press the key "Escape"
    Then the mobile menu should be collapsed
    And keyboard focus should be on the menu button

  Scenario: The Work submenu lists every visible category on a phone
    Given the visitor uses a phone
    When I open "/"
    And I open the mobile menu
    And I open the Work submenu
    Then the Work submenu should list 8 categories, all visible

  Scenario: On a laptop, tabbing to Work reveals its dropdown
    When I open "/"
    And I tab until keyboard focus reaches the Work menu
    Then the Work dropdown should be visible with its 8 category links

  Scenario: The keyboard can reach every navigation link in order
    When I open "/"
    Then tabbing through the page should reach these in order:
      | skip link     |
      | home          |
      | Work          |
      | each category |
      | About         |
      | Contact       |
      | Español       |

  Scenario: The skip link appears when focused and jumps to the main content
    When I open "/about/"
    And I press the key "Tab"
    Then the skip link should be focused and visible on screen
    When I press the key "Enter"
    Then the address should end with "#main-content"

  Scenario: The active page is marked in the navigation
    When I open "/about/"
    Then the "About" link should be the active one
    When I open "/es/contact/"
    Then the "Contacto" link should be the active one

  Scenario: The menu works in Spanish on a phone
    Given the visitor uses a phone
    When I open "/es/"
    And I open the mobile menu
    Then the mobile menu should be open with the "Sobre mí" and "Contacto" links visible

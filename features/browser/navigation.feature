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

  Scenario: The Portfolio submenu lists every visible category on a phone
    Given the visitor uses a phone
    When I open "/"
    And I open the mobile menu
    And I open the Portfolio submenu
    Then the Portfolio submenu should list every visible category

  Scenario: On a laptop, tabbing to Portfolio reveals its dropdown
    When I open "/"
    And I tab until keyboard focus reaches the Portfolio menu
    Then the Portfolio dropdown should be visible with every visible category link

  Scenario: The dropdown stays open while moving the pointer down from Portfolio to a category
    When I open "/"
    And I hover over Portfolio and move the pointer down toward its first category
    Then the dropdown should still be open and its first category clickable

  # --- Clicking Portfolio itself, on a screen wide enough to hover ---------------------------------------------------

  Scenario: Clicking Portfolio on a wide enough screen goes to the home page's category section
    When I open "/about/"
    And I click the Portfolio menu
    Then the address should end with "/#explore-by-category"
    And the "Explore by Category" heading should be scrolled into view, clear of the sticky header

  Scenario: Clicking Portfolio on the home page itself scrolls straight to the category section
    When I open "/"
    And I click the Portfolio menu
    Then the address should end with "/#explore-by-category"
    And the "Explore by Category" heading should be scrolled into view, clear of the sticky header

  Scenario: On a phone, tapping Portfolio still opens its submenu instead of navigating away
    Given the visitor uses a phone
    When I open "/about/"
    And I open the mobile menu
    And I click the Portfolio menu
    Then the Portfolio submenu should list every visible category
    And the address should end with "/about/"

  Scenario: Clicking Portfolio speaks Spanish
    When I open "/es/about/"
    And I click the Portfolio menu
    Then the address should end with "/es/#explore-by-category"
    And the "Explorar por categoría" heading should be scrolled into view, clear of the sticky header

  Scenario: The keyboard can reach every navigation link in order
    When I open "/"
    Then tabbing through the page should reach these in order:
      | skip link     |
      | Español       |
      | home          |
      | Portfolio     |
      | each category |
      | About         |
      | Contact       |

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

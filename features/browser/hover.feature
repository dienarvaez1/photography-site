@browser
Feature: Every button, tab and button-like link stands out clearly under the pointer
  As a visitor or the site owner using a mouse or trackpad
  I want whatever I'm about to click to stand out clearly
  So that it's easy to see where I am going, across the whole site

  The highlight is shared (src/styles/global.css): a gold-tinted face, a gold border, and a gold bar along the bottom (or
  a gold ring for round and filled buttons). It only applies where a pointer can hover, so a tap on a phone never
  leaves anything highlighted.

  Scenario Outline: <what> takes the hover highlight on <page>
    Given the visitor uses a laptop
    When I open "<page>"
    And I hover over the <what> "<name>"
    Then it should take the hover highlight: <look>
    And its background should be the same color as "About" when highlighted

    Examples:
      | page        | what            | name          | look                            |
      | /           | outlined button | Book a Session | a tinted face and a gold bar   |
      | /           | filled button   | View the Work | a tinted face and a gold bar    |
      | /           | header link     | About         | a tinted face and a gold bar    |
      | /           | header link     | Portfolio     | a tinted face and a gold bar    |
      | /work/all/  | filter pill     | Nature        | a tinted face and a gold ring   |
      | /           | Portfolio item  | Nature        | a tinted face and a gold bar    |

  Scenario: The Admin page's Refresh in the top menu takes the hover highlight too
    Given I am signed in to the Admin page
    And the visitor uses a laptop
    When I open "/admin/"
    And I hover over the menu button "Refresh"
    Then it should take the hover highlight: a tinted face and a gold bar
    And its background should be the same color as "About" when highlighted

  Scenario: On a phone nothing stays highlighted after a tap
    Given the visitor uses a phone
    When I open "/"
    Then the hover highlight should only apply where a pointer can hover

  Scenario: The Portfolio dropdown is flush with "Portfolio": every item's words start where its label does
    Given the visitor uses a laptop
    When I open "/"
    And I open the Portfolio dropdown
    Then every item in the Portfolio dropdown should start its words where "Portfolio" starts

  Scenario Outline: The header shows the gold signature logo alone, centred, on a <device>
    Given the visitor uses a <device>
    When I open "/"
    Then the header should show only the gold signature logo, centred and whole

    Examples:
      | device |
      | laptop |
      | phone  |

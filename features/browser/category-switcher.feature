@browser
Feature: The category page's filter and sort switch the gallery in place
  As a visitor browsing one category
  I want to jump to another category, or change how it's ordered, without a page reload
  So that exploring the whole portfolio is quick, and my place in it stays shareable

  The manifest (photos/index.json) is fetched once per tab and reused for every switch after that;
  the category filter's links and the server-rendered photos work exactly the same with no JS.

  Scenario: Clicking another category swaps the grid in place, with no full-page navigation
    When I open "/work/nature/"
    And I click the category filter "Pets"
    Then only one page navigation should have happened
    And the manifest should have been fetched

  Scenario: Switching categories relabels the page and shows that category's photos
    When I open "/work/nature/"
    And I click the category filter "Pets"
    Then the gallery heading should say "Pets"
    And the gallery should show 2 photos

  Scenario: The pills and the rebuilt tiles keep their styling after a switch, not just their class names
    When I open "/work/nature/"
    And I click the category filter "Pets"
    Then the current category pill should still be styled like a pill
    And the first gallery tile should still be styled like a tile

  Scenario: Switching categories updates the address, shareably
    When I open "/work/nature/"
    And I click the category filter "Pets"
    Then the address should end with "/work/pets/"

  Scenario: The browser's Back button returns to the previous category
    When I open "/work/nature/"
    And I click the category filter "Pets"
    And I go back in the browser
    Then the address should end with "/work/nature/"
    And the gallery heading should say "Nature"

  Scenario: The sort control reorders the visible photos, without changing the address
    When I open "/work/nature/"
    Then the first gallery tile should be titled "Hummingbird and Butterfly Bush"
    When I choose "Newest first" from the sort control
    Then the first gallery tile should be titled "Lioness at Rest"
    And the address should end with "/work/nature/"

  Scenario: Choosing curated order again restores the original order
    When I open "/work/nature/"
    And I choose "Newest first" from the sort control
    And I choose "Curated order" from the sort control
    Then the first gallery tile should be titled "Hummingbird and Butterfly Bush"

  Scenario: Switching categories works from the Spanish pages too
    When I open "/es/work/nature/"
    And I click the category filter "Mascotas"
    Then the address should end with "/es/work/pets/"
    And the gallery heading should say "Mascotas"

  Scenario: The sort control is hidden without JavaScript, not just inert
    Given JavaScript is switched off
    When I open "/work/nature/"
    Then the sort control should not be visible

  Scenario: With JavaScript, the sort control is revealed
    When I open "/work/nature/"
    Then the sort control should be visible

  Scenario: Opening the lightbox still works after switching categories
    When I open "/work/nature/"
    And I click the category filter "Pets"
    And I click photo number 1
    Then the lightbox should be open showing photo number 1 of the page

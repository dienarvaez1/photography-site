@browser
Feature: The Admin page's Category Maintenance tab adds, edits and removes categories
  As the site owner
  I want to add a category, hide or rename an existing one, or remove one with no photos left in it, from the
  Admin page
  So that I can manage the site's categories without hand-editing its source files

  Like the Pics Viewer, this tab sits behind the admin token: it is checked against the results API the moment
  it's entered, though the tab itself needs none of that API's own data. Once past the gate, the mutating
  actions (Add, Edit, Remove) are done by the real local Category Maintenance service (as `astro dev` runs it)
  over a temporary copy of the configuration files, so what the page shows after a change is what was really
  written. The service's own request handler is covered directly in category-form.feature.

  Background:
    Given the results API holds the admin token "browser-test-admin-token" and no published runs
    And a category service is running over a fresh configuration with "nature" and a hidden "drafts"

  # --- The tab and signing in ------------------------------------------------------------------------------------

  Scenario: The tab asks for the admin token before showing anything
    When I open "/admin/#category-maintenance"
    Then Category Maintenance should ask for the admin token
    And the Category Maintenance list should not show a row for "Nature"

  Scenario: A wrong token is refused
    When I open "/admin/#category-maintenance"
    And I sign in to Category Maintenance with the token "definitely-the-wrong-one"
    Then Category Maintenance should ask for the admin token

  Scenario: Signing in on another tab opens Category Maintenance already signed in
    When I open "/admin/#test-results"
    And I sign in with the token "browser-test-admin-token"
    And I click the "Category Maintenance" tab
    Then the Category Maintenance list should show a row for "Nature"

  Scenario: Signing in on Category Maintenance signs in the other tabs too
    When I open "/admin/#category-maintenance"
    And I sign in to Category Maintenance with the token "browser-test-admin-token"
    And I click the "Test Results" tab
    Then the Test Results tab should say "No test results have been published yet. Run npm run test:record, then npm run results:publish."

  # --- Viewing and managing categories -----------------------------------------------------------------------------

  Scenario: The tab lists every configured category
    When I open "/admin/#category-maintenance"
    And I sign in to Category Maintenance with the token "browser-test-admin-token"
    Then the Category Maintenance list should show a row for "Landscape"
    And the Category Maintenance list should show a row for "Nature"
    And the Category Maintenance list should be in alphabetical order

  Scenario: The Spanish page lists the categories in Spanish alphabetical order
    When I open "/es/admin/#category-maintenance"
    And I sign in to Category Maintenance with the token "browser-test-admin-token"
    Then the Category Maintenance list should show a row for "Paisaje"
    And the Category Maintenance list should be in alphabetical order

  Scenario: Adding a category adds it to the list
    When I open "/admin/#category-maintenance"
    And I sign in to Category Maintenance with the token "browser-test-admin-token"
    And I open the Add Category form
    And I fill in the new category "night-sky", named "Night Sky" and "Cielo nocturno", described as "Stars." and "Estrellas."
    And I submit the new category form
    Then the Category Maintenance list should show a row for "Night Sky"
    And the new category form should confirm "Night Sky" was added
    And the Category Maintenance list should be in alphabetical order

  Scenario: Adding a category with a taken slug shows why it failed
    When I open "/admin/#category-maintenance"
    And I sign in to Category Maintenance with the token "browser-test-admin-token"
    And I open the Add Category form
    And I fill in the new category "nature", named "Wildlife" and "Fauna", described as "x" and "y"
    And I submit the new category form
    Then the new category form should show an error mentioning "nature"

  Scenario Outline: <button> shows its edit in red, like every edit on the Admin page
    When I open "/admin/#category-maintenance"
    And I sign in to Category Maintenance with the token "browser-test-admin-token"
    And I <open>
    Then the edit mode should be shown in red

    Examples:
      | button            | open                                                     |
      | Add Category      | open the Add Category form                               |
      | Edit Categories   | click the Category Maintenance "Edit Categories" button  |
      | Remove Categories | click the Category Maintenance "Remove Categories" button |

  Scenario: Hiding a category through Edit Categories marks it Hidden
    When I open "/admin/#category-maintenance"
    And I sign in to Category Maintenance with the token "browser-test-admin-token"
    And I click the Category Maintenance "Edit Categories" button
    And I tick the Hidden box for "Nature" and save it
    And I click the Category Maintenance "Edit Categories" button
    Then the Category Maintenance row for "Nature" should be marked Hidden

  Scenario: Renaming a category through Edit Categories updates its name
    When I open "/admin/#category-maintenance"
    And I sign in to Category Maintenance with the token "browser-test-admin-token"
    And I click the Category Maintenance "Edit Categories" button
    And I change the English name of "Nature" to "Wildlife" and save it
    And I click the Category Maintenance "Edit Categories" button
    Then the Category Maintenance list should show a row for "Wildlife"
    And the Category Maintenance list should not show a row for "Nature"
    And the Category Maintenance list should be in alphabetical order

  Scenario: Changing a category's slug through Edit Categories updates its URL and keeps its photo
    Given the category "nature" in the browser fixture already has a photo
    When I open "/admin/#category-maintenance"
    And I sign in to Category Maintenance with the token "browser-test-admin-token"
    And I click the Category Maintenance "Edit Categories" button
    And I change the slug of "Nature" to "wildlife" and save it
    And I click the Category Maintenance "Edit Categories" button
    Then the Category Maintenance list should show a row for "Nature"
    And the Category Maintenance row for "Nature" should show the URL "/work/wildlife/"
    And the Category Maintenance row for "Nature" should show 1 photo

  Scenario: Removing a category with no photos removes it from the list
    When I open "/admin/#category-maintenance"
    And I sign in to Category Maintenance with the token "browser-test-admin-token"
    And I click the Category Maintenance "Remove Categories" button
    And I tick the checkbox for "Drafts"
    And I click "Delete selected"
    And I click "Yes, remove this category"
    Then the Category Maintenance list should not show a row for "Drafts"

  Scenario: A category that still has photos cannot be removed
    Given the category "nature" in the browser fixture already has a photo
    When I open "/admin/#category-maintenance"
    And I sign in to Category Maintenance with the token "browser-test-admin-token"
    And I click the Category Maintenance "Remove Categories" button
    And I tick the checkbox for "Nature"
    And I click "Delete selected"
    And I click "Yes, remove this category"
    Then the Category Maintenance page should report that "Nature" could not be removed
    And the Category Maintenance list should show a row for "Nature"

  Scenario: Without the local service, Edit says so instead of doing anything
    Given the local category service is not running
    When I open "/admin/#category-maintenance"
    And I sign in to Category Maintenance with the token "browser-test-admin-token"
    And I click the Category Maintenance "Edit Categories" button
    Then the Category Maintenance page should say Category Maintenance only works on the owner's computer

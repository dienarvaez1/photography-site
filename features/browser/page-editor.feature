@browser
Feature: The signed-in Admin edits a page's headings and descriptions in place, saved in English and Spanish
  As the site owner, signed in with the admin token on the dev box
  I want to change a page's headings and descriptions right on the page, and Update
  So that both languages change together, translated, without hand-editing the text files

  The real pages, the real save service (scripts/lib/page-text-form.mjs) over copies of the site's text files, and the
  real results API's POST /translate with a stand-in for Workers AI that answers "[es] …" or "[en] …".

  Background:
    Given the page editor saves into copies of the site's text files
    And the translation service translates

  Scenario: A visitor who is not signed in sees no editor
    When I open "/about/"
    Then there should be no "Edit page" button

  Scenario Outline: The Admin can edit <page>
    Given I am signed in to the Admin page
    When I open "<page>"
    And I click "Edit page" in the page editor
    Then these texts should be open for editing: <keys>

    Examples:
      | page            | keys                                                                                           |
      | /               | home.heroTitle, home.heroCopy, home.exploreByCategory                                          |
      | /work/all/      | work.allLabel, work.allDescription                                                             |
      | /work/nature/   | categories.nature.label, categories.nature.description                                          |
      | /about/         | about.heading, about.intro, about.curiosityHeading, about.curiosity, about.ctaHeading, about.cta |
      | /contact/       | contact.heading, contact.intro                                                                 |

  Scenario: Every category in the Portfolio menu can be edited
    Given I am signed in to the Admin page
    Then each of the Portfolio menu's pages should offer "Edit page", for its own heading and description

  Scenario: An English heading is saved in English, and translated into Spanish
    Given I am signed in to the Admin page
    When I open "/about/"
    And I click "Edit page" in the page editor
    And I change "about.heading" to "Honest moments, beautiful places."
    And I click "Update" in the page editor
    Then the page editor should say "Saved in English and Spanish. Commit and deploy to publish it."
    And the page's "about.heading" should read "Honest moments, beautiful places."
    And the English file should now have "about.heading" as "Honest moments, beautiful places."
    And the Spanish file should now have "about.heading" as "[es] Honest moments, beautiful places."
    And only "Honest moments, beautiful places." should have been sent for translation
    And nothing should be open for editing any more

  Scenario: A Spanish description is saved in Spanish, and translated into English
    Given I am signed in to the Admin page
    When I open "/es/work/nature/"
    And I click "Editar página" in the page editor
    And I change "categories.nature.description" to "Vida silvestre y lugares salvajes."
    And I click "Actualizar" in the page editor
    Then the page editor should say "Guardado en español e inglés. Haz commit y despliega para publicarlo."
    And the Spanish file should now have "categories.nature.description" as "Vida silvestre y lugares salvajes."
    And the English file should now have "categories.nature.description" as "[en] Vida silvestre y lugares salvajes."

  Scenario: Paragraphs stay paragraphs
    Given I am signed in to the Admin page
    When I open "/about/"
    And I click "Edit page" in the page editor
    And I change "about.cta" to "First paragraph.\n\nSecond paragraph."
    And I click "Update" in the page editor
    Then the page editor should say "Saved in English and Spanish. Commit and deploy to publish it."
    And the page's "about.cta" should show the paragraphs "First paragraph.", "Second paragraph."
    And the English file should now have "about.cta" as the paragraphs "First paragraph.", "Second paragraph."
    And the Spanish file should now have "about.cta" as the paragraphs "[es] First paragraph.", "Second paragraph."

  Scenario: The contact text keeps its email link
    Given I am signed in to the Admin page
    When I open "/contact/"
    And I click "Edit page" in the page editor
    And I change "contact.intro" to "Write to me any time at {email}."
    And I click "Update" in the page editor
    Then the page editor should say "Saved in English and Spanish. Commit and deploy to publish it."
    And the page's "contact.intro" should read "Write to me any time at <the site's email>." with the email still a link
    And the Spanish file should now have "contact.intro" as "[es] Write to me any time at {email}."

  Scenario: The category page edits whichever category is showing
    Given I am signed in to the Admin page
    When I open "/work/nature/"
    And I click the category filter "Pets"
    And I click "Edit page" in the page editor
    Then these texts should be open for editing: categories.pets.label, categories.pets.description

  Scenario: Nothing changed, nothing is translated or saved
    Given I am signed in to the Admin page
    When I open "/about/"
    And I click "Edit page" in the page editor
    And I click "Update" in the page editor
    Then the page editor should say "Nothing has changed."
    And nothing should have been sent for translation
    And both text files should be as they were

  Scenario: Cancel puts the page back as it was
    Given I am signed in to the Admin page
    When I open "/about/"
    And I click "Edit page" in the page editor
    And I change "about.heading" to "Something else"
    And I click "Cancel" in the page editor
    Then nothing should be open for editing any more
    And the page's "about.heading" should read "Real moments. Beautiful places. Photographs worth remembering."
    And both text files should be as they were

  Scenario: When the translation fails, nothing is saved and the edit stays open
    Given the translation service stops answering
    And I am signed in to the Admin page
    When I open "/about/"
    And I click "Edit page" in the page editor
    And I change "about.heading" to "Honest moments."
    And I click "Update" in the page editor
    Then the page editor should report an error starting "The translation didn’t work"
    And both text files should be as they were
    And "about.heading" should still be open for editing, holding "Honest moments."

  Scenario: Off the dev box the editor says it can't save
    Given the page editor's service runs where SITE_ENV is not development
    And I am signed in to the Admin page
    When I open "/about/"
    And I click "Edit page" in the page editor
    And I change "about.heading" to "Honest moments."
    And I click "Update" in the page editor
    Then the page editor should report an error starting "Saving page text only works on the dev box"
    And both text files should be as they were

  Scenario: A refused admin token is reported, and nothing is saved
    Given I am signed in to the Admin page with a token the API no longer accepts
    When I open "/about/"
    And I click "Edit page" in the page editor
    And I change "about.heading" to "Honest moments."
    And I click "Update" in the page editor
    Then the page editor should report an error starting "Your admin token wasn’t accepted"
    And both text files should be as they were

  Scenario: The Admin page itself has no page editor
    Given I am signed in to the Admin page
    When I open "/admin/"
    Then there should be no "Edit page" button

  Scenario: On a phone the editor fits on screen and its buttons are easy to tap
    Given the visitor uses a phone
    And I am signed in to the Admin page
    When I open "/about/"
    And I click "Edit page" in the page editor
    Then the page editor should be entirely on screen, with buttons at least 44 pixels tall
    And the page should not scroll sideways

  Scenario: The editor's controls sit in from the right edge, and turn red while editing
    Given I am signed in to the Admin page
    When I open "/about/"
    Then the page editor's controls should sit at least 90 pixels in from the right edge of the window and 40 up from the bottom
    And the page editor's controls should not be red
    And the page editor should show only the buttons "Edit page"
    When I click "Edit page" in the page editor
    Then the page editor's controls should be red, with a red Update button
    And the page editor should show only the buttons "Update, Cancel"
    When I click "Cancel" in the page editor
    Then the page editor's controls should not be red
    And the page editor should show only the buttons "Edit page"

  Scenario Outline: The footer's Build is a link back to the Admin page for the signed-in Admin, on <page>
    Given I am signed in to the Admin page
    When I open "<page>"
    Then the footer's build should be a link to "<admin>"
    When I click the footer's build
    Then the address should end with "<admin>"

    Examples:
      | page         | admin      |
      | /about/      | /admin/    |
      | /es/work/all/ | /es/admin/ |

  Scenario: For a visitor who isn't signed in, the footer's Build is plain text
    When I open "/about/"
    Then the footer's build should not be a link

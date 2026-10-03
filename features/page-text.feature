Feature: The page editor saves headings and descriptions in English and Spanish
  As the site owner editing a page on the dev box
  I want my change and its translation written into the site's text files together
  So that the English and Spanish pages always match after one Update

  The real handler (scripts/lib/page-text-form.mjs) over temporary copies of categories.json, en.json and es.json, never
  the project's own files. The page side is in browser/page-editor.feature.

  Background:
    Given temporary copies of the site's text files

  Scenario: The editor reads a page's texts in both languages
    When I ask the page text service for "about.heading,about.intro,categories.nature.label"
    Then the page text service should answer with status 200
    And it should give "about.heading" as "Real moments." in English and "Momentos reales." in Spanish
    And it should give "about.intro" as "One.\n\nTwo." in English and "Uno.\n\nDos." in Spanish

  Scenario: Saving writes both languages, and nothing else in the files changes
    When I save "about.heading" as "Honest moments." in English and "Momentos honestos." in Spanish
    Then the page text service should answer with status 200
    And the English file should have "about.heading" as "Honest moments."
    And the Spanish file should have "about.heading" as "Momentos honestos."
    And everything else in both files should be as it was

  Scenario: A paragraph list is saved as paragraphs
    When I save "about.intro" as "First.\n\n  Second  line.\n\n\nThird." in English and "Primero.\n\nSegundo.\n\nTercero." in Spanish
    Then the English file should have "about.intro" as the paragraphs "First.", "Second line.", "Third."
    And the Spanish file should have "about.intro" as the paragraphs "Primero.", "Segundo.", "Tercero."

  Scenario: A category's name and description can be changed
    When I save "categories.nature.description" as "Wild places." in English and "Lugares salvajes." in Spanish
    Then the English file should have "categories.nature.description" as "Wild places."
    And the Spanish file should have "categories.nature.description" as "Lugares salvajes."

  Scenario Outline: It refuses <case>
    When I save "<key>" as "<en>" in English and "<es>" in Spanish
    Then the page text service should answer with status 400
    And both files should be untouched

    Examples:
      | case                                   | key                         | en                     | es                   |
      | a text that is not a heading or description | nav.about              | Me                     | Yo                   |
      | the Admin page's own text              | admin.heading               | Boss                   | Jefe                 |
      | a hidden category                      | categories.drafts.label     | Drafts                 | Borradores           |
      | a missing translation                  | about.heading               | Honest moments.        |                      |
      | HTML                                   | about.heading               | <b>Honest</b>          | Honesto              |
      | a lost placeholder                     | contact.intro               | Email me.              | Escríbeme a {email}. |
      | an added placeholder                   | about.heading               | Hi {name}.             | Hola {name}.         |

  Scenario: A placeholder kept in both languages is fine
    When I save "contact.intro" as "Write to {email}." in English and "Escribe a {email}." in Spanish
    Then the page text service should answer with status 200
    And the English file should have "contact.intro" as "Write to {email}."

  Scenario: Only the owner's own page on this computer can save
    When I save "about.heading" from another site
    Then the page text service should answer with status 403
    And both files should be untouched

  Scenario: Off the dev box nothing is saved
    Given the page text service runs where SITE_ENV is not development
    When I save "about.heading" through the dev server as "Honest moments." in English and "Momentos honestos." in Spanish
    Then the page text service should answer with status 403 and the error "not-dev-box"
    And both files should be untouched

  Scenario: The dev server has the page editor's service
    Then astro.config.mjs should add the page text service to the dev server

Feature: Spanish localization
  As a Spanish-speaking visitor (and as a search engine)
  I want every page available in Spanish at a predictable /es/ URL, linked to its English twin
  So that I can read the site in my language and search engines serve me the right version

  Scenario: The locale files define exactly the same messages
    Given the message files for every locale
    Then every locale should define exactly the same message keys as the default locale
    And no message in any locale should be empty

  Scenario: Every page declares hreflang alternates pointing at its English and Spanish twins
    When I load every built page
    Then every page should declare absolute hreflang alternates for "en", "es" and "x-default" pointing at its own twins
    And every page's canonical URL should equal its own hreflang alternate
    And every page should declare og:locale for its own language

  Scenario: The language switcher on every page links to the equivalent page in the other language
    When I load every built page
    Then the language switcher on every page should link only to the equivalent page in the other language
    And the current language should be marked in the language switcher on every page

  Scenario: Spanish pages keep visitors in Spanish and English pages stay at the unprefixed root
    When I load every built page
    Then every internal page link outside the language switcher should stay in its page's language

  Scenario: Spanish pages are actually translated, not copies of the English page
    When I load every built page
    Then every Spanish page's title, heading and description should differ from its English twin

  Scenario: The sitemap lists hreflang alternates for translated pages
    Then the sitemap should list an hreflang alternate for every locale of every page

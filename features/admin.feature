Feature: Admin page smoke test
  As the site owner
  I want an Admin page next to Contact, with a "Test Results" tab and a "TBD" tab
  So that there is a place to grow the site's admin tools, in both languages

  This is a basic smoke test: the page exists, it is linked to the right of Contact, and it has its two tabs.

  Scenario Outline: The Admin page exists in both languages
    When I load the built page "<route>"
    Then the page should not be an error page
    And the page heading should be "<heading>" in the language "<language>"

    Examples:
      | route       | language | heading        |
      | /admin/     | en       | Admin          |
      | /es/admin/  | es       | Administración |

  Scenario Outline: "Admin" is linked immediately to the right of "Contact" in the header
    When I load the built page "<route>"
    Then the header links after the Work menu should be, in order: "<links>"
    And the "Admin" link should lead to "<admin path>"

    Examples:
      | route      | links                 | admin path |
      | /          | About, Contact, Admin | /admin/    |
      | /about/    | About, Contact, Admin | /admin/    |
      | /es/       | Sobre mí, Contacto, Admin | /es/admin/ |
      | /es/admin/ | Sobre mí, Contacto, Admin | /es/admin/ |

  Scenario Outline: The Admin link is marked as the current page only on the Admin page
    When I load the built page "<route>"
    Then the active header link should be "<active>"

    Examples:
      | route      | active |
      | /admin/    | Admin  |
      | /es/admin/ | Admin  |
      | /contact/  | Contact |

  Scenario Outline: The page has exactly two tabs, side by side in a horizontal tab list, in this order
    When I load the built page "<route>"
    Then the page should have one tab list labelled "<list label>" holding exactly these tabs, in order: "<tabs>"

    Examples:
      | route      | list label                       | tabs                                 |
      | /admin/    | Admin sections                   | Test Results, TBD                    |
      | /es/admin/ | Secciones de administración      | Resultados de pruebas, Por definir   |

  Scenario Outline: The tabs are wired to two panels, with the first tab selected
    When I load the built page "<route>"
    Then each of the two tabs should control its own panel, and each panel should be labelled by its tab
    And the first tab should be selected and reachable by keyboard, the second selected-off and out of the tab order
    And the first panel should be visible and the second hidden, each headed by its tab's name

    Examples:
      | route      |
      | /admin/    |
      | /es/admin/ |

  Scenario: The tabs sit in a row, not a column
    Then the tab list should be laid out horizontally in the built styles

  Scenario: Without JavaScript both panels are still readable
    When I load the built page "/admin/"
    Then a no-JavaScript fallback in the page head should show the hidden panel

  Scenario Outline: The Admin page is kept out of search engines and the sitemap
    When I load the built page "<route>"
    Then the page should ask search engines not to index it, and declare no canonical or alternate URLs
    And the sitemap should not list "<route>"

    Examples:
      | route      |
      | /admin/    |
      | /es/admin/ |

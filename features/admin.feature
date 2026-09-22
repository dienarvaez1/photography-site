Feature: Admin page smoke test
  As the site owner
  I want an Admin page reachable directly at /admin/, with a "Test Results" tab and a "Pics Viewer" tab,
  but not advertised in the header
  So that there is a place to grow the site's admin tools, in both languages, without inviting visitors to it

  This is a basic smoke test: the page exists and works at its address, is never linked from the header, and
  has its two tabs.

  Scenario Outline: The Admin page exists in both languages
    When I load the built page "<route>"
    Then the page should not be an error page
    And the page heading should be "<heading>" in the language "<language>"

    Examples:
      | route       | language | heading        |
      | /admin/     | en       | Admin          |
      | /es/admin/  | es       | Administración |

  Scenario Outline: The header never links to the Admin page, on any page including the Admin page itself
    When I load the built page "<route>"
    Then the header links after the Work menu should be, in order: "<links>"

    Examples:
      | route      | links               |
      | /          | About, Contact      |
      | /about/    | About, Contact      |
      | /admin/    | About, Contact      |
      | /es/       | Sobre mí, Contacto  |
      | /es/admin/ | Sobre mí, Contacto  |

  Scenario Outline: The page has exactly two tabs, side by side in a horizontal tab list, in this order
    When I load the built page "<route>"
    Then the page should have one tab list labelled "<list label>" holding exactly these tabs, in order: "<tabs>"

    Examples:
      | route      | list label                       | tabs                                 |
      | /admin/    | Admin sections                   | Test Results, Pics Viewer                    |
      | /es/admin/ | Secciones de administración      | Resultados de pruebas, Visor de fotos   |

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

  # --- Signing out when left alone ---------------------------------------------------------------------------------

  Scenario: The Admin page signs out after 5 minutes of inactivity, as configured and documented
    Then the idle timeout in the site configuration should be 5 minutes
    And the README should say the Admin page signs out after 5 minutes of inactivity

  Scenario: Any sign that the person is there restarts the clock, and the page's own requests do not
    Then the idle timeout should be restarted by a click, pointer movement, key press, scroll and touch, and by nothing the page does by itself

  Scenario Outline: The sign-out reminder is translated and takes the number of minutes from the configuration
    Then the "<locale>" reminder shown after an idle sign-out should contain the placeholder for the minutes and no fixed number

    Examples:
      | locale |
      | en     |
      | es     |

  Scenario Outline: The built Admin pages run the idle timeout
    Then the scripts of the built page "<page>" should contain the idle sign-out

    Examples:
      | page                 |
      | /admin/index.html    |
      | /es/admin/index.html |

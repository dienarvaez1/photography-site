Feature: The site renders its photo pages from R2 when they are requested
  As the site owner
  I want a photo to show on the site as soon as its entry is in R2
  So that adding a photo needs no git commit, no build and no deploy

  These scenarios build the site the way `npm run deploy` does and run it in the real Workers runtime
  (workerd, through `wrangler dev`) over a local copy of the web bucket. The bucket is changed while the site is
  running, as the photo tools change the real one. Every request is made the way a browser makes it when a person
  follows a link. (Every other feature tests the same pages as static HTML built from the sample library in
  test-fixtures/photos.)

  Background:
    Given the production build of the site
    And the site is running over a web bucket holding these entries:
      | category | title            | titleEs           | order | featured |
      | astro    | Orion Nebula     | La Nebulosa       | 2     | true     |
      | astro    | Half Moon        | Media luna        | 1     | false    |
      | astro    | Comet            |                   | 3     | false    |
      | nature   | Rockfish         |                   | 1     | true     |
      | events   | Quinceañera      |                   | 1     | false    |

  # --- What is built, and what is left for the Worker ----------------------------------------------------------------------

  Scenario: The build leaves the photo pages to the Worker and still builds the pages that show no photos
    Then the production build should hold static pages for "about, contact, 404" in both languages
    And the production build should hold no static page for the home page, the categories or the Admin page
    And the production build should hold a Worker that renders them

  Scenario: The sitemap lists the pages rendered on request, in both languages
    Then the production build's sitemap should list the home page and every category's page in both languages

  # --- Rendering from R2 ------------------------------------------------------------------------------------------------------------

  Scenario: A category page lists its photos in order, from the bucket
    When I request "/work/astro/"
    Then the site should answer 200
    And the page should list these photos, in this order: "Half Moon, Orion Nebula, Comet"
    And every photo should be shown from the public photo address by its id, in the sizes the gallery offers

  Scenario: The Spanish page uses the Spanish titles, with a fallback to the default title
    When I request "/es/work/astro/"
    Then the site should answer 200
    And the page should list these photos, in this order: "Media luna, La Nebulosa, Comet"
    And the page should be in the language "es"

  Scenario: The home page shows the featured photos and a cover for each category
    When I request "/"
    Then the site should answer 200
    And the page should list these photos, in this order: "Rockfish, Orion Nebula"
    And the category cards should show these covers: "Astrophotography: Half Moon, Nature: Rockfish, Public Events: Quinceañera"

  Scenario: A category with no photos says so, and a hidden category is still a page
    When I request "/work/pets/"
    Then the site should answer 200
    And the page should say "No photos in this category yet"
    When I request "/work/real-estate/"
    Then the site should answer 200
    And the page should say "No photos in this category yet"

  Scenario: The category page shares its first photo
    When I request "/work/astro/"
    Then the page should share its first photo, "Half Moon", at full size

  Scenario: The Admin page knows the titles and thumbnails of the photos in the bucket
    When I request "/admin/"
    Then the site should answer 200
    And the Admin page should know these photos by title: "Half Moon, Orion Nebula, Comet, Rockfish, Quinceañera"

  # --- A photo added while the site is running -------------------------------------------------------------------------------------

  Scenario: A photo published to the bucket is on the site at once, and gone once removed, with no build and no deploy
    When I request "/work/astro/"
    Then the page should list these photos, in this order: "Half Moon, Orion Nebula, Comet"
    When this entry is published to the bucket:
      | category | title       | titleEs | order | featured |
      | astro    | New Comet   |         | 0     | false    |
    And I request "/work/astro/"
    Then the page should list these photos, in this order: "New Comet, Half Moon, Orion Nebula, Comet"
    When "New Comet" is removed from the bucket's manifest
    And I request "/work/astro/"
    Then the page should list these photos, in this order: "Half Moon, Orion Nebula, Comet"

  Scenario: A photo added to a category that had none shows there and on the home page
    When this entry is published to the bucket:
      | category | title    | titleEs | order | featured |
      | pets     | Hansel   |         | 1     | true     |
    And I request "/work/pets/"
    Then the page should list these photos, in this order: "Hansel"
    When I request "/"
    Then the page should list these photos, in this order: "Rockfish, Hansel, Orion Nebula"

  # --- When the bucket is not right ----------------------------------------------------------------------------------------------

  Scenario Outline: A manifest that is missing or is not a manifest is an error, never an empty gallery
    Given the bucket's manifest is <state>
    When I request "<page>"
    Then the site should answer 500
    And the page should not list any photos
    And the page should not say the address does not exist

    Examples:
      | state                       | page         |
      | missing                     | /work/astro/ |
      | missing                     | /            |
      | missing                     | /admin/      |
      | not JSON                    | /work/astro/ |
      | of another version          | /work/astro/ |

  Scenario: One entry the site cannot use is left out and the others still show
    Given the bucket's manifest holds a good entry "Half Moon" and an entry with no title
    When I request "/work/astro/"
    Then the site should answer 200
    And the page should list these photos, in this order: "Half Moon"

  # --- Addresses ---------------------------------------------------------------------------------------------------------------------

  Scenario Outline: An address that is no page gets the localized 404 page with a real 404 status
    When I request "<address>"
    Then the site should answer 404
    And the page title should be "<title>"

    Examples:
      | address             | title                                     |
      | /nothing-here/      | Page not found · Diego Narvaez Photography |
      | /work/nothing/      | Page not found · Diego Narvaez Photography |
      | /work/astro/extra/  | Page not found · Diego Narvaez Photography |
      | /fr/work/astro/     | Page not found · Diego Narvaez Photography |
      | /es/nothing-here/   | Página no encontrada · Diego Narvaez Fotografía |
      | /es/work/nothing/   | Página no encontrada · Diego Narvaez Fotografía |

  Scenario Outline: An address without its trailing slash goes to the one with it
    When I request "<address>" without following redirects
    Then the site should answer 308 and send the visitor to "<target>"

    Examples:
      | address          | target            |
      | /work/astro      | /work/astro/      |
      | /es/work/nature  | /es/work/nature/  |
      | /admin           | /admin/           |

  # --- What Cloudflare does for files, done here for pages -----------------------------------------------------------------

  Scenario Outline: A page rendered by the Worker carries the same security headers as a static one
    When I request "<address>"
    Then the response should carry every header that public/_headers gives all pages, including the Content-Security-Policy
    And the response should not be kept by any cache

    Examples:
      | address        |
      | /              |
      | /es/           |
      | /work/astro/   |
      | /admin/        |
      | /nothing-here/ |

  Scenario: The pages the Worker renders pass the same checks as the static ones
    Then every page rendered on request should be valid HTML with a language, a title, a canonical link and its translations, and no inline script

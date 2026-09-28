Feature: Setting or clearing the home-background flag changes exactly the photos named by their photo id, and nothing else
  As the site owner using the Admin page's Pics Viewer's Home Background button
  I want to mark or unmark one or several photos as the home page's hero background at once
  So that I can choose the home page's background from any category, without touching a command line, and
    never change a photo I did not choose

  Setting or clearing `heroBackground` touches only that one field of the entry named — the photo itself, its
  files in R2, its category and every other field of its entry (title, camera, order, placeholderColor,
  addedAt) are untouched. A photo can be in more than one category at once, so each one is named by its id
  together with the category it is currently filed under: guessing which entry from an id alone would be
  wrong when there is more than one. These scenarios call the photo service's real request handler with a
  fake R2, the way the dev server does. The screens are in browser/photo-hero.feature.

  Background:
    Given an empty photo library and a fake R2
    And the entries live in R2, with the library folder as their local mirror
    And a photo file "moon.jpg" of 1200x700
    And a photo file "fish.jpg" of 1100x700
    And a photo file "dog.jpg" of 1000x700
    And a copy of "dog.jpg" named "dog-again.jpg"
    And I run the command: add moon.jpg --category astro --title "Half Moon" --order 1 --keep-source
    And I run the command: add fish.jpg --category nature --title "Rockfish" --order 1 --keep-source
    And I run the command: add dog.jpg --category pets --title "Hansel" --order 1 --keep-source
    And I run the command: add dog-again.jpg --category landscape --title "Hansel Again" --order 1 --keep-source

  # --- Setting and clearing ---------------------------------------------------------------------------------------------------

  Scenario: Setting a photo as the home background marks its entry, and nothing else
    When I ask the service to set the home background for the photos: "astro/half-moon" to true
    Then the form should answer with status 200
    And the service should report "astro/half-moon" changed
    And the entry "astro/half-moon" should be marked as the home background
    And the entry "astro/half-moon" should exist, with the title "Half Moon" and order 1
    And the photo of "astro/half-moon" should be untouched in R2

  Scenario: Several photos are marked in one request, with one manifest write
    When I remember what R2 has been asked to change
    And I ask the service to set the home background for the photos: "pets/hansel, nature/rockfish" to true
    Then the form should answer with status 200
    And the service should report "pets/hansel" changed
    And the service should report "nature/rockfish" changed
    And the entry "pets/hansel" should be marked as the home background
    And the entry "nature/rockfish" should be marked as the home background
    And the manifest should have been written 1 time since

  Scenario: A photo already marked is left alone, and reported as such
    Given I ask the service to set the home background for the photos: "astro/half-moon" to true
    When I remember what R2 has been asked to change
    And I ask the service to set the home background for the photos: "astro/half-moon" to true
    Then the form should answer with status 200
    And the service should report "astro/half-moon" not changed
    And the manifest should have been written 0 times since
    And the entry "astro/half-moon" should be marked as the home background

  Scenario: Clearing a photo that was never marked changes nothing, and says so
    When I remember what R2 has been asked to change
    And I ask the service to set the home background for the photos: "astro/half-moon" to false
    Then the form should answer with status 200
    And the service should report "astro/half-moon" not changed
    And the manifest should have been written 0 times since
    And the entry "astro/half-moon" should not be marked as the home background

  Scenario: Clearing a marked photo unmarks it, leaving the rest of its entry untouched
    Given I ask the service to set the home background for the photos: "astro/half-moon" to true
    When I ask the service to set the home background for the photos: "astro/half-moon" to false
    Then the form should answer with status 200
    And the service should report "astro/half-moon" changed
    And the entry "astro/half-moon" should not be marked as the home background
    And the entry "astro/half-moon" should exist, with the title "Half Moon" and order 1

  Scenario: One real change and one already-there photo in the same request are each reported correctly
    Given I ask the service to set the home background for the photos: "astro/half-moon" to true
    When I ask the service to set the home background for the photos: "astro/half-moon, nature/rockfish" to true
    Then the form should answer with status 200
    And the service should report "astro/half-moon" not changed
    And the service should report "nature/rockfish" changed

  # --- What is refused: nothing is changed ---------------------------------------------------------------------------------

  Scenario Outline: A request that is not exactly "these photos, by id and category, and true or false" is refused and R2 is left as it was
    Given I take note of everything in R2
    When I send this hero-background request to the service:
      """
      <body>
      """
    Then the form should refuse it with status 400 and the code "bad-request"
    And R2 should hold exactly what it held before

    Examples:
      | what                                    | body                                                                                                                                                 |
      | no photos                               | {"photos": [], "value": true}                                                                                                                       |
      | no photos field                         | {"value": true}                                                                                                                                      |
      | not JSON                                | mark everything                                                                                                                                      |
      | no value field                          | {"photos": [{"id": "<id of astro/half-moon>", "category": "astro"}]}                                                                                |
      | a value that is not true or false       | {"photos": [{"id": "<id of astro/half-moon>", "category": "astro"}], "value": "yes"}                                                                |
      | a photo id that is too short            | {"photos": [{"id": "4c4f", "category": "astro"}], "value": true}                                                                                    |
      | a photo id with capitals                | {"photos": [{"id": "ABCDEF0123456789", "category": "astro"}], "value": true}                                                                        |
      | an unknown category                     | {"photos": [{"id": "<id of astro/half-moon>", "category": "nope"}], "value": true}                                                                  |
      | no category at all                      | {"photos": [{"id": "<id of astro/half-moon>"}], "value": true}                                                                                      |
      | the same photo and category named twice | {"photos": [{"id": "<id of astro/half-moon>", "category": "astro"}, {"id": "<id of astro/half-moon>", "category": "astro"}], "value": true}         |

  Scenario: More than 100 photos in one request are refused, so a slip cannot rewrite the whole archive
    Given I take note of everything in R2
    When I send a hero-background request naming 101 photos
    Then the form should refuse it with status 400 and the code "bad-request"
    And R2 should hold exactly what it held before

  Scenario: A photo named under a category it is not actually filed under is refused, and nothing changes
    Given I take note of everything in R2
    When I ask the service to set the home background for the photos: "astro/half-moon" to true, claiming it is filed under "nature"
    Then the form should refuse it with status 500 and the code "failed"
    And the form's message should mention "is not a photo entry"
    And R2 should hold exactly what it held before

  Scenario Outline: Only the form's own page on localhost may ask for a home-background change
    Given I take note of everything in R2
    When I send POST <address> to the service from the origin "<origin>"
    Then the form should refuse it with status 403 and the code "not-local"
    And R2 should hold exactly what it held before

    Examples:
      | address                                            | origin                   |
      | http://localhost:4321/__photos/hero-background     | https://evil.example     |
      | http://localhost:4321/__photos/hero-background     | none                     |
      | http://192.168.1.20:4321/__photos/hero-background  | http://192.168.1.20:4321 |

  # --- When something goes wrong part-way -----------------------------------------------------------------------------------

  Scenario: If the manifest cannot be published, the entry keeps its old flag, and the change can be retried
    Given R2 will fail to store anything matching "index.json"
    When I ask the service to set the home background for the photos: "astro/half-moon" to true
    Then the form should refuse it with status 500 and the code "failed"
    And the entry "astro/half-moon" should not be marked as the home background
    When R2 works again
    And I ask the service to set the home background for the photos: "astro/half-moon" to true
    Then the form should answer with status 200
    And the entry "astro/half-moon" should be marked as the home background

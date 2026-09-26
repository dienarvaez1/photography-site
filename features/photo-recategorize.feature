Feature: Bulk category change moves exactly the photos named by their photo id, and nothing else
  As the site owner using the Admin page's Edit Photos button
  I want to move one or several photos to a different category at once
  So that I can reorganize the site without touching a command line, and never move a photo I did not choose

  Changing a photo's category renames its entry's file into the new category's folder and republishes the
  manifest — the photo itself, its files in R2 and every other field of its entry (title, camera, order,
  placeholderColor, addedAt) are untouched. A photo can be in more than one category at once, so each one
  is named by its id together with the category it is currently filed under: guessing which entry from an
  id alone would be wrong when there is more than one. These scenarios call the photo service's real
  request handler with a fake R2, the way the dev server does. The screens are in
  browser/photo-recategorize.feature.

  Background:
    Given an empty photo library and a fake R2
    And the entries live in R2, with the library folder as their local mirror
    And a photo file "moon.jpg" of 1200x700
    And a photo file "fish.jpg" of 1100x700
    And a photo file "dog.jpg" of 1000x700
    And a copy of "dog.jpg" named "dog-again.jpg"
    And a photo file "orion.jpg" of 900x700
    And I run the command: add moon.jpg --category astro --title "Half Moon" --order 1 --keep-source
    And I run the command: add fish.jpg --category nature --title "Rockfish" --order 1 --keep-source
    And I run the command: add dog.jpg --category pets --title "Hansel" --order 1 --keep-source
    And I run the command: add dog-again.jpg --category landscape --title "Hansel Again" --order 1 --keep-source
    And I run the command: add orion.jpg --category astro --title "Orion" --order 2 --keep-source

  # --- Only the category changes ---------------------------------------------------------------------------------------------

  Scenario: One photo moves to a new category: its entry, and nothing else
    When I ask the service to move the photos: "astro/half-moon" to "other"
    Then the form should answer with status 200
    And the service should report "astro/half-moon" moved to "other"
    And the entry "other/half-moon" should exist, with the title "Half Moon" and order 1
    And the entry "astro/half-moon" should not exist
    And the manifest in R2 should list exactly: "astro/orion, landscape/hansel-again, nature/rockfish, other/half-moon, pets/hansel"
    And the photo of "other/half-moon" should be untouched in R2

  Scenario: Several photos are moved in one request, with one manifest write
    When I remember what R2 has been asked to change
    And I ask the service to move the photos: "pets/hansel, astro/orion" to "other"
    Then the form should answer with status 200
    And the service should report "pets/hansel" moved to "other"
    And the service should report "astro/orion" moved to "other"
    And the manifest in R2 should list exactly: "astro/half-moon, landscape/hansel-again, nature/rockfish, other/hansel, other/orion"
    And the manifest should have been written 1 time since

  Scenario: A photo already in the target category is left alone, and reported as such
    When I remember what R2 has been asked to change
    And I ask the service to move the photos: "astro/half-moon" to "astro"
    Then the form should answer with status 200
    And the service should report "astro/half-moon" not moved
    And the manifest should have been written 0 times since
    And the entry "astro/half-moon" should exist, with the title "Half Moon" and order 1

  Scenario: One real move and one already-there photo in the same request are each reported correctly
    When I ask the service to move the photos: "astro/half-moon, nature/rockfish" to "astro"
    Then the form should answer with status 200
    And the service should report "astro/half-moon" not moved
    And the service should report "nature/rockfish" moved to "astro"

  Scenario: A photo in two categories moves from only the one named, leaving the other entry as it was
    When I ask the service to move the photos: "pets/hansel" to "other"
    Then the form should answer with status 200
    And the entry "other/hansel" should exist
    And the entry "pets/hansel" should not exist
    And the entry "landscape/hansel-again" should exist, with the title "Hansel Again" and order 1
    And the manifest in R2 should list exactly: "astro/half-moon, astro/orion, landscape/hansel-again, nature/rockfish, other/hansel"

  # --- What is refused: nothing is changed ---------------------------------------------------------------------------------

  Scenario: Moving a photo to a category another entry of the same photo is already in is refused
    Given I take note of everything in R2
    When I ask the service to move the photos: "pets/hansel" to "landscape"
    Then the form should refuse it with status 409 and the code "duplicate"
    And the form's message should mention "already exists"
    And R2 should hold exactly what it held before
    And the entry "pets/hansel" should exist

  Scenario: A photo named under a category it is not actually filed under is refused, and nothing is moved
    Given I take note of everything in R2
    When I ask the service to move the photos: "astro/half-moon" to "other", claiming it is filed under "nature"
    Then the form should refuse it with status 500 and the code "failed"
    And the form's message should mention "is not a photo entry"
    And R2 should hold exactly what it held before
    And the entry "astro/half-moon" should exist

  Scenario Outline: A request that is not exactly "these photos, by id and category, and one destination" is refused and R2 is left as it was
    Given I take note of everything in R2
    When I send this category-change request to the service:
      """
      <body>
      """
    Then the form should refuse it with status 400 and the code "bad-request"
    And R2 should hold exactly what it held before

    Examples:
      | what                                  | body                                                                                                                    |
      | no photos                             | {"photos": [], "toCategory": "other"}                                                                                  |
      | no photos field                       | {"toCategory": "other"}                                                                                                |
      | not JSON                               | move everything                                                                                                        |
      | no destination category               | {"photos": [{"id": "<id of astro/half-moon>", "category": "astro"}]}                                                   |
      | an unknown destination category       | {"photos": [{"id": "<id of astro/half-moon>", "category": "astro"}], "toCategory": "nope"}                             |
      | a photo id that is too short          | {"photos": [{"id": "4c4f", "category": "astro"}], "toCategory": "other"}                                               |
      | a photo id with capitals              | {"photos": [{"id": "ABCDEF0123456789", "category": "astro"}], "toCategory": "other"}                                   |
      | an unknown "from" category            | {"photos": [{"id": "<id of astro/half-moon>", "category": "nope"}], "toCategory": "other"}                             |
      | no "from" category at all             | {"photos": [{"id": "<id of astro/half-moon>"}], "toCategory": "other"}                                                 |
      | the same photo and category named twice | {"photos": [{"id": "<id of astro/half-moon>", "category": "astro"}, {"id": "<id of astro/half-moon>", "category": "astro"}], "toCategory": "other"} |

  Scenario: More than 100 photos in one request are refused, so a slip cannot rewrite the whole archive
    Given I take note of everything in R2
    When I send a category-change request naming 101 photos
    Then the form should refuse it with status 400 and the code "bad-request"
    And R2 should hold exactly what it held before

  Scenario Outline: Only the form's own page on localhost may ask for a category change
    Given I take note of everything in R2
    When I send POST <address> to the service from the origin "<origin>"
    Then the form should refuse it with status 403 and the code "not-local"
    And R2 should hold exactly what it held before

    Examples:
      | address                                          | origin                   |
      | http://localhost:4321/__photos/recategorize      | https://evil.example     |
      | http://localhost:4321/__photos/recategorize      | none                     |
      | http://192.168.1.20:4321/__photos/recategorize   | http://192.168.1.20:4321 |

  Scenario: Entries changed locally and never published stop the change, and nothing is moved
    Given I run the command: pull
    And the local entry "astro/orion" is edited to have order 9
    Given I take note of everything in R2
    When I ask the service to move the photos: "astro/half-moon" to "other"
    Then the form should refuse it with status 500 and the code "failed"
    And the form's message should mention "never published"
    And R2 should hold exactly what it held before
    And the entry "astro/half-moon" should exist, with the title "Half Moon" and order 1

  # --- When something goes wrong part-way -----------------------------------------------------------------------------------

  Scenario: If the manifest cannot be published, the site keeps showing the old category, and the move can be retried
    Given R2 will fail to store anything matching "index.json"
    When I ask the service to move the photos: "astro/half-moon" to "other"
    Then the form should refuse it with status 500 and the code "failed"
    And the entry "astro/half-moon" should exist, with the title "Half Moon" and order 1
    And the entry "other/half-moon" should not exist
    And the manifest in R2 should list exactly: "astro/half-moon, astro/orion, landscape/hansel-again, nature/rockfish, pets/hansel"
    When R2 works again
    And I ask the service to move the photos: "astro/half-moon" to "other"
    Then the form should answer with status 200
    And the entry "other/half-moon" should exist
    And the manifest in R2 should list exactly: "astro/orion, landscape/hansel-again, nature/rockfish, other/half-moon, pets/hansel"

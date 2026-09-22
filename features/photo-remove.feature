Feature: Bulk removal deletes exactly the photos named by their photo id, and nothing else
  As the site owner using the Admin page's Remove Photos button
  I want to delete several photos at once from both R2 buckets
  So that a removal can never touch a photo I did not choose

  Removing a photo deletes, for its photo id: the entries that use it (from the site first, through the manifest),
  then its original in the private originals bucket and its web sizes in the public web bucket. These scenarios call
  the photo service's real request handler with a fake R2, the way the dev server does. The screens are in
  browser/photo-remove.feature.

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

  # --- Only the photos named are removed -----------------------------------------------------------------------------------

  Scenario: One photo is removed completely: its original, its web sizes and its entry
    When I ask the service to remove the photos: "astro/half-moon"
    Then the form should answer with status 200
    And the service should report 6 files deleted for "astro/half-moon"
    And nothing of the photos "astro/half-moon" should be left in R2
    And the photos "nature/rockfish, pets/hansel, landscape/hansel-again, astro/orion" should be completely untouched in R2
    And the manifest in R2 should list exactly: "astro/orion, landscape/hansel-again, nature/rockfish, pets/hansel"
    And the private originals bucket should hold exactly the originals of: "astro/orion, nature/rockfish, pets/hansel"
    And the public web bucket should hold exactly the web sizes, entry files and manifest of: "astro/orion, nature/rockfish, pets/hansel, landscape/hansel-again"
    And the entry "astro/half-moon" should not exist

  Scenario: Several photos are removed in one request, with one manifest write
    When I remember what R2 has been asked to change
    And I ask the service to remove the photos: "astro/half-moon, nature/rockfish"
    Then the form should answer with status 200
    And the service should report 6 files deleted for "astro/half-moon"
    And the service should report 6 files deleted for "nature/rockfish"
    And nothing of the photos "astro/half-moon, nature/rockfish" should be left in R2
    And the photos "pets/hansel, landscape/hansel-again, astro/orion" should be completely untouched in R2
    And the manifest in R2 should list exactly: "astro/orion, landscape/hansel-again, pets/hansel"
    And the manifest should have been written 1 time since
    And the manifest should have been published before any file of the removed photos was deleted

  Scenario: A photo in two categories goes from both, since its files are shared
    When I ask the service to remove the photos: "pets/hansel"
    Then the form should answer with status 200
    And the service should report entries removed from "pets, landscape" for "pets/hansel"
    And nothing of the photos "pets/hansel, landscape/hansel-again" should be left in R2
    And the photos "astro/half-moon, nature/rockfish, astro/orion" should be completely untouched in R2
    And the manifest in R2 should list exactly: "astro/half-moon, astro/orion, nature/rockfish"

  Scenario: Every photo can be removed, leaving an empty but valid manifest
    When I ask the service to remove the photos: "astro/half-moon, nature/rockfish, pets/hansel, astro/orion"
    Then the form should answer with status 200
    And the manifest in R2 should list exactly: ""
    And the private originals bucket should hold 0 objects
    And the public web bucket should hold exactly the web sizes, entry files and manifest of: ""

  Scenario: A photo whose id differs by one character is not touched, nor is any file that is not a photo's own
    Given the buckets also hold the files of a photo whose id differs from the one of "astro/half-moon" by its last character
    And the buckets also hold these unrelated files:
      | bucket    | key                                        |
      | web       | photos/notes.txt                           |
      | web       | photos/categories/astro/README.md          |
      | web       | logos/brand.png                            |
      | originals | photos/notes.txt                           |
      | originals | backups/2026/half-moon-original.jpg        |
    When I ask the service to remove the photos: "astro/half-moon"
    Then the form should answer with status 200
    And nothing of the photos "astro/half-moon" should be left in R2
    And the look-alike photo should be completely untouched in R2
    And the unrelated files should all still be in R2

  Scenario: An original nothing on the site uses can be removed too, and the manifest is left alone
    Given the originals bucket also holds an original that no entry uses: "photos/00000000000000aa/original.png"
    When I remember what R2 has been asked to change
    And I ask the service to remove the orphan original "photos/00000000000000aa/original.png"
    Then the form should answer with status 200
    And R2 should no longer hold "photos/00000000000000aa/original.png" in the originals bucket
    And the manifest should have been written 0 times since
    And the photos "astro/half-moon, nature/rockfish, pets/hansel, landscape/hansel-again, astro/orion" should be completely untouched in R2

  # --- What is refused: nothing is changed ---------------------------------------------------------------------------------

  Scenario Outline: A request that is not exactly "these photos, by id and original key" is refused and R2 is left as it was
    Given I take note of everything in R2
    When I send this removal request to the service:
      """
      <body>
      """
    Then the form should refuse it with status 400 and the code "bad-request"
    And R2 should hold exactly what it held before
    And the photos "astro/half-moon, nature/rockfish, pets/hansel, landscape/hansel-again, astro/orion" should be completely untouched in R2

    Examples:
      | what                                        | body                                                                                                                                  |
      | no photos                                   | {"photos": []}                                                                                                                        |
      | no photos field                             | {}                                                                                                                                    |
      | not JSON                                    | remove everything                                                                                                                     |
      | a photo id that is too short                | {"photos": [{"id": "4c4f", "key": "photos/4c4f/original.jpg"}]}                                                                       |
      | a photo id with capitals                    | {"photos": [{"id": "ABCDEF0123456789", "key": "photos/ABCDEF0123456789/original.jpg"}]}                                               |
      | an id with a wildcard                       | {"photos": [{"id": "*", "key": "photos/*/original.jpg"}]}                                                                             |
      | a category name instead of an id            | {"photos": [{"id": "astro", "key": "photos/astro/original.jpg"}]}                                                                     |
      | a key that is a web size                    | {"photos": [{"id": "<id of astro/half-moon>", "key": "photos/<id of astro/half-moon>/thumb.webp"}]}                                   |
      | a key that is the entry file                | {"photos": [{"id": "<id of astro/half-moon>", "key": "photos/categories/astro/<id of astro/half-moon>.md"}]}                          |
      | a key that is the manifest                  | {"photos": [{"id": "<id of astro/half-moon>", "key": "photos/index.json"}]}                                                           |
      | a key that climbs out of the photo's folder | {"photos": [{"id": "<id of astro/half-moon>", "key": "photos/<id of astro/half-moon>/../<id of nature/rockfish>/original.jpg"}]}      |
      | a key with a sub-folder                     | {"photos": [{"id": "<id of astro/half-moon>", "key": "photos/<id of astro/half-moon>/x/original.jpg"}]}                               |
      | a key of a different photo                  | {"photos": [{"id": "<id of astro/half-moon>", "key": "photos/<id of nature/rockfish>/original.jpg"}]}                                 |
      | the same photo named twice                  | {"photos": [{"id": "<id of astro/half-moon>", "key": "photos/<id of astro/half-moon>/original.jpg"}, {"id": "<id of astro/half-moon>", "key": "photos/<id of astro/half-moon>/original.jpg"}]} |
      | a good photo and a bad one                  | {"photos": [{"id": "<id of astro/half-moon>", "key": "photos/<id of astro/half-moon>/original.jpg"}, {"id": "nope", "key": "photos/nope/original.jpg"}]} |

  Scenario: More than 100 photos in one request are refused, so a slip cannot empty the archive
    Given I take note of everything in R2
    When I send a removal request naming 101 photos
    Then the form should refuse it with status 400 and the code "bad-request"
    And R2 should hold exactly what it held before

  Scenario Outline: Only the form's own page on localhost may ask for a removal
    Given I take note of everything in R2
    When I send POST <address> to the service from the origin "<origin>"
    Then the form should refuse it with status 403 and the code "not-local"
    And R2 should hold exactly what it held before

    Examples:
      | address                                   | origin                   |
      | http://localhost:4321/__photos/remove     | https://evil.example     |
      | http://localhost:4321/__photos/remove     | none                     |
      | http://192.168.1.20:4321/__photos/remove  | http://192.168.1.20:4321 |

  Scenario: Entries changed locally and never published stop the removal, and nothing is deleted
    Given I run the command: pull
    And the local entry "astro/orion" is edited to have order 9
    Given I take note of everything in R2
    When I ask the service to remove the photos: "astro/half-moon"
    Then the form should refuse it with status 500 and the code "failed"
    And the form's message should mention "never published"
    And R2 should hold exactly what it held before

  # --- When something goes wrong part-way -----------------------------------------------------------------------------------

  Scenario: If the entries cannot be unpublished nothing is deleted, and the local mirror is put back
    Given I take note of everything in R2
    And R2 will fail to store anything matching "index.json"
    When I ask the service to remove the photos: "astro/half-moon"
    Then the form should refuse it with status 500 and the code "failed"
    And R2 should hold exactly what it held before
    And the entry "astro/half-moon" should exist
    When R2 works again
    And I ask the service to remove the photos: "astro/half-moon"
    Then the form should answer with status 200
    And nothing of the photos "astro/half-moon" should be left in R2

  Scenario: A photo whose files cannot be deleted fails alone; the others are still removed, and it can be retried
    Given R2 will fail to delete anything matching the photo id of "nature/rockfish"
    When I ask the service to remove the photos: "astro/half-moon, nature/rockfish, astro/orion"
    Then the form should answer with status 200
    And the service should report 6 files deleted for "astro/half-moon"
    And the service should report 6 files deleted for "astro/orion"
    And the service should report a failure for "nature/rockfish" mentioning "simulated delete failure"
    And nothing of the photos "astro/half-moon, astro/orion" should be left in R2
    And the manifest in R2 should list exactly: "landscape/hansel-again, pets/hansel"
    When R2 works again
    And I ask the service to remove the orphan original of the earlier photo "nature/rockfish"
    Then the form should answer with status 200
    And nothing of the photos "nature/rockfish" should be left in R2

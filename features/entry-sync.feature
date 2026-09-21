Feature: The photo entries live in R2, and the local folder is only a mirror
  As the site owner
  I want a photo to be on the site as soon as its entry is published to R2
  So that nothing has to be committed or deployed to show a new photo

  Entries are photos/categories/<category>/<photo id>.md in the web bucket, plus photos/index.json: every entry's data
  in one sorted file, which the site reads when a page is requested. The photo commands work on a local folder
  of .md files and keep it in step with R2. These scenarios run the real commands against a fake R2.

  Background:
    Given an empty photo library and a fake R2
    And the entries live in R2, with the library folder as their local mirror

  # --- Publishing ------------------------------------------------------------------------------------------------------

  Scenario: Adding a photo publishes its entry file and the manifest
    Given a photo file "moon.jpg" of 1200x700
    When I run the command: add moon.jpg --category astro --title "Half Moon" --title-es "Media luna" --order 3
    Then the command should succeed
    And the output should mention "photos/categories/astro/"
    And the entry "astro/half-moon" should be in R2 as its own .md file, identical to the local file
    And the manifest in R2 should list exactly: "astro/half-moon"
    And the manifest entry "astro/half-moon" should carry the same data as the local entry
    And the local file "moon.jpg" should be gone

  Scenario: The manifest is sorted by category and order, so an unchanged library gives an unchanged file
    Given a photo file "one.jpg" of 1200x700
    And a photo file "two.jpg" of 1100x700
    And a photo file "three.jpg" of 1000x700
    When I run the command: add one.jpg --category nature --title "Rockfish" --order 2
    And I run the command: add two.jpg --category astro --title "Orion" --order 5
    And I run the command: add three.jpg --category astro --title "Half Moon" --order 3
    Then the manifest in R2 should list exactly: "astro/half-moon, astro/orion, nature/rockfish"

  Scenario: The entry file is written before the manifest, which is what makes the entry appear
    Given a photo file "moon.jpg" of 1200x700
    When I run the command: add moon.jpg --category astro --title "Half Moon"
    Then the R2 change "web: put photos/categories/astro/" should have happened before the R2 change "web: put photos/index.json"
    And the R2 change "web: put photos/" should have happened before the R2 change "web: put photos/index.json"

  Scenario: A manifest that cannot be stored leaves the site as it was, and keeps the local photo file
    Given a photo file "moon.jpg" of 1200x700
    And R2 will fail to store anything matching "index.json"
    When I run the command: add moon.jpg --category astro --title "Half Moon"
    Then the command should fail with exit code 1
    And the local file "moon.jpg" should still exist
    And R2 should hold no manifest

  Scenario: Publishing again with nothing changed writes nothing
    Given a photo file "moon.jpg" of 1200x700
    And I run the command: add moon.jpg --category astro --title "Half Moon" --keep-source
    When I remember what R2 has been asked to change
    And I run the command: push
    Then the command should succeed
    And the output should mention "0 entries published, 0 removed"
    And R2 should not have been asked to change anything since

  # --- Removing and replacing ------------------------------------------------------------------------------------------------

  Scenario: Removing an entry takes it off the site before its photo's files are deleted
    Given a photo file "moon.jpg" of 1200x700
    And I run the command: add moon.jpg --category astro --title "Half Moon"
    And I remember what R2 has been asked to change
    When I run the command: remove "Half Moon"
    Then the command should succeed
    And the manifest in R2 should list exactly: ""
    And R2 should hold no entry file for "astro"
    And the R2 change "web: put photos/index.json" should have happened before the R2 change "delete photos/"
    And the private originals bucket should hold 0 objects

  Scenario: Replacing a photo points the site at the new one before the old one's files are deleted
    Given a photo file "one.jpg" of 1200x700
    And a photo file "two.jpg" of 1100x700
    And I run the command: add one.jpg --category astro --title "Half Moon"
    And I remember the photo id of "astro/half-moon"
    And I remember what R2 has been asked to change
    When I run the command: replace "Half Moon" two.jpg
    Then the command should succeed
    And the manifest in R2 should list exactly: "astro/half-moon"
    And the manifest entry "astro/half-moon" should carry the same data as the local entry
    And the entry file of the remembered photo should be gone from R2
    And the R2 change "web: put photos/index.json" should have happened before the R2 change "web: delete photos/categories/astro/"

  Scenario: Filling in a missing camera line publishes the change
    Given a photo file "moon.jpg" of 1200x700 with EXIF:
      | Make  | NIKON CORPORATION |
      | Model | NIKON Z 8         |
    And I run the command: add moon.jpg --category astro --title "Half Moon" --camera "" --keep-source
    When I run the command: camera
    Then the command should succeed
    And the manifest entry "astro/half-moon" should carry the same data as the local entry
    And the manifest entry "astro/half-moon" should have the camera line "Nikon Z 8"

  # --- Pulling -------------------------------------------------------------------------------------------------------------------------

  Scenario: A fresh folder gets every entry from R2, as the same text the tools write
    Given R2 holds these entries:
      | category | title      | order | camera                |
      | astro    | Half Moon  | 3     | Nikon Z 8 · 800mm     |
      | nature   | Rockfish   | 1     |                       |
    When I run the command: pull
    Then the command should succeed
    And the output should mention "2 entries in R2"
    And the local entry "astro/half-moon" should read exactly what its R2 data serialises to
    And the local entry "nature/rockfish" should read exactly what its R2 data serialises to
    And the folder "astro/images" should contain exactly 1 entry file, each named after its photo id

  Scenario: Pulling brings in an entry added elsewhere and drops one removed elsewhere
    Given R2 holds these entries:
      | category | title      | order | camera |
      | astro    | Half Moon  | 3     |        |
    And I run the command: pull
    When R2 holds these entries:
      | category | title      | order | camera |
      | astro    | Orion      | 1     |        |
    And I run the command: pull
    Then the entry "astro/orion" should exist
    And the entry "astro/half-moon" should not exist

  Scenario: Commands start from R2's entries, so an order is chosen from what is really there
    Given R2 holds these entries:
      | category | title      | order | camera |
      | astro    | Half Moon  | 4     |        |
    And a photo file "orion.jpg" of 1200x700
    When I run the command: add orion.jpg --category astro --title "Orion" --order 5
    Then the command should succeed
    And the manifest in R2 should list exactly: "astro/half-moon, astro/orion"

  Scenario: Pulling refuses to overwrite changes that were never published
    Given R2 holds these entries:
      | category | title      | order | camera |
      | astro    | Half Moon  | 3     |        |
    And I run the command: pull
    And the local entry "astro/half-moon" is edited to have order 9
    When I run the command: pull
    Then the command should fail with exit code 1
    And the error output should mention "never published"
    And the entry "astro/half-moon" should still have order 9
    When I run the command: pull --force
    Then the command should succeed
    And the entry "astro/half-moon" should still have order 3

  Scenario: Publishing what was edited by hand puts it on the site
    Given R2 holds these entries:
      | category | title      | order | camera |
      | astro    | Half Moon  | 3     |        |
    And I run the command: pull
    And the local entry "astro/half-moon" is edited to have order 9
    When I run the command: push
    Then the command should succeed
    And the output should mention "1 entry published"
    And the manifest entry "astro/half-moon" should carry the same data as the local entry
    And the manifest entry "astro/half-moon" should have order 9

  # --- Checking ------------------------------------------------------------------------------------------------------------------------

  Scenario: Verify also checks that every entry's file is in R2
    Given a photo file "moon.jpg" of 1200x700
    And I run the command: add moon.jpg --category astro --title "Half Moon"
    When I run the command: verify
    Then the command should succeed
    When the entry file of "astro/half-moon" disappears from R2
    And I run the command: verify
    Then the command should fail with exit code 1
    And the error output should mention "entry file missing in web bucket"

  Scenario Outline: A manifest with an entry the site cannot use is refused, and nothing is dropped
    Given R2 holds a manifest with a broken entry: <what>
    When I run the command: pull
    Then the command should fail with exit code 1
    And the error output should mention "<message>"

    Examples:
      | what                       | message                     |
      | a title that is missing    | has no title                |
      | a photo id that is invalid | has no valid photo id       |
      | an order that is missing   | has no order                |
      | a size that is missing     | has no valid photo          |

  Scenario: An entry that cannot be published is refused with the reason
    Given an entry "astro/legacy" with no photo id
    When I run the command: push
    Then the command should fail with exit code 1
    And the error output should mention "has no valid photo id"

  Scenario: The manifest format is plain data the site can read without Markdown
    Given a photo file "moon.jpg" of 1200x700
    And I run the command: add moon.jpg --category astro --title "Half Moon" --title-es "Media luna" --order 3
    Then the manifest in R2 should be JSON of version 1 holding, for each entry, its category, photo id and data

  # --- Where an uploaded photo's files end up ---------------------------------------------------------------------------------------
  # original.jpg -> the PRIVATE originals bucket; web sizes, the entry's .md and index.json -> the PUBLIC web bucket.

  Scenario: Each file of a new photo lands in its own bucket, under its own key
    Given a photo file "moon.jpg" of 1200x700 with EXIF:
      | Make            | NIKON CORPORATION |
      | Model           | NIKON Z 8         |
      | FocalLength     | 800               |
      | FNumber         | 11                |
      | ExposureTime    | 1/125             |
      | ISOSpeedRatings | 640               |
    And I remember the bytes of the photo file "moon.jpg"
    When I run the command: add moon.jpg --category astro --title "Half Moon" --title-es "Media luna" --order 3
    Then the command should succeed
    And the private originals bucket should hold exactly the originals of: "astro/half-moon"
    And the stored original should be byte for byte the photo that was sent
    And the public web bucket should hold exactly the web sizes, entry files and manifest of: "astro/half-moon"
    And nothing but originals should be in the private originals bucket
    And no original should be in the public web bucket
    And every photo id in the manifest should be the hash of its original in R2

  Scenario: The manifest holds the new entry with every field the site uses, and nothing else
    Given a photo file "moon.jpg" of 1200x700 with EXIF:
      | Make            | NIKON CORPORATION                           |
      | Model           | NIKON Z 8                                   |
      | LensModel       | NIKKOR Z 100-400mm f/4.5-5.6 VR S + TC-2.0x |
      | FocalLength     | 800                                         |
      | FNumber         | 11                                          |
      | ExposureTime    | 1/125                                       |
      | ISOSpeedRatings | 640                                         |
    When I run the command: add moon.jpg --category astro --title "Half Moon" --title-es "Media luna" --order 3 --featured
    Then the command should succeed
    And the manifest in R2 should hold exactly these entries:
      | category | title     | titleEs    | width | height | camera                                                                                     | featured | order |
      | astro    | Half Moon | Media luna | 1200  | 700    | Nikon Z 8 · NIKKOR Z 100-400mm f/4.5-5.6 VR S + TC-2.0x · 800mm · f/11 · 1/125s · ISO 640 | true     | 3     |
    And the manifest's update time should be the time of this run
    And every manifest entry should equal the front matter of its entry file in R2

  Scenario: A photo rotated by its EXIF orientation is listed at the size it is displayed
    Given a photo file "portrait.jpg" of 1200x800 stored with EXIF orientation 6
    When I run the command: add portrait.jpg --category portrait --title "Standing" --order 1
    Then the manifest in R2 should hold exactly these entries:
      | category | title    | titleEs | width | height | camera | featured | order |
      | portrait | Standing |         | 800   | 1200   |        | false    | 1     |

  Scenario: Every upload adds to the manifest and keeps what was already there
    Given a photo file "one.jpg" of 1200x700
    And a photo file "two.jpg" of 1100x700
    And a photo file "three.jpg" of 1000x700
    When I run the command: add one.jpg --category nature --title "Rockfish" --order 1
    Then the manifest in R2 should hold exactly these entries:
      | category | title    | titleEs | width | height | camera | featured | order |
      | nature   | Rockfish |         | 1200  | 700    |        | false    | 1     |
    When I run the command: add two.jpg --category astro --title "Orion" --title-es "Orión" --order 2
    Then the manifest in R2 should hold exactly these entries:
      | category | title    | titleEs | width | height | camera | featured | order |
      | astro    | Orion    | Orión   | 1100  | 700    |        | false    | 2     |
      | nature   | Rockfish |         | 1200  | 700    |        | false    | 1     |
    When I run the command: add three.jpg --category astro --title "Half Moon" --order 1
    Then the manifest in R2 should hold exactly these entries:
      | category | title     | titleEs | width | height | camera | featured | order |
      | astro    | Half Moon |         | 1000  | 700    |        | false    | 1     |
      | astro    | Orion     | Orión   | 1100  | 700    |        | false    | 2     |
      | nature   | Rockfish  |         | 1200  | 700    |        | false    | 1     |
    And the private originals bucket should hold exactly the originals of: "astro/half-moon, astro/orion, nature/rockfish"
    And the public web bucket should hold exactly the web sizes, entry files and manifest of: "astro/half-moon, astro/orion, nature/rockfish"
    And every photo id in the manifest should be the hash of its original in R2
    And every manifest entry should equal the front matter of its entry file in R2

  Scenario: The same photo in two categories is stored once, with an entry file and a manifest entry for each
    Given a photo file "moon.jpg" of 1200x700
    And a copy of "moon.jpg" named "moon-again.jpg"
    When I run the command: add moon.jpg --category astro --title "Half Moon" --order 1
    And I run the command: add moon-again.jpg --category nature --title "Moon Over Trees" --order 4
    Then the private originals bucket should hold 1 object
    And the public web bucket should hold exactly the web sizes, entry files and manifest of: "astro/half-moon, nature/moon-over-trees"
    And the manifest in R2 should hold exactly these entries:
      | category | title           | titleEs | width | height | camera | featured | order |
      | astro    | Half Moon       |         | 1200  | 700    |        | false    | 1     |
      | nature   | Moon Over Trees |         | 1200  | 700    |        | false    | 4     |
    And every photo id in the manifest should be the hash of its original in R2

  Scenario: The files of a new photo are uploaded in the order that keeps the site whole
    Given a photo file "moon.jpg" of 1200x700
    When I run the command: add moon.jpg --category astro --title "Half Moon"
    Then the R2 change "originals: put photos/" should have happened before the R2 change ".webp"
    And the R2 change ".webp" should have happened before the R2 change "web: put photos/categories/astro/"
    And the R2 change "web: put photos/categories/astro/" should have happened before the R2 change "web: put photos/index.json"

  Scenario Outline: A photo added to any category is published under that category, in the right buckets
    Given a photo file "moon.jpg" of 1200x700
    When I run the command: add moon.jpg --category <category> --title "Sample" --order 1
    Then the command should succeed
    And the entry "<category>/sample" should be published in R2 under "photos/categories/<category>/"
    And the private originals bucket should hold exactly the originals of: "<category>/sample"
    And the public web bucket should hold exactly the web sizes, entry files and manifest of: "<category>/sample"
    And the manifest in R2 should hold exactly these entries:
      | category   | title  | titleEs | width | height | camera | featured | order |
      | <category> | Sample |         | 1200  | 700    |        | false    | 1     |
    And every manifest entry should equal the front matter of its entry file in R2

    Examples:
      | category    |
      | real-estate |
      | landscape   |
      | portrait    |
      | astro       |
      | pets        |
      | nature      |
      | events      |
      | other       |

  Scenario: Every configured category, including any added later, publishes its photos the same way
    Then adding a photo to every configured category with the entries in R2 should publish each one under its own category folder and list it in the manifest

  # --- When an upload fails part-way: what R2 is left holding ---------------------------------------------------------------------

  Scenario: An original that cannot be stored leaves R2 with nothing of the photo, and the local file
    Given a photo file "moon.jpg" of 1200x700
    And R2 will fail to store anything matching "original.jpg"
    When I run the command: add moon.jpg --category astro --title "Half Moon"
    Then the command should fail with exit code 1
    And the private originals bucket should hold 0 objects
    And the public web bucket should hold no entry file and no manifest
    And the local file "moon.jpg" should still exist

  Scenario: A web size that cannot be stored publishes no entry, so the site never lists a photo with missing sizes
    Given a photo file "moon.jpg" of 1200x700
    And R2 will fail to store anything matching "cover.webp"
    When I run the command: add moon.jpg --category astro --title "Half Moon"
    Then the command should fail with exit code 1
    And the public web bucket should hold no entry file and no manifest
    And the local file "moon.jpg" should still exist

  Scenario: An entry file that cannot be stored leaves the manifest as it was
    Given a photo file "one.jpg" of 1200x700
    And a photo file "two.jpg" of 1100x700
    And I run the command: add one.jpg --category astro --title "Half Moon"
    And R2 will fail to store anything matching ".md"
    When I run the command: add two.jpg --category astro --title "Orion"
    Then the command should fail with exit code 1
    And the manifest in R2 should hold exactly these entries:
      | category | title     | titleEs | width | height | camera | featured | order |
      | astro    | Half Moon |         | 1200  | 700    |        | false    | 0     |
    And the local file "two.jpg" should still exist

  Scenario: A manifest that could not be stored is completed by publishing again, with every file where it belongs
    Given a photo file "moon.jpg" of 1200x700
    And R2 will fail to store anything matching "index.json"
    And I run the command: add moon.jpg --category astro --title "Half Moon" --order 2
    And R2 works again
    When I run the command: push
    Then the command should succeed
    And the manifest in R2 should hold exactly these entries:
      | category | title     | titleEs | width | height | camera | featured | order |
      | astro    | Half Moon |         | 1200  | 700    |        | false    | 2     |
    And the private originals bucket should hold exactly the originals of: "astro/half-moon"
    And the public web bucket should hold exactly the web sizes, entry files and manifest of: "astro/half-moon"
    And every manifest entry should equal the front matter of its entry file in R2

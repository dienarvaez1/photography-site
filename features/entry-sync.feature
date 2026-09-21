Feature: The photo entries live in R2, and the local folder is only a mirror
  As the site owner
  I want a photo to be on the site as soon as its entry is published to R2
  So that nothing has to be committed or deployed to show a new photo

  Entries are photos/<category>/<photo id>.md in the web bucket, plus photos/index.json: every entry's data
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
    And the output should mention "photos/astro/"
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
    Then the R2 change "web: put photos/astro/" should have happened before the R2 change "web: put photos/index.json"
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
    And the R2 change "web: put photos/index.json" should have happened before the R2 change "web: delete photos/astro/"

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

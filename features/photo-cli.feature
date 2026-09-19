Feature: Photo command line places entries consistently
  As the site owner using `npm run photos:add`
  I want every new entry written as <category>/images/<photo id>.md
  So that all entries share one layout and one naming rule, and a typo in the category can
  never create a stray folder that breaks the build

  These scenarios run the real command-line code with a fake R2 and a temporary content folder.

  Background:
    Given an empty photo library and a fake R2

  # --- Where entries go -----------------------------------------------------------

  Scenario: The entry location is <category>/images/<photo id>.md
    Then the entry path for category "nature" and photo id "a1b2c3d4e5f6a7b8" should be "nature/images/a1b2c3d4e5f6a7b8.md"

  Scenario: Adding from the command line writes <category>/images/<photo id>.md
    Given a photo file "sunset.jpg" of 1200x800
    When I run the command: add sunset.jpg --category landscape --title "Sunset"
    Then the command should succeed
    And the output should mention "landscape/images/"
    And the entry "landscape/sunset" should be stored as "landscape/images" named after its photo id
    And the category folder "landscape" should contain only the folder "images"
    And the folder "landscape/images" should contain exactly 1 entry file, each named after its photo id
    And the local file "sunset.jpg" should be gone

  Scenario Outline: The location depends on the category, never on the title
    Given a photo file "photo.jpg" of 900x600
    When I run the command: add photo.jpg --category <category> --title "<title>"
    Then the command should succeed
    And the entry "<category>/<reference>" should be stored as "<category>/images" named after its photo id
    And the folder "<category>/images" should contain exactly 1 entry file, each named after its photo id

    Examples:
      | category  | title                      | reference                  |
      | nature    | Rockfish                   | rockfish                   |
      | astro     | Orion Nebula               | orion-nebula               |
      | events    | Quinceañera Portrait       | quinceanera-portrait       |
      | landscape | Hawthorne Bridge, Portland | hawthorne-bridge-portland  |
      | pets      | Hansel                     | hansel                     |

  Scenario: Every configured category accepts new photos and gets the same layout
    Then adding a photo to every configured category should create one id-named entry in each category's images folder

  Scenario: Replacing renames the entry to the new photo id and removing deletes it
    Given a photo file "one.jpg" of 900x600
    And a photo file "two.jpg" of 950x600
    When I run the command: add one.jpg --category nature --title "Stays Put"
    And I run the command: replace "Stays Put" two.jpg
    Then the command should succeed
    And the entry "nature/stays-put" should be stored as "nature/images" named after its photo id
    And the folder "nature/images" should contain exactly 1 entry file, each named after its photo id
    When I run the command: remove "Stays Put"
    Then the command should succeed
    And the folder "nature/images" should contain no files

  # --- Referring to an entry -----------------------------------------------------------

  Scenario Outline: An entry can be referred to by its photo id, its title, or its path
    Given a photo file "one.jpg" of 900x600
    And a photo file "two.jpg" of 950x600
    When I run the command: add one.jpg --category nature --title "Rockfish"
    And I run the command: replace <reference> two.jpg
    Then the command should succeed
    And the entry "nature/rockfish" should reference a photo of 950x600 with a 16-character content id

    Examples:
      | reference                    |
      | {id of nature/rockfish}      |
      | rockfish                     |
      | ROCKFISH                     |
      | {path of nature/rockfish}    |

  Scenario: A title that matches two entries must be given as an id or a path
    Given a photo file "n.jpg" of 900x600
    And a photo file "p.jpg" of 901x600
    And a photo file "r.jpg" of 902x600
    When I run the command: add n.jpg --category nature --title "Twin"
    And I run the command: add p.jpg --category pets --title "Twin"
    And I run the command: replace twin r.jpg
    Then the command should fail with exit code 1
    And the error output should mention "matches 2 entries"
    And the local file "r.jpg" should still exist
    When I run the command: replace {id of nature/twin} r.jpg
    Then the command should succeed

  Scenario: An unknown entry is reported
    When I run the command: remove nothing-here
    Then the command should fail with exit code 1
    And the error output should mention "No photo entry matches"

  # --- Options --------------------------------------------------------------------

  Scenario: Every option is read from the command line
    Given a photo file "all.jpg" of 900x600
    When I run the command: add all.jpg --category nature --title "All Options" --title-es "Todas las Opciones" --camera "Custom Camera" --order 3 --featured
    Then the command should succeed
    And the entry "nature/all-options" should have the title "All Options" and the Spanish title "Todas las Opciones"
    And the entry "nature/all-options" should have the camera line "Custom Camera"
    And the entry "nature/all-options" should still have order 3
    And the entry "nature/all-options" should be featured
    And the entry "nature/all-options" should only have these fields: title, titles, category, photo, camera, featured, order

  Scenario Outline: Options that no longer exist are rejected and nothing is created
    Given a photo file "sunset.jpg" of 1200x800
    When I run the command: add sunset.jpg --category nature --title "Sunset" <option>
    Then the command should fail with exit code 1
    And the error output should mention "<flag>"
    And nothing should have been uploaded
    And the library should contain no entries and no category folders
    And the local file "sunset.jpg" should still exist

    Examples:
      | option                   | flag        |
      | --copyright "(C) Me"     | --copyright |
      | --slug my-name           | --slug      |

  Scenario: The local file is kept when asked
    Given a photo file "keep.jpg" of 900x600
    When I run the command: add keep.jpg --category nature --title "Keep" --keep-source
    Then the command should succeed
    And the local file "keep.jpg" should still exist
    And the entry "nature/keep" should exist

  Scenario: The camera line is captured from EXIF when adding from the command line
    Given a photo file "tagged.jpg" of 900x600 with EXIF:
      | Make            | NIKON CORPORATION |
      | Model           | NIKON Z 7         |
      | FocalLength     | 140               |
      | ISOSpeedRatings | 110               |
      | Copyright       | (C) Someone       |
    When I run the command: add tagged.jpg --category nature --title "Tagged"
    Then the command should succeed
    And the entry "nature/tagged" should have the camera line "Nikon Z 7 · 140mm · ISO 110"
    And the entry "nature/tagged" should only have these fields: title, category, photo, camera, featured, order

  Scenario: A camera line can be set when replacing from the command line
    Given a photo file "one.jpg" of 900x600
    And a photo file "two.jpg" of 950x600
    When I run the command: add one.jpg --category nature --title "Swap"
    And I run the command: replace swap two.jpg --camera "Custom Camera"
    Then the command should succeed
    And the entry "nature/swap" should have the camera line "Custom Camera"

  # --- Bad input is refused before anything is uploaded --------------------------------

  Scenario Outline: Bad input is refused, and nothing is uploaded, created or deleted
    Given a photo file "sunset.jpg" of 1200x800
    When I run the command: <command>
    Then the command should fail with exit code 1
    And the error output should mention "<message>"
    And nothing should have been uploaded
    And the library should contain no entries and no category folders
    And the local file "sunset.jpg" should still exist

    Examples:
      | command                                                    | message                     |
      | add sunset.jpg --category astrophotography --title "Orion" | Unknown category            |
      | add sunset.jpg --category Nature --title "Orion"           | Unknown category            |
      | add sunset.jpg --title "Orion"                             | --category is required      |
      | add sunset.jpg --category nature                           | --title is required         |
      | add --category nature --title "Orion"                      | Pass exactly one photo file |

  Scenario: An unknown category's error names the mistake and lists the categories that do exist
    Given a photo file "sunset.jpg" of 1200x800
    When I run the command: add sunset.jpg --category astrophotography --title "Orion"
    Then the error output should mention "astrophotography"
    And the error output should mention "astro"
    And the error output should mention "landscape"
    And the error output should mention "nature"

  Scenario: Adding the same photo to the same category again is refused
    Given a photo file "a.jpg" of 900x600
    And a copy of "a.jpg" named "b.jpg"
    When I run the command: add a.jpg --category nature --title "First"
    And I run the command: add b.jpg --category nature --title "Again"
    Then the command should fail with exit code 1
    And the error output should mention "already exists"
    And the local file "b.jpg" should still exist
    And the folder "nature/images" should contain exactly 1 entry file, each named after its photo id

  # --- Other commands ---------------------------------------------------------------

  Scenario: Help is shown for "help", and an unknown command fails
    When I run the command: help
    Then the command should succeed
    And the output should mention "photos:add"
    And the output should mention "photos:camera"
    And the output should mention "images/<photo id>.md"
    When I run the command: frobnicate
    Then the command should fail with exit code 1

  Scenario: The help no longer mentions copyright options or slugs
    When I run the command: help
    Then the output should not mention "--copyright"
    And the output should not mention "--slug"

  Scenario: Verify passes when in sync and fails, naming the file, when something is missing
    Given a photo file "v.jpg" of 900x600
    When I run the command: add v.jpg --category nature --title "Verified"
    And I run the command: verify --deep
    Then the command should succeed
    And the output should mention "1 entries in sync with R2"
    When the "cover" size disappears from R2
    And I run the command: verify
    Then the command should fail with exit code 1
    And the error output should mention "nature/images/"
    And the error output should mention "cover.webp"

  Scenario: The camera command fills in a missing camera line and reports what it did
    Given a photo file "e.jpg" of 900x600 with EXIF:
      | Make  | NIKON CORPORATION |
      | Model | NIKON Z 7         |
    When I run the command: add e.jpg --category nature --title "Exifed"
    And the entry "nature/exifed" has no camera line
    And I run the command: camera exifed
    Then the command should succeed
    And the output should mention "1 added, 0 unchanged"
    And the entry "nature/exifed" should have the camera line "Nikon Z 7"
    When I run the command: camera
    Then the command should succeed
    And the output should mention "0 added, 1 unchanged"

  Scenario: The camera command fails when an original is missing
    Given a photo file "m.jpg" of 900x600
    When I run the command: add m.jpg --category nature --title "Missing"
    And the entry "nature/missing" has no camera line
    And the original disappears from R2
    And I run the command: camera
    Then the command should fail with exit code 1
    And the error output should mention "original missing"

  Scenario: Repairing web sizes from the command line
    Given a photo file "s.jpg" of 900x600
    When I run the command: add s.jpg --category nature --title "Synced"
    And the "thumb" size disappears from R2
    And I run the command: sync
    Then the command should succeed
    And the output should mention "repaired 1 entry"

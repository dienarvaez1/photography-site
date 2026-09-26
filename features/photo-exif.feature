Feature: The camera line is built from each photo's EXIF, and nothing else is stored
  As the site owner
  I want the camera details shown with each picture filled in from the JPEG automatically
  So that the gallery is accurate without typing, while EXIF data, copyright, dates and
  anything private (GPS position, serial numbers, artist) never reach the repository

  An entry keeps only `camera:`. It never has an `exif:` block or a `copyright:` line.
  These scenarios use real JPEG files carrying real EXIF, a fake R2, and no network.

  Background:
    Given an empty photo library and a fake R2

  # --- Formatting rules ---------------------------------------------------------

  Scenario Outline: Exposure time is shown the way photographers write it
    Then the exposure time "<seconds>" should be shown as "<shown>"

    Examples:
      | seconds | shown  |
      | 0.008   | 1/125  |
      | 0.0005  | 1/2000 |
      | 0.5     | 1/2    |
      | 0.3333  | 1/3    |
      | 1       | 1      |
      | 2.5     | 2.5    |
      | 30      | 30     |
      | 0       | none   |
      | -1      | none   |
      | abc     | none   |

  Scenario Outline: The camera name reads naturally whatever the maker wrote
    Then the make "<make>" and model "<model>" should be named "<name>"

    Examples:
      | make              | model         | name                |
      | NIKON CORPORATION | NIKON Z 7     | Nikon Z 7           |
      | Canon             | Canon EOS R5  | Canon EOS R5        |
      | SONY              | ILCE-7M4      | Sony ILCE-7M4       |
      | Apple             | iPhone 15 Pro | Apple iPhone 15 Pro |
      | FUJIFILM          | X-T5          | Fujifilm X-T5       |
      | OM                | OM-1          | OM-1                |
      | NIKON CORPORATION |               | Nikon               |
      |                   | Mystery Cam   | Mystery Cam         |
      |                   |               | none                |

  Scenario Outline: The camera line lists what is known, in a fixed order
    Then the camera line for <settings> should be "<line>"

    Examples:
      | settings                                                                                                                         | line                                                                        |
      | make=NIKON CORPORATION;model=NIKON Z 7;lens=NIKKOR Z 70-200mm f/2.8 VR S;focalLength=140;aperture=5.6;shutterSpeed=1/125;iso=110 | Nikon Z 7 · NIKKOR Z 70-200mm f/2.8 VR S · 140mm · f/5.6 · 1/125s · ISO 110 |
      | make=Canon;model=Canon EOS R5;focalLength=50;aperture=1.8;shutterSpeed=1/200;iso=100                                             | Canon EOS R5 · 50mm · f/1.8 · 1/200s · ISO 100                              |
      | make=SONY;model=ILCE-7M4;shutterSpeed=2.5;iso=3200                                                                               | Sony ILCE-7M4 · 2.5s · ISO 3200                                             |
      | make=NIKON CORPORATION;model=NIKON Z 7                                                                                           | Nikon Z 7                                                                   |
      | focalLength=24;aperture=8                                                                                                        | 24mm · f/8                                                                  |
      | copyright=(C) Someone;takenAt=2023-11-27T18:42:10                                                                                | none                                                                        |

  # --- Adding a photo -------------------------------------------------------------

  Scenario: Adding a photo builds its camera line from the EXIF
    Given a photo file "nikon.jpg" of 1200x800 with EXIF:
      | Make            | NIKON CORPORATION            |
      | Model           | NIKON Z 7                    |
      | LensModel       | NIKKOR Z 70-200mm f/2.8 VR S |
      | FocalLength     | 140                          |
      | FNumber         | 5.6                          |
      | ExposureTime    | 1/125                        |
      | ISOSpeedRatings | 110                          |
    When I add "nikon.jpg" to the category "nature" with the title "Bird"
    Then the entry "nature/bird" should have the camera line "Nikon Z 7 · NIKKOR Z 70-200mm f/2.8 VR S · 140mm · f/5.6 · 1/125s · ISO 110"
    And the entry "nature/bird" should only have these fields: title, category, photo, camera, placeholderColor, featured, order, addedAt

  Scenario: An entry never gets an exif block or a copyright, whatever the JPEG contains
    Given a photo file "everything.jpg" of 900x600 with EXIF:
      | Make             | NIKON CORPORATION            |
      | Model            | NIKON Z 7                    |
      | LensModel        | NIKKOR Z 70-200mm f/2.8 VR S |
      | FocalLength      | 140                          |
      | FNumber          | 5.6                          |
      | ExposureTime     | 1/125                        |
      | ISOSpeedRatings  | 110                          |
      | DateTimeOriginal | 2023:11:27 18:42:10          |
      | Copyright        | (C) Test Photographer        |
    When I add "everything.jpg" to the category "nature" with the title "Everything"
    Then the entry "nature/everything" should only have these fields: title, category, photo, camera, placeholderColor, featured, order, addedAt
    And the entry "nature/everything" should not contain "exif"
    And the entry "nature/everything" should not contain "copyright"
    And the entry "nature/everything" should not contain "Test Photographer"
    And the entry "nature/everything" should not contain "2023"
    And the entry "nature/everything" should not contain "takenAt"

  Scenario: GPS position, serial numbers and the artist are never captured
    Given a photo file "private.jpg" of 900x600 with EXIF:
      | Make             | NIKON CORPORATION |
      | Model            | NIKON Z 7         |
      | Artist           | Jane Q. Owner     |
      | BodySerialNumber | SECRET-SERIAL-123 |
      | GPSLatitudeRef   | N                 |
      | GPSLatitude      | 45/1 31/1 0/1     |
      | GPSLongitudeRef  | W                 |
      | GPSLongitude     | 122/1 40/1 0/1    |
    When I add "private.jpg" to the category "landscape" with the title "Private Place"
    Then the entry "landscape/private-place" should have the camera line "Nikon Z 7"
    And the entry "landscape/private-place" should not contain "SECRET-SERIAL-123"
    And the entry "landscape/private-place" should not contain "Jane"
    And the entry "landscape/private-place" should not contain "45"
    And the entry "landscape/private-place" should not contain "122"
    And the entry "landscape/private-place" should not contain "latitude"
    And the entry "landscape/private-place" should not contain "gps"

  Scenario: A photo with only some EXIF gets a shorter camera line
    Given a photo file "partial.jpg" of 900x600 with EXIF:
      | Make  | NIKON CORPORATION |
      | Model | NIKON Z 7         |
    When I add "partial.jpg" to the category "nature" with the title "Partial"
    Then the entry "nature/partial" should have the camera line "Nikon Z 7"

  Scenario: Messy spacing written by a camera is tidied
    Given a photo file "spacey.jpg" of 900x600 with EXIF:
      | Make  | NIKON CORPORATION |
      | Model | NIKON   Z 7       |
    When I add "spacey.jpg" to the category "nature" with the title "Spacey"
    Then the entry "nature/spacey" should have the camera line "Nikon Z 7"

  Scenario: A long exposure is shown in seconds
    Given a photo file "stars.jpg" of 900x600 with EXIF:
      | Make            | Canon        |
      | Model           | Canon EOS R5 |
      | ExposureTime    | 25           |
      | ISOSpeedRatings | 3200         |
    When I add "stars.jpg" to the category "astro" with the title "Star Trails"
    Then the entry "astro/star-trails" should have the camera line "Canon EOS R5 · 25s · ISO 3200"

  Scenario: A photo with no camera info in its EXIF gets no camera line
    Given a photo file "bare.jpg" of 900x600
    When I add "bare.jpg" to the category "nature" with the title "Bare"
    Then the entry "nature/bare" should not have the field "camera"
    And the entry "nature/bare" should only have these fields: title, category, photo, placeholderColor, featured, order, addedAt

  Scenario: A photo whose EXIF holds only a copyright and a date gets no camera line
    Given a photo file "rights.jpg" of 900x600 with EXIF:
      | Copyright        | (C) Someone         |
      | DateTimeOriginal | 2020:07:19 03:05:00 |
    When I add "rights.jpg" to the category "astro" with the title "Rights Only"
    Then the entry "astro/rights-only" should not have the field "camera"
    And the entry "astro/rights-only" should not contain "Someone"

  Scenario: The camera line is built from a photo that is also rotated
    Given a photo file "turned.jpg" of 1200x800 with EXIF:
      | Make  | NIKON CORPORATION |
      | Model | NIKON Z 7         |
    And the photo file "turned.jpg" is stored with EXIF orientation 6
    When I add "turned.jpg" to the category "portrait" with the title "Turned"
    Then the entry "portrait/turned" should reference a photo of 800x1200 with a 16-character content id
    And the entry "portrait/turned" should have the camera line "Nikon Z 7"

  Scenario: The original in R2 keeps all of its EXIF untouched
    Given a photo file "keepexif.jpg" of 900x600 with EXIF:
      | Make      | NIKON CORPORATION     |
      | Model     | NIKON Z 7             |
      | Copyright | (C) Test Photographer |
    When I add "keepexif.jpg" to the category "nature" with the title "Keep Exif"
    Then the original stored in R2 should still contain its EXIF make "NIKON CORPORATION"

  Scenario: A camera line given explicitly overrides the EXIF
    Given a photo file "override.jpg" of 900x600 with EXIF:
      | Make  | NIKON CORPORATION |
      | Model | NIKON Z 7         |
    When I add "override.jpg" to the category "nature" with the title "Override" and camera "Nikon Z 7 + TC-2.0x"
    Then the entry "nature/override" should have the camera line "Nikon Z 7 + TC-2.0x"

  Scenario: A camera line given for a photo with no EXIF is kept
    Given a photo file "manual.jpg" of 900x600
    When I add "manual.jpg" to the category "nature" with the title "Manual" and camera "Nikon D800 · 50mm f/1.8"
    Then the entry "nature/manual" should have the camera line "Nikon D800 · 50mm f/1.8"

  # --- Replacing a photo ---------------------------------------------------------

  Scenario: Replacing a photo builds the camera line from the new photo's EXIF
    Given a photo file "first.jpg" of 900x600 with EXIF:
      | Make            | NIKON CORPORATION |
      | Model           | NIKON Z 7         |
      | FocalLength     | 50                |
      | ISOSpeedRatings | 100               |
    And a photo file "second.jpg" of 950x600 with EXIF:
      | Make            | Canon        |
      | Model           | Canon EOS R5 |
      | FocalLength     | 85           |
      | ISOSpeedRatings | 400          |
    And I have added "first.jpg" to the category "nature" with the title "Swap"
    When I replace the photo of "nature/swap" with "second.jpg"
    Then the entry "nature/swap" should have the camera line "Canon EOS R5 · 85mm · ISO 400"
    And the entry "nature/swap" should only have these fields: title, category, photo, camera, placeholderColor, featured, order, addedAt

  Scenario: Replacing a photo can set the camera line explicitly
    Given a photo file "one.jpg" of 900x600 with EXIF:
      | Make  | NIKON CORPORATION |
      | Model | NIKON Z 7         |
    And a photo file "two.jpg" of 950x600 with EXIF:
      | Make  | Canon        |
      | Model | Canon EOS R5 |
    And I have added "one.jpg" to the category "nature" with the title "Custom"
    When I replace the photo of "nature/custom" with "two.jpg" and camera "Canon EOS R5 + RF 2x"
    Then the entry "nature/custom" should have the camera line "Canon EOS R5 + RF 2x"

  Scenario: Replacing with a photo that has no camera info keeps the existing camera line
    Given a photo file "tagged.jpg" of 900x600 with EXIF:
      | Make  | NIKON CORPORATION |
      | Model | NIKON Z 7         |
    And a photo file "plain.jpg" of 950x600
    And I have added "tagged.jpg" to the category "nature" with the title "Keeps"
    When I replace the photo of "nature/keeps" with "plain.jpg"
    Then the entry "nature/keeps" should have the camera line "Nikon Z 7"

  Scenario: Replacing a photo also drops any leftover exif or copyright fields
    Given a photo file "before.jpg" of 900x600
    And a photo file "after.jpg" of 950x600
    And I have added "before.jpg" to the category "nature" with the title "Leftovers"
    And the entry "nature/leftovers" has these leftover fields from an older version: exif, copyright
    When I replace the photo of "nature/leftovers" with "after.jpg"
    Then the entry "nature/leftovers" should only have these fields: title, category, photo, placeholderColor, featured, order, addedAt

  # --- Filling in missing camera lines from R2 --------------------------------------

  Scenario: A missing camera line is filled in from the original in R2
    Given a photo file "old.jpg" of 900x600 with EXIF:
      | Make            | NIKON CORPORATION |
      | Model           | NIKON Z 7         |
      | FocalLength     | 200               |
      | ISOSpeedRatings | 640               |
    And I have added "old.jpg" to the category "nature" with the title "Older"
    And the entry "nature/older" has no camera line
    When I fill in the missing camera lines
    Then filling should report 1 updated and 0 unchanged and no problems
    And the entry "nature/older" should have the camera line "Nikon Z 7 · 200mm · ISO 640"
    And the entry "nature/older" should only have these fields: title, category, photo, camera, placeholderColor, featured, order, addedAt

  Scenario: A camera line that is already there is never touched
    Given a photo file "hand.jpg" of 900x600 with EXIF:
      | Make  | NIKON CORPORATION |
      | Model | NIKON Z 7         |
    And I have added "hand.jpg" to the category "nature" with the title "Hand Made" and camera "Nikon Z 7 + TC-2.0x"
    When I fill in the missing camera lines
    Then filling should report 0 updated and 1 unchanged and no problems
    And the entry "nature/hand-made" should have the camera line "Nikon Z 7 + TC-2.0x"

  Scenario: An existing camera line needs no original at all
    Given a photo file "nooriginal.jpg" of 900x600
    And I have added "nooriginal.jpg" to the category "nature" with the title "Has Line" and camera "Custom Camera"
    And the original disappears from R2
    When I fill in the missing camera lines
    Then filling should report 0 updated and 1 unchanged and no problems

  Scenario: Filling in camera lines can be repeated safely
    Given a photo file "repeat.jpg" of 900x600 with EXIF:
      | Make  | NIKON CORPORATION |
      | Model | NIKON Z 7         |
    And I have added "repeat.jpg" to the category "nature" with the title "Repeat"
    And the entry "nature/repeat" has no camera line
    When I fill in the missing camera lines
    And I remember the text of the entry "nature/repeat"
    And I fill in the missing camera lines
    Then filling should report 0 updated and 1 unchanged and no problems
    And the entry "nature/repeat" should read exactly as remembered

  Scenario: An empty camera line counts as missing
    Given a photo file "blank.jpg" of 900x600 with EXIF:
      | Make  | NIKON CORPORATION |
      | Model | NIKON Z 7         |
    And I have added "blank.jpg" to the category "nature" with the title "Blank"
    And the entry "nature/blank" has its camera line edited by hand to ""
    When I fill in the missing camera lines
    Then the entry "nature/blank" should have the camera line "Nikon Z 7"

  Scenario: An empty camera line is removed when the photo has no camera info to fill it
    Given a photo file "nothing.jpg" of 900x600
    And I have added "nothing.jpg" to the category "nature" with the title "Nothing"
    And the entry "nature/nothing" has its camera line edited by hand to ""
    When I fill in the missing camera lines
    Then the entry "nature/nothing" should not have the field "camera"

  Scenario: Filling can be limited to one entry
    Given a photo file "a.jpg" of 900x600 with EXIF:
      | Make  | NIKON CORPORATION |
      | Model | NIKON Z 7         |
    And a photo file "b.jpg" of 901x600 with EXIF:
      | Make  | Canon        |
      | Model | Canon EOS R5 |
    And I have added "a.jpg" to the category "nature" with the title "Alpha"
    And I have added "b.jpg" to the category "nature" with the title "Beta"
    And the entry "nature/alpha" has no camera line
    And the entry "nature/beta" has no camera line
    When I fill in the missing camera line for only the entry "nature/alpha"
    Then the entry "nature/alpha" should have the camera line "Nikon Z 7"
    And the entry "nature/beta" should not have the field "camera"

  Scenario: Filling reports an entry whose original is missing from R2
    Given a photo file "gone.jpg" of 900x600 with EXIF:
      | Make  | NIKON CORPORATION |
      | Model | NIKON Z 7         |
    And I have added "gone.jpg" to the category "nature" with the title "Gone"
    And the entry "nature/gone" has no camera line
    And the original disappears from R2
    When I fill in the missing camera lines
    Then filling should report a problem for "nature/gone" mentioning "original missing"
    And the entry "nature/gone" should not have the field "camera"

  Scenario: Filling reports an entry that has no photo id
    Given an entry "nature/legacy" with no photo id
    When I fill in the missing camera lines
    Then filling should report a problem for "nature/legacy" mentioning "no valid photo.id"

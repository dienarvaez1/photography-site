Feature: Photo storage in R2 stays in sync with the photo entries
  As the site owner
  I want photos to live in Cloudflare R2 while their .md files stay in git
  So that adding, replacing or removing a photo keeps each entry and its R2 files in step,
  and nothing (an entry, or my only copy of a file) is lost when something fails

  Each entry is one file, <category>/images/<photo id>.md in the local mirror of the entries (which live in R2
  as photos/<category>/<photo id>.md; see entry-sync.feature), named after the id of its photo so it maps 1:1
  to its objects in R2 (photos/<photo id>/...).
  These scenarios run against an in-memory fake of R2: no network is used.
  Entries are referred to below as "<category>/<title>", since their file names are ids.

  Background:
    Given an empty photo library and a fake R2

  # --- Adding ------------------------------------------------------------------

  Scenario: Adding a photo puts the original in the private bucket and the web sizes in the public one
    Given a photo file "sunset.jpg" of 1200x800
    When I add "sunset.jpg" to the category "landscape" with the title "Sunset" and the Spanish title "Atardecer"
    Then the entry "landscape/sunset" should reference a photo of 1200x800 with a 16-character content id
    And the entry "landscape/sunset" should have the title "Sunset" and the Spanish title "Atardecer"
    And the private originals bucket should hold exactly the original of that photo
    And the public web bucket should hold exactly every web size of that photo
    And all uploaded objects should be cacheable forever
    And the local file "sunset.jpg" should be gone

  Scenario: The entry file is named after its photo id, inside <category>/images
    Given a photo file "sunset.jpg" of 1200x800
    When I add "sunset.jpg" to the category "landscape" with the title "Sunset"
    Then the entry "landscape/sunset" should be stored as "landscape/images" named after its photo id
    And the category folder "landscape" should contain only the folder "images"
    And the folder "landscape/images" should contain exactly 1 entry file, each named after its photo id

  Scenario: The local file can be kept
    Given a photo file "keep.jpg" of 800x600
    When I add "keep.jpg" to the category "nature" with the title "Keep" and the option to keep the source
    Then the local file "keep.jpg" should still exist
    And the entry "nature/keep" should exist

  Scenario Outline: Web sizes have the right dimensions and are never upscaled
    Given a photo file "size.jpg" of <width>x<height>
    When I add "size.jpg" to the category "nature" with the title "Size"
    Then the stored "thumb" size should be <thumb>
    And the stored "cover" size should be <cover>
    And the stored "full" size should be <full>
    And the stored sizes should match the sizes the site computes for the entry

    Examples:
      | width | height | thumb   | cover   | full      |
      | 4000  | 3000   | 700x525 | 900x675 | 2000x1500 |
      | 1200  | 800    | 700x467 | 900x600 | 1200x800  |
      | 500   | 500    | 500x500 | 500x500 | 500x500   |

  Scenario: A photo rotated by its EXIF orientation is recorded as displayed
    Given a photo file "portrait.jpg" of 1200x800 stored with EXIF orientation 6
    When I add "portrait.jpg" to the category "portrait" with the title "Portrait"
    Then the entry "portrait/portrait" should reference a photo of 800x1200 with a 16-character content id
    And the stored sizes should match the sizes the site computes for the entry

  Scenario: The same image added to two categories shares one set of objects, one entry file each
    Given a photo file "one.jpg" of 900x600
    And a copy of "one.jpg" named "two.jpg"
    When I add "one.jpg" to the category "nature" with the title "First"
    And I add "two.jpg" to the category "pets" with the title "Second"
    Then the entries "nature/first" and "pets/second" should reference the same photo
    And the entry "nature/first" should be stored as "nature/images" named after its photo id
    And the entry "pets/second" should be stored as "pets/images" named after its photo id
    And the private originals bucket should hold 1 object
    And the public web bucket should hold the web sizes of 1 photo

  Scenario: Adding the same photo to the same category twice is refused and changes nothing
    Given a photo file "a.jpg" of 900x600
    And a copy of "a.jpg" named "b.jpg"
    When I add "a.jpg" to the category "nature" with the title "First Try"
    And I try to add "b.jpg" to the category "nature" with the title "Second Try"
    Then the attempt should fail saying the entry already exists
    And the local file "b.jpg" should still exist
    And the folder "nature/images" should contain exactly 1 entry file, each named after its photo id
    And the private originals bucket should hold 1 object
    And the public web bucket should hold the web sizes of 1 photo

  Scenario: Two different photos may share a title
    Given a photo file "x.jpg" of 900x600
    And a photo file "y.jpg" of 901x600
    When I add "x.jpg" to the category "nature" with the title "Twin"
    And I add "y.jpg" to the category "pets" with the title "Twin"
    Then the entries "nature/twin" and "pets/twin" should reference different photos

  Scenario: Titles are matched ignoring case, accents and punctuation
    Then the title "Quinceañera Portrait" should match the reference "quinceanera-portrait"
    And the title "Hawthorne Bridge, Portland" should match the reference "hawthorne-bridge-portland"

  Scenario: A failed upload writes no entry and keeps the local file
    Given a photo file "fail.jpg" of 900x600
    And R2 will fail to store anything matching "full"
    When I try to add "fail.jpg" to the category "nature" with the title "Fail"
    Then the attempt should fail
    And no entry should exist
    And the local file "fail.jpg" should still exist

  Scenario: An original that does not read back identical writes no entry and keeps the local file
    Given a photo file "corrupt.jpg" of 900x600
    And R2 will return corrupted originals
    When I try to add "corrupt.jpg" to the category "nature" with the title "Corrupt"
    Then the attempt should fail
    And no entry should exist
    And the local file "corrupt.jpg" should still exist

  Scenario: Entries never contain a photo URL
    Given a photo file "url.jpg" of 900x600
    When I add "url.jpg" to the category "nature" with the title "Url"
    Then the entry "nature/url" should not contain "http"

  Scenario: An entry holds only the fields the site uses
    Given a photo file "fields.jpg" of 900x600
    When I add "fields.jpg" to the category "nature" with the title "Fields" and the Spanish title "Campos" and camera "Nikon Z 7" and order 2
    Then the entry "nature/fields" should only have these fields: title, titles, category, photo, camera, featured, order

  Scenario: Entries are written in the repository's existing style
    Given a photo file "style.jpg" of 900x600
    When I add "style.jpg" to the category "nature" with the title "Style" and the Spanish title "Estilo" and camera "Nikon Z 7" and order 2
    Then the entry "nature/style" should look like this, with the id filled in:
      """
      ---
      title: "Style"
      titles:
        es: "Estilo"
      category: "nature"
      photo:
        id: "<id>"
        width: 900
        height: 600
      camera: "Nikon Z 7"
      featured: false
      order: 2
      ---
      """

  # --- Replacing ----------------------------------------------------------------

  Scenario: Replacing a photo updates the entry, renames its file to the new id, and deletes the old photo from R2
    Given a photo file "old.jpg" of 900x600
    And a photo file "new.jpg" of 1000x700
    And I have added "old.jpg" to the category "nature" with the title "Bird" and order 4
    When I replace the photo of "nature/bird" with "new.jpg"
    Then the entry "nature/bird" should reference a photo of 1000x700 with a 16-character content id
    And the entry "nature/bird" should still have order 4
    And the entry "nature/bird" should be stored as "nature/images" named after its photo id
    And the folder "nature/images" should contain exactly 1 entry file, each named after its photo id
    And the private originals bucket should hold 1 object
    And the public web bucket should hold the web sizes of 1 photo
    And the stored objects should all belong to the entry "nature/bird"

  Scenario: Replacing a photo with the very same image changes nothing
    Given a photo file "same.jpg" of 900x600
    And a copy of "same.jpg" named "same-again.jpg"
    And I have added "same.jpg" to the category "nature" with the title "Same"
    When I replace the photo of "nature/same" with "same-again.jpg"
    Then the entry "nature/same" should be stored as "nature/images" named after its photo id
    And the folder "nature/images" should contain exactly 1 entry file, each named after its photo id
    And the private originals bucket should hold 1 object
    And the public web bucket should hold the web sizes of 1 photo

  Scenario: Replacing with a photo already in the same category is refused
    Given a photo file "p1.jpg" of 900x600
    And a photo file "p2.jpg" of 901x600
    And a copy of "p2.jpg" named "p2-again.jpg"
    And I have added "p1.jpg" to the category "nature" with the title "One"
    And I have added "p2.jpg" to the category "nature" with the title "Two"
    When I try to replace the photo of "nature/one" with "p2-again.jpg"
    Then the attempt should fail saying the entry already exists
    And the local file "p2-again.jpg" should still exist
    And the folder "nature/images" should contain exactly 2 entry files, each named after its photo id

  Scenario: Replacing a photo keeps the old objects while another entry still uses them
    Given a photo file "shared.jpg" of 900x600
    And a copy of "shared.jpg" named "shared2.jpg"
    And a photo file "other.jpg" of 950x600
    And I have added "shared.jpg" to the category "nature" with the title "Left"
    And I have added "shared2.jpg" to the category "pets" with the title "Right"
    When I replace the photo of "nature/left" with "other.jpg"
    Then the private originals bucket should hold 2 objects
    And the public web bucket should hold the web sizes of 2 photos
    And the stored objects should all belong to the entries "nature/left" and "pets/right"

  # --- Removing -----------------------------------------------------------------

  Scenario: Removing an entry deletes its photo from R2
    Given a photo file "gone.jpg" of 900x600
    And I have added "gone.jpg" to the category "nature" with the title "Gone"
    When I remove the entry "nature/gone"
    Then no entry should exist
    And the folder "nature/images" should contain no files
    And the private originals bucket should hold 0 objects
    And the public web bucket should hold the web sizes of 0 photos

  Scenario: Removing an entry keeps a photo another entry still uses
    Given a photo file "s1.jpg" of 900x600
    And a copy of "s1.jpg" named "s2.jpg"
    And I have added "s1.jpg" to the category "nature" with the title "Keeper"
    And I have added "s2.jpg" to the category "pets" with the title "Leaver"
    When I remove the entry "pets/leaver"
    Then the entry "nature/keeper" should exist
    And the entry "pets/leaver" should not exist
    And the private originals bucket should hold 1 object
    And the public web bucket should hold the web sizes of 1 photo

  # --- Verify and sync ----------------------------------------------------------

  Scenario: Verify passes when every entry's photo is in R2
    Given a photo file "ok.jpg" of 900x600
    And I have added "ok.jpg" to the category "nature" with the title "Fine"
    When I verify the library deeply
    Then verification should report no problems

  Scenario: Verify reports each missing web size
    Given a photo file "miss.jpg" of 900x600
    And I have added "miss.jpg" to the category "nature" with the title "Missing"
    And the "cover" size disappears from R2
    When I verify the library
    Then verification should report a problem for "nature/missing" mentioning "cover.webp"

  Scenario: A deep verify catches a missing or corrupted original
    Given a photo file "deep.jpg" of 900x600
    And I have added "deep.jpg" to the category "nature" with the title "Deep"
    And R2 will return corrupted originals
    When I verify the library deeply
    Then verification should report a problem for "nature/deep" mentioning "does not match"

  Scenario: Verify reports an entry that has no photo id
    Given an entry "nature/legacy" with no photo id
    When I verify the library
    Then verification should report a problem for "nature/legacy" mentioning "no valid photo.id"

  Scenario: Sync regenerates a missing web size from the original in R2
    Given a photo file "repair.jpg" of 1500x1000
    And I have added "repair.jpg" to the category "nature" with the title "Repair"
    And the "full" size disappears from R2
    When I sync the library
    Then sync should report 1 repaired entry and no problems
    And the public web bucket should hold the web sizes of 1 photo
    When I verify the library
    Then verification should report no problems

  Scenario: Sync cannot repair an entry whose original is gone
    Given a photo file "lost.jpg" of 900x600
    And I have added "lost.jpg" to the category "nature" with the title "Lost"
    And the original disappears from R2
    And the "thumb" size disappears from R2
    When I sync the library
    Then sync should report a problem for "nature/lost" mentioning "original missing"

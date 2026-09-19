Feature: Photo storage in R2 stays in sync with the photo entries
  As the site owner
  I want photos to live in Cloudflare R2 while their .md files stay in git
  So that adding, replacing or removing a photo keeps each entry and its R2 files in step,
  and nothing (an entry, or my only copy of a file) is lost when something fails

  These scenarios run against an in-memory fake of R2: no network is used.

  Background:
    Given an empty photo library and a fake R2

  Scenario: Adding a photo puts the original in the private bucket and the web sizes in the public one
    Given a photo file "sunset.jpg" of 1200x800
    When I add "sunset.jpg" to the category "landscape" with the title "Sunset" and the Spanish title "Atardecer"
    Then the entry "landscape/sunset.md" should reference a photo of 1200x800 with a 16-character content id
    And the entry "landscape/sunset.md" should have the title "Sunset" and the Spanish title "Atardecer"
    And the private originals bucket should hold exactly the original of that photo
    And the public web bucket should hold exactly the thumb, cover and full sizes of that photo
    And all uploaded objects should be cacheable forever
    And the local file "sunset.jpg" should be gone

  Scenario: The local file can be kept
    Given a photo file "keep.jpg" of 800x600
    When I add "keep.jpg" to the category "nature" with the title "Keep" and the option to keep the source
    Then the local file "keep.jpg" should still exist
    And the entry "nature/keep.md" should exist

  Scenario Outline: Web sizes have the right dimensions and are never upscaled
    Given a photo file "size.jpg" of <width>x<height>
    When I add "size.jpg" to the category "nature" with the title "Size"
    Then the stored "thumb" size should be <thumb>
    And the stored "cover" size should be <cover>
    And the stored "full" size should be <full>
    And the stored sizes should match the sizes the site computes for the entry

    Examples:
      | width | height | thumb   | cover   | full     |
      | 4000  | 3000   | 700x525 | 900x675 | 2000x1500 |
      | 1200  | 800    | 700x467 | 900x600 | 1200x800  |
      | 500   | 500    | 500x500 | 500x500 | 500x500   |

  Scenario: A photo rotated by its EXIF orientation is recorded as displayed
    Given a photo file "portrait.jpg" of 1200x800 stored with EXIF orientation 6
    When I add "portrait.jpg" to the category "portrait" with the title "Portrait"
    Then the entry "portrait/portrait.md" should reference a photo of 800x1200 with a 16-character content id
    And the stored sizes should match the sizes the site computes for the entry

  Scenario: The same image added twice shares one set of objects
    Given a photo file "one.jpg" of 900x600
    And a copy of "one.jpg" named "two.jpg"
    When I add "one.jpg" to the category "nature" with the title "First"
    And I add "two.jpg" to the category "pets" with the title "Second"
    Then the entries "nature/first.md" and "pets/second.md" should reference the same photo
    And the private originals bucket should hold 1 object
    And the public web bucket should hold 3 objects

  Scenario: An entry's file name comes from its title
    Then the title "Quinceañera Portrait" should become the file name "quinceanera-portrait"
    And the title "Hawthorne Bridge, Portland" should become the file name "hawthorne-bridge-portland"

  Scenario: Adding over an existing entry is refused and changes nothing
    Given a photo file "a.jpg" of 900x600
    And a photo file "b.jpg" of 901x600
    When I add "a.jpg" to the category "nature" with the title "Same Name"
    And I try to add "b.jpg" to the category "nature" with the title "Same Name"
    Then the attempt should fail saying the entry already exists
    And the local file "b.jpg" should still exist
    And the private originals bucket should hold 1 object

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

  Scenario: Replacing a photo updates the entry and deletes the old photo from R2
    Given a photo file "old.jpg" of 900x600
    And a photo file "new.jpg" of 1000x700
    And I have added "old.jpg" to the category "nature" with the title "Bird" and order 4
    When I replace the photo of "bird" with "new.jpg"
    Then the entry "nature/bird.md" should reference a photo of 1000x700 with a 16-character content id
    And the entry "nature/bird.md" should still have order 4
    And the private originals bucket should hold 1 object
    And the public web bucket should hold 3 objects
    And the stored objects should all belong to the entry "nature/bird.md"

  Scenario: Replacing a photo keeps the old objects while another entry still uses them
    Given a photo file "shared.jpg" of 900x600
    And a copy of "shared.jpg" named "shared2.jpg"
    And a photo file "other.jpg" of 950x600
    And I have added "shared.jpg" to the category "nature" with the title "Left"
    And I have added "shared2.jpg" to the category "pets" with the title "Right"
    When I replace the photo of "left" with "other.jpg"
    Then the private originals bucket should hold 2 objects
    And the public web bucket should hold 6 objects
    And the stored objects should all belong to the entries "nature/left.md" and "pets/right.md"

  Scenario: Removing an entry deletes its photo from R2
    Given a photo file "gone.jpg" of 900x600
    And I have added "gone.jpg" to the category "nature" with the title "Gone"
    When I remove the entry "gone"
    Then no entry should exist
    And the private originals bucket should hold 0 objects
    And the public web bucket should hold 0 objects

  Scenario: Removing an entry keeps a photo another entry still uses
    Given a photo file "s1.jpg" of 900x600
    And a copy of "s1.jpg" named "s2.jpg"
    And I have added "s1.jpg" to the category "nature" with the title "Keeper"
    And I have added "s2.jpg" to the category "pets" with the title "Leaver"
    When I remove the entry "leaver"
    Then the entry "nature/keeper.md" should exist
    And the private originals bucket should hold 1 object
    And the public web bucket should hold 3 objects

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
    Then verification should report a problem for "nature/missing.md" mentioning "cover.webp"

  Scenario: A deep verify catches a missing or corrupted original
    Given a photo file "deep.jpg" of 900x600
    And I have added "deep.jpg" to the category "nature" with the title "Deep"
    And R2 will return corrupted originals
    When I verify the library deeply
    Then verification should report a problem for "nature/deep.md" mentioning "does not match"

  Scenario: Verify reports an entry that has no photo id
    Given an entry "nature/legacy.md" with no photo id
    When I verify the library
    Then verification should report a problem for "nature/legacy.md" mentioning "no valid photo.id"

  Scenario: Sync regenerates a missing web size from the original in R2
    Given a photo file "repair.jpg" of 1500x1000
    And I have added "repair.jpg" to the category "nature" with the title "Repair"
    And the "full" size disappears from R2
    When I sync the library
    Then sync should report 1 repaired entry and no problems
    And the public web bucket should hold 3 objects
    When I verify the library
    Then verification should report no problems

  Scenario: Sync cannot repair an entry whose original is gone
    Given a photo file "lost.jpg" of 900x600
    And I have added "lost.jpg" to the category "nature" with the title "Lost"
    And the original disappears from R2
    And the "thumb" size disappears from R2
    When I sync the library
    Then sync should report a problem for "nature/lost.md" mentioning "original missing"

  Scenario: Entries are written in the repository's existing style
    Given a photo file "style.jpg" of 900x600
    When I add "style.jpg" to the category "nature" with the title "Style" and the Spanish title "Estilo" and camera "Nikon Z 7" and order 2
    Then the entry "nature/style.md" should look like this, with the id filled in:
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

  Scenario: Entries never contain a photo URL
    Given a photo file "url.jpg" of 900x600
    When I add "url.jpg" to the category "nature" with the title "Url"
    Then the entry "nature/url.md" should not contain "http"

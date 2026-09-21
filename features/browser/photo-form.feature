@browser
Feature: The Admin page's New Photo form adds a photo from its own metadata, in a real browser
  As the site owner
  I want to press Upload Photos, choose a JPEG, and only say its title, category and order
  So that the photo is stored in R2 and its .md entry is written without me touching a command line

  The form's local service is the real request handler (as `astro dev` runs it) over a temporary content
  folder and a fake R2; the results API is the real Worker code over fake buckets. Nothing leaves the machine.

  Background:
    Given the results API holds the admin token "browser-test-admin-token" and these published runs:
      | time                 | commit  | offline results | browser results | smoke | artifacts |
      | 2026-09-21T10:00:00Z | ccccccc | 3 passed        |                 |       |           |
    And the originals bucket holds these files:
      | photo id         | metadata      |
      | 22d56df0b2da3a99 | full          |
      | 4c4f46c18b70c4b5 | empty rights  |
    And an empty photo library and a fake R2
    And the category "astro" already has photos with the orders "1, 2, 4"
    And the category "nature" already has photos with the orders "1, 2, 3, 4, 5, 6, 7"
    And a photo file "moon.jpg" of 1200x700 with EXIF:
      | Make            | NIKON CORPORATION                           |
      | Model           | NIKON Z 8                                   |
      | LensModel       | NIKKOR Z 100-400mm f/4.5-5.6 VR S + TC-2.0x |
      | FocalLength     | 800                                         |
      | FNumber         | 11                                          |
      | ExposureTime    | 1/125                                       |
      | ISOSpeedRatings | 640                                         |
    And the local photo service is running

  # --- Opening the form -----------------------------------------------------------------------------------------------------

  Scenario: Upload Photos opens the New Photo form above the list, and asks the results API for nothing more
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Upload Photos" button
    Then the New Photo form should be open, above the list of photos
    And the New Photo form should ask for these, in this order: "Photo (JPEG)", "Title", "Title in Spanish (optional)", "Category", "Order", "Featured"
    And the results API should have been asked for the list only
    And the photo service should have been asked only: "GET status"

  Scenario: Every field has a visible label and the form can be filled in with the keyboard alone
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Upload Photos" button
    Then keyboard focus should be on the form's photo field
    And every field of the New Photo form should have a label, be at least 44 pixels tall and be in the tab order

  Scenario: Pressing Upload Photos again goes back to the open form instead of opening a second one
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Upload Photos" button
    And I click the "Upload Photos" button
    Then there should be exactly 1 New Photo form

  Scenario: Close puts the form away and returns to the Upload Photos button
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Upload Photos" button
    And I click the "Close" button
    Then there should be exactly 0 New Photo forms
    And keyboard focus should be on the "Upload Photos" button

  Scenario: Signing out closes the form
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Upload Photos" button
    And I click "Sign out" at the top of the page
    Then there should be exactly 0 New Photo forms

  Scenario: Where there is no local service (the deployed site) the form says it only works on the owner's computer
    Given the local photo service is not running
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Upload Photos" button
    Then the New Photo form should say "only works while the site runs on your computer"
    And the New Photo form should have no fields, only a "Close" button

  # --- Reading the photo ---------------------------------------------------------------------------------------------------------

  Scenario: Choosing a photo shows its id, size and camera line, read from the file itself
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Upload Photos" button
    And I choose the photo "moon.jpg" in the form
    Then the form should show what it read: a 16-character photo id, the size "1200 × 700 px" and the camera line "Nikon Z 8 · NIKKOR Z 100-400mm f/4.5-5.6 VR S + TC-2.0x · 800mm · f/11 · 1/125s · ISO 640"
    And the photo service should have been asked only: "GET status, POST analyze"
    And nothing should have been uploaded

  Scenario: A photo without camera information says so, and the camera line can be typed
    Given a photo file "plain.jpg" of 900x600
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Upload Photos" button
    And I choose the photo "plain.jpg" in the form
    Then the New Photo form should say "The photo has no camera information"
    And the form's camera line should be ""

  Scenario: A file that is not a JPEG is refused with a message, and the rest of the form stays usable
    Given a text file "notes.jpg"
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Upload Photos" button
    And I choose the photo "notes.jpg" in the form
    Then the New Photo form should say "That file is not a readable image."
    And the form should show no photo id

  # --- The order ------------------------------------------------------------------------------------------------------------------------

  Scenario: The order is filled in as one past the highest in the chosen category, and follows the category
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Upload Photos" button
    And I choose the category "Astrophotography" in the form
    Then the order should read "5"
    And the order hint should say "The highest order in Astrophotography is 4, so the next is 5."
    When I choose the category "Nature" in the form
    Then the order should read "8"
    And the order hint should say "The highest order in Nature is 7, so the next is 8."
    When I choose the category "Pets" in the form
    Then the order should read "1"
    And the order hint should say "There are no photos in Pets yet, so the first order is 1."

  Scenario: An order typed in by hand is kept when the category changes
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Upload Photos" button
    And I choose the category "Astrophotography" in the form
    And I type the order "12" in the form
    And I choose the category "Nature" in the form
    Then the order should read "12"
    When I clear the order in the form
    And I choose the category "Nature" in the form
    Then the order should read "8"

  # --- Adding the photo -------------------------------------------------------------------------------------------------------------------

  Scenario: Filling in the form and pressing Add photo stores the photo and writes its entry
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Upload Photos" button
    And I choose the photo "moon.jpg" in the form
    And I fill in the form's "Title" with "Half Moon"
    And I fill in the form's "Title in Spanish (optional)" with "Media luna"
    And I choose the category "Astrophotography" in the form
    And I click the "Add photo" button
    Then the New Photo form should say "Added “Half Moon” to Astrophotography as number 5."
    And the form should show the entry it wrote, as the site's other entries look
    And the entry "astro/half-moon" should look like this, with the id filled in:
      """
      ---
      title: "Half Moon"
      titles:
        es: "Media luna"
      category: "astro"
      photo:
        id: "<id>"
        width: 1200
        height: 700
      camera: "Nikon Z 8 · NIKKOR Z 100-400mm f/4.5-5.6 VR S + TC-2.0x · 800mm · f/11 · 1/125s · ISO 640"
      featured: false
      order: 5
      ---
      """
    And the private originals bucket should hold 1 object
    And the public web bucket should hold the web sizes of 1 photo
    And the photo service should have been asked only: "GET status, POST analyze, POST add"
    And the results API should have asked for the list again

  Scenario: The camera line and the order can be changed before adding
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Upload Photos" button
    And I choose the photo "moon.jpg" in the form
    And I fill in the form's "Camera line" with "Nikon Z 8 · 800mm"
    And I fill in the form's "Title" with "Half Moon"
    And I choose the category "Nature" in the form
    And I type the order "20" in the form
    And I tick "Featured" in the form
    And I click the "Add photo" button
    Then the New Photo form should say "Added “Half Moon” to Nature as number 20."
    And the entry "nature/half-moon" should have the camera line "Nikon Z 8 · 800mm"
    And the entry "nature/half-moon" should be featured
    And the entry "nature/half-moon" should still have order 20

  Scenario: After adding, Add another photo starts a fresh form whose order suggestions include the new photo
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Upload Photos" button
    And I choose the photo "moon.jpg" in the form
    And I fill in the form's "Title" with "Half Moon"
    And I choose the category "Astrophotography" in the form
    And I click the "Add photo" button
    And I click the "Add another photo" button
    And I choose the category "Astrophotography" in the form
    Then the order should read "6"
    And the order hint should say "The highest order in Astrophotography is 5, so the next is 6."
    And the form should show no photo id

  Scenario: With the entries in R2, adding a photo stores its original, its web sizes, its entry file and its manifest entry where they belong
    Given the entries already in the library folder are published to R2, which the tools now work with
    And the local photo service is running
    And I remember the bytes of the photo file "moon.jpg"
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Upload Photos" button
    And I choose the photo "moon.jpg" in the form
    And I fill in the form's "Title" with "Half Moon"
    And I choose the category "Astrophotography" in the form
    And I click the "Add photo" button
    Then the New Photo form should say "Added “Half Moon” to Astrophotography as number 5."
    And the New Photo form should say "Published to R2 as photos/categories/astro/"
    And the private originals bucket should hold exactly the originals of: "astro/half-moon"
    And the stored original should be byte for byte the photo that was sent
    And nothing but originals should be in the private originals bucket
    And no original should be in the public web bucket
    And the public web bucket should hold every web size of the photo of "astro/half-moon", its entry file and the manifest
    And the manifest entry "astro/half-moon" should carry the same data as the local entry
    And the manifest entry "astro/half-moon" should have order 5
    And every manifest entry should equal the front matter of its entry file in R2

  Scenario: A photo that is already in the chosen category cannot be added again
    Given I have added "moon.jpg" to the category "astro" with the title "Half Moon" and order 3 and the option to keep the source
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Upload Photos" button
    And I choose the photo "moon.jpg" in the form
    And I choose the category "Astrophotography" in the form
    Then the New Photo form should say "This photo is already in Astrophotography."
    When I fill in the form's "Title" with "Moon Again"
    And I click the "Add photo" button
    Then the New Photo form should say "This photo is already in Astrophotography."
    And the folder "astro/images" should contain exactly 4 entry files, each named after its photo id

  Scenario: When the photo cannot be stored the form says why, writes nothing, and keeps what was typed
    Given R2 will fail to store anything matching "cover"
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Upload Photos" button
    And I choose the photo "moon.jpg" in the form
    And I fill in the form's "Title" with "Half Moon"
    And I choose the category "Astrophotography" in the form
    And I click the "Add photo" button
    Then the New Photo form should say "The photo could not be added: simulated upload failure"
    And the form's "Title" should still read "Half Moon"
    And the "Add photo" button should be enabled again
    And the folder "astro/images" should contain exactly 3 entry files, each named after its photo id

  # --- Spanish, phones and quality ---------------------------------------------------------------------------------------------------------

  Scenario: The form speaks Spanish on the Spanish page, with the categories named in Spanish
    When I open "/es/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the "Subir fotos" button
    Then the New Photo form should ask for these, in this order: "Foto (JPEG)", "Título", "Título en español (opcional)", "Categoría", "Orden", "Destacada"
    When I choose the photo "moon.jpg" in the form
    And I choose the category "Astrofotografía" in the form
    Then the order should read "5"
    And the order hint should say "El orden más alto en Astrofotografía es 4, así que el siguiente es 5."
    When I fill in the form's "Título" with "Media luna"
    And I click the "Añadir foto" button
    Then the New Photo form should say "Se añadió «Media luna» a Astrofotografía con el número 5."

  Scenario Outline: Each state of the form passes the automated accessibility audit
    When I open "/admin/#pics-viewer"
    And I show the New Photo form in its "<state>" state
    Then the page should pass the automated accessibility audit

    Examples:
      | state            |
      | not available    |
      | empty            |
      | photo read       |
      | filled in        |
      | added            |
      | refused          |

  Scenario Outline: No state of the form scrolls sideways on a phone, and its buttons are inside the screen
    Given the visitor uses a phone
    When I open "/admin/#pics-viewer"
    And I show the New Photo form in its "<state>" state
    Then the page should not scroll sideways
    And every button and field of the New Photo form should be entirely inside the screen

    Examples:
      | state            |
      | not available    |
      | empty            |
      | photo read       |
      | filled in        |
      | added            |
      | refused          |

  Scenario: Using the form causes no script errors, no policy violations and no unexpected requests
    When I open "/admin/#pics-viewer"
    And I show the New Photo form in its "added" state
    And I click the "Close" button
    Then no script error should have been logged
    And no Content-Security-Policy violation should have been reported
    And nothing but the site and the results API should have been requested

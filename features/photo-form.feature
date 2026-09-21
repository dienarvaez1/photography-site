Feature: The New Photo form adds a photo from what the photo itself says
  As the site owner using the Admin page's New Photo form
  I want the photo's id, size and camera line read from the file, and only the title, category and order asked
  So that a photo added from the form is exactly as good as one added with `npm run photos:add`

  These scenarios call the form's real request handler (scripts/lib/photo-form.mjs) with a fake R2 and a
  temporary folder for the local mirror of the entries, the way the dev server does. The form's screens are in
  browser/photo-form.feature, and how entries reach R2 in entry-sync.feature.

  Background:
    Given an empty photo library and a fake R2

  # --- Reading the photo -----------------------------------------------------------------------------------------

  Scenario: The form reads the id, the size and the camera line from the photo
    Given a photo file "moon.jpg" of 1200x700 with EXIF:
      | Make            | NIKON CORPORATION                                |
      | Model           | NIKON Z 8                                        |
      | LensModel       | NIKKOR Z 100-400mm f/4.5-5.6 VR S + TC-2.0x      |
      | FocalLength     | 800                                              |
      | FNumber         | 11                                               |
      | ExposureTime    | 1/125                                            |
      | ISOSpeedRatings | 640                                              |
    When I send "moon.jpg" to the form to be read
    Then the form should answer with status 200
    And the form should have read a 1200 by 700 photo with a 16-character id
    And the form should have read the camera line "Nikon Z 8 · NIKKOR Z 100-400mm f/4.5-5.6 VR S + TC-2.0x · 800mm · f/11 · 1/125s · ISO 640"
    And the form should say the photo is in no category yet
    And nothing should have been uploaded
    And the library should contain no entries and no category folders

  Scenario: The size is the size the photo is displayed at
    Given a photo file "portrait.jpg" of 1200x800 stored with EXIF orientation 6
    When I send "portrait.jpg" to the form to be read
    Then the form should have read a 800 by 1200 photo with a 16-character id

  Scenario: A photo with no camera information reads with no camera line
    Given a photo file "plain.jpg" of 900x600
    When I send "plain.jpg" to the form to be read
    Then the form should have read a 900 by 600 photo with a 16-character id
    And the form should have read no camera line

  Scenario: Reading a photo already in the library says which categories hold it
    Given a photo file "moon.jpg" of 1200x700
    And I have added "moon.jpg" to the category "astro" with the title "Half Moon" and the option to keep the source
    When I send "moon.jpg" to the form to be read
    Then the form should say the photo is already in "astro"

  # --- The order -------------------------------------------------------------------------------------------------

  Scenario: The form suggests one past the highest order of each category, not one past the count
    Given the category "astro" already has photos with the orders "1, 2, 4"
    And the category "nature" already has photos with the orders "1, 2, 3, 4, 5, 6, 7"
    When I ask the form for the category orders
    Then the form should answer with status 200
    And the form should say "astro" has 3 photos, a highest order of 4 and a next order of 5
    And the form should say "nature" has 7 photos, a highest order of 7 and a next order of 8
    And the form should say "pets" has 0 photos, a highest order of 0 and a next order of 1
    And the form should know every configured category

  Scenario: A photo submitted without an order gets one past the highest in its category
    Given the category "astro" already has photos with the orders "1, 2"
    And a photo file "moon.jpg" of 1200x700
    When I submit the photo "moon.jpg" to the form with:
      | title    | Half Moon |
      | category | astro     |
      | order    |           |
    Then the form should answer with status 200
    And the entry "astro/half-moon" should still have order 3
    And the form should say the entry was given the order 3

  Scenario: An order typed into the form is kept
    Given the category "astro" already has photos with the orders "1, 2"
    And a photo file "moon.jpg" of 1200x700
    When I submit the photo "moon.jpg" to the form with:
      | title    | Half Moon |
      | category | astro     |
      | order    | 9         |
    Then the entry "astro/half-moon" should still have order 9

  Scenario: The first photo of an empty category gets order 1
    Given a photo file "moon.jpg" of 1200x700
    When I submit the photo "moon.jpg" to the form with:
      | title    | Half Moon |
      | category | pets      |
    Then the entry "pets/half-moon" should still have order 1

  Scenario: Two photos submitted at the same moment get different orders
    Given the category "astro" already has photos with the orders "1, 2"
    And a photo file "one.jpg" of 1200x700
    And a photo file "two.jpg" of 1100x700
    When I submit "one.jpg" as "First" and "two.jpg" as "Second" to "astro" at the same moment, without orders
    Then the form should have given the two photos the orders 3 and 4

  # --- What is written -----------------------------------------------------------------------------------------------

  Scenario: The entry has the fields of the site's other entries, with the photo's own values
    Given the category "astro" already has photos with the orders "1, 2"
    And a photo file "moon.jpg" of 1200x700 with EXIF:
      | Make            | NIKON CORPORATION                                |
      | Model           | NIKON Z 8                                        |
      | LensModel       | NIKKOR Z 100-400mm f/4.5-5.6 VR S + TC-2.0x      |
      | FocalLength     | 800                                              |
      | FNumber         | 11                                               |
      | ExposureTime    | 1/125                                            |
      | ISOSpeedRatings | 640                                              |
    When I submit the photo "moon.jpg" to the form with:
      | title    | Half Moon  |
      | titleEs  | Media luna |
      | category | astro      |
      | featured | false      |
    Then the entry "astro/half-moon" should look like this, with the id filled in:
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
      order: 3
      ---
      """
    And the entry "astro/half-moon" should be stored as "astro/images" named after its photo id
    And the form should answer with the written entry, identical to the file, and where it is

  Scenario: The original goes to the private bucket and every web size to the public one
    Given a photo file "moon.jpg" of 1200x700
    When I submit the photo "moon.jpg" to the form with:
      | title    | Half Moon |
      | category | astro     |
    Then the private originals bucket should hold exactly the original of that photo
    And the stored original should be byte for byte the photo that was sent
    And the public web bucket should hold exactly every web size of that photo
    And all uploaded objects should be cacheable forever

  Scenario: A Spanish title is optional and a photo can be featured
    Given a photo file "moon.jpg" of 1200x700
    When I submit the photo "moon.jpg" to the form with:
      | title    | Half Moon |
      | category | astro     |
      | featured | true      |
    Then the entry "astro/half-moon" should be featured
    And the entry "astro/half-moon" should only have these fields: title, category, photo, featured, order

  Scenario: The camera line typed into the form replaces the one in the photo
    Given a photo file "moon.jpg" of 1200x700 with EXIF:
      | Make  | NIKON CORPORATION |
      | Model | NIKON Z 8         |
    When I submit the photo "moon.jpg" to the form with:
      | title    | Half Moon                          |
      | category | astro                              |
      | camera   | Nikon Z 8 · 800mm · f/11 · ISO 640 |
    Then the entry "astro/half-moon" should have the camera line "Nikon Z 8 · 800mm · f/11 · ISO 640"

  Scenario: An emptied camera line leaves the camera out, and an absent one is read from the photo
    Given a photo file "moon.jpg" of 1200x700 with EXIF:
      | Make  | NIKON CORPORATION |
      | Model | NIKON Z 8         |
    And a photo file "sun.jpg" of 1300x700 with EXIF:
      | Make  | NIKON CORPORATION |
      | Model | NIKON Z 8         |
    When I submit the photo "moon.jpg" to the form with:
      | title    | Half Moon |
      | category | astro     |
      | camera   |           |
    And I submit the photo "sun.jpg" to the form with:
      | title    | Sun   |
      | category | astro |
    Then the entry "astro/half-moon" should not have the field "camera"
    And the entry "astro/sun" should have the camera line "Nikon Z 8"

  Scenario: The same photo can be added to another category, but not twice to the same one
    Given a photo file "moon.jpg" of 1200x700
    When I submit the photo "moon.jpg" to the form with:
      | title    | Half Moon |
      | category | astro     |
    And I submit the photo "moon.jpg" to the form with:
      | title    | Moon Again |
      | category | astro      |
    Then the form should refuse it with status 409 and the code "duplicate"
    And the folder "astro/images" should contain exactly 1 entry file, each named after its photo id
    When I submit the photo "moon.jpg" to the form with:
      | title    | Moon In Nature |
      | category | nature         |
    Then the form should answer with status 200
    And the entries "astro/half-moon" and "nature/moon-in-nature" should reference the same photo
    And the private originals bucket should hold 1 object

  # --- What is refused ---------------------------------------------------------------------------------------------------

  Scenario Outline: A form that cannot be added is refused, and nothing is uploaded or written
    Given a photo file "moon.jpg" of 1200x700
    When I submit "<what>" to the form with:
      | title    | <title>    |
      | category | <category> |
      | order    | <order>    |
    Then the form should refuse it with status <status> and the code "<code>"
    And nothing should have been uploaded
    And the library should contain no entries and no category folders

    Examples:
      | what                     | title     | category  | order | status | code        |
      | a PNG picture            | Half Moon | astro     |       | 400    | not-jpeg    |
      | a text file              | Half Moon | astro     |       | 400    | unreadable  |
      | no photo at all          | Half Moon | astro     |       | 400    | bad-request |
      | the photo                |           | astro     |       | 400    | bad-request |
      | the photo                | Half Moon |           |       | 400    | bad-request |
      | the photo                | Half Moon | galaxies  |       | 400    | bad-request |
      | the photo                | Half Moon | astro     | -1    | 400    | bad-request |
      | the photo                | Half Moon | astro     | 2.5   | 400    | bad-request |
      | the photo                | Half Moon | astro     | soon  | 400    | bad-request |

  Scenario: A photo that cannot be stored writes no entry and reports the failure
    Given a photo file "moon.jpg" of 1200x700
    And R2 will fail to store anything matching "cover"
    When I submit the photo "moon.jpg" to the form with:
      | title    | Half Moon |
      | category | astro     |
    Then the form should refuse it with status 500 and the code "failed"
    And the form's message should mention "simulated upload failure"
    And the library should contain no entries and no category folders

  Scenario: A photo over the size limit is refused before it is read
    When I send a photo that claims to be 200 MB to the form to be read
    Then the form should refuse it with status 413 and the code "too-large"

  # --- Only the owner, on their own machine -----------------------------------------------------------------------------------

  Scenario Outline: Only the form's own page on localhost may use the service
    Given a photo file "moon.jpg" of 1200x700
    When I send <method> <address> to the service from the origin "<origin>"
    Then the form should refuse it with status 403 and the code "not-local"
    And nothing should have been uploaded
    And the library should contain no entries and no category folders

    Examples:
      | method | address                                | origin                  |
      | POST   | http://localhost:4321/__photos/add     | https://evil.example    |
      | POST   | http://localhost:4321/__photos/add     | none                    |
      | POST   | http://localhost:4321/__photos/analyze | http://localhost:9999   |
      | GET    | http://localhost:4321/__photos/status  | https://evil.example    |
      | GET    | http://photography.example/__photos/status | http://photography.example |
      | POST   | http://192.168.1.20:4321/__photos/add  | http://192.168.1.20:4321 |

  Scenario: Requests for anything else are not the form's
    Then the form's service should leave "/admin/" alone, and answer an unknown address of its own with 404

  Scenario: The form's service is added to the dev server only, and the built site never loads it
    Then astro.config.mjs should add the form's service in the dev server's setup and in no build step
    And no built page or script should contain the form's server code

  # --- The page --------------------------------------------------------------------------------------------------------------------

  Scenario: The Admin page offers every configured category to the form, in the page's own language
    Then the built Admin page in each language should offer every configured category to the form under its own name in that language

  Scenario: The form's messages exist in both languages with the same shape
    Then the form's messages should be the same set in English and Spanish, with the same placeholders

  Scenario: The form only talks to the local service, puts everything on the page as text, and never sends the admin token
    Then the form's code should only fetch from the local photo service, never write HTML, and never send the admin token

  # --- With the entries in R2 (as in `astro dev`) ----------------------------------------------------------------------------------

  Scenario: The form suggests orders from the entries R2 holds, and publishes what it adds
    Given the entries live in R2, with the library folder as their local mirror
    And R2 holds these entries:
      | category | title     | order | camera |
      | astro    | Half Moon | 4     |        |
    And a photo file "orion.jpg" of 1200x700
    When I ask the form for the category orders
    Then the form should say "astro" has 1 photos, a highest order of 4 and a next order of 5
    When I submit the photo "orion.jpg" to the form with:
      | title    | Orion Nebula |
      | category | astro        |
    Then the form should answer with status 200
    And the entry "astro/orion-nebula" should still have order 5
    And the manifest in R2 should list exactly: "astro/half-moon, astro/orion-nebula"
    And the form should answer with the written entry, identical to the file, and where it is
    And the entry "astro/orion-nebula" should be in R2 as its own .md file, identical to the local file

  Scenario: An entry another computer added is taken into account before the next order is chosen
    Given the entries live in R2, with the library folder as their local mirror
    And R2 holds these entries:
      | category | title     | order | camera |
      | astro    | Half Moon | 1     |        |
    When I ask the form for the category orders
    And R2 holds these entries:
      | category | title     | order | camera |
      | astro    | Half Moon | 1     |        |
      | astro    | Comet     | 2     |        |
    And I ask the form for the category orders
    Then the form should say "astro" has 2 photos, a highest order of 2 and a next order of 3

  Scenario: A manifest that cannot be stored is reported by the form, and the photo is not on the site
    Given the entries live in R2, with the library folder as their local mirror
    And a photo file "moon.jpg" of 1200x700
    And R2 will fail to store anything matching "index.json"
    When I submit the photo "moon.jpg" to the form with:
      | title    | Half Moon |
      | category | astro     |
    Then the form should refuse it with status 500 and the code "failed"
    And the form's message should mention "simulated upload failure"
    And R2 should hold no manifest

  Scenario: The form refuses to overwrite entries that were changed locally and never published
    Given the entries live in R2, with the library folder as their local mirror
    And R2 holds these entries:
      | category | title     | order | camera |
      | astro    | Half Moon | 3     |        |
    When I ask the form for the category orders
    And the local entry "astro/half-moon" is edited to have order 9
    And I ask the form for the category orders
    Then the form should refuse it with status 500 and the code "failed"
    And the form's message should mention "never published"

  Scenario: A photo added through the form lands in the right buckets and is listed in the manifest
    Given the entries live in R2, with the library folder as their local mirror
    And a photo file "moon.jpg" of 1200x700 with EXIF:
      | Make            | NIKON CORPORATION |
      | Model           | NIKON Z 8         |
      | FocalLength     | 800               |
      | FNumber         | 11                |
      | ExposureTime    | 1/125             |
      | ISOSpeedRatings | 640               |
    And I remember the bytes of the photo file "moon.jpg"
    When I submit the photo "moon.jpg" to the form with:
      | title    | Half Moon  |
      | titleEs  | Media luna |
      | category | astro      |
      | order    | 3          |
      | featured | true       |
    Then the form should answer with status 200
    And the private originals bucket should hold exactly the originals of: "astro/half-moon"
    And the stored original should be byte for byte the photo that was sent
    And the public web bucket should hold exactly the web sizes, entry files and manifest of: "astro/half-moon"
    And nothing but originals should be in the private originals bucket
    And no original should be in the public web bucket
    And the manifest in R2 should hold exactly these entries:
      | category | title     | titleEs    | width | height | camera                                        | featured | order |
      | astro    | Half Moon | Media luna | 1200  | 700    | Nikon Z 8 · 800mm · f/11 · 1/125s · ISO 640   | true     | 3     |
    And the manifest's update time should be the time of this run
    And every photo id in the manifest should be the hash of its original in R2
    And every manifest entry should equal the front matter of its entry file in R2

  Scenario: A photo added through the form joins the entries already in R2, which stay untouched
    Given the entries live in R2, with the library folder as their local mirror
    And R2 holds these entries:
      | category | title       | order | camera |
      | astro    | Half Moon   | 4     |        |
      | nature   | Rockfish    | 1     |        |
    And a photo file "orion.jpg" of 1100x700
    When I submit the photo "orion.jpg" to the form with:
      | title    | Orion Nebula |
      | category | astro        |
    Then the form should answer with status 200
    And the manifest in R2 should hold exactly these entries:
      | category | title        | titleEs | width | height | camera | featured | order |
      | astro    | Half Moon    |         | 1200  | 800    |        | false    | 4     |
      | astro    | Orion Nebula |         | 1100  | 700    |        | false    | 5     |
      | nature   | Rockfish     |         | 1200  | 800    |        | false    | 1     |
    And the private originals bucket should hold exactly the originals of: "astro/orion-nebula"
    And every manifest entry should equal the front matter of its entry file in R2

  Scenario: A photo the form could not fully upload is not listed in the manifest
    Given the entries live in R2, with the library folder as their local mirror
    And R2 holds these entries:
      | category | title       | order | camera |
      | astro    | Half Moon   | 4     |        |
    And a photo file "orion.jpg" of 1100x700
    And R2 will fail to store anything matching "full.webp"
    When I submit the photo "orion.jpg" to the form with:
      | title    | Orion Nebula |
      | category | astro        |
    Then the form should refuse it with status 500 and the code "failed"
    And the manifest in R2 should hold exactly these entries:
      | category | title     | titleEs | width | height | camera | featured | order |
      | astro    | Half Moon |         | 1200  | 800    |        | false    | 4     |

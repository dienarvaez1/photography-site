Feature: The Admin page's Pics Viewer lists the private originals and describes them without showing them
  As the site owner
  I want to see which original photos are stored, and each one's camera, size and copyright on hover
  So that I can check my archive without ever downloading or displaying the pictures

  The API here is the real Worker code answering from a fake originals bucket holding real JPEG files
  (with real EXIF and XMP metadata, and megabytes of picture data after it).

  Background:
    Given a results API with the admin token "correct-admin-token-123" and these original photos:
      | id                | extension | metadata         |
      | 1111111111111111  | jpg       | full             |
      | 2222222222222222  | jpeg      | xmp copyright    |
      | 3333333333333333  | jpg       | empty rights     |
      | 4444444444444444  | jpg       | nothing          |
      | 5555555555555555  | jpg       | not a picture    |

  # --- The list -------------------------------------------------------------------------------------------------

  Scenario: The list holds exactly the originals, with their real sizes
    When I call "/pics" with the admin token
    Then the response should be 200
    And the photo list should be exactly: "1111111111111111, 2222222222222222, 3333333333333333, 4444444444444444, 5555555555555555"
    And every listed photo should carry the size and key of the stored file
    And the list should say it is complete

  Scenario: Files that are not originals are never listed
    Given the bucket also holds "photos/6666666666666666/thumb.webp", "photos/6666666666666666/notes.txt", "photos/original.jpg", "photos/7777777777777777/sub/original.jpg", "results/index.json" and "other/8888888888888888/original.jpg"
    When I call "/pics" with the admin token
    Then the photo list should be exactly: "1111111111111111, 2222222222222222, 3333333333333333, 4444444444444444, 5555555555555555"

  Scenario: A bucket with no photos gives an empty list
    Given a bucket with no original photos
    When I call "/pics" with the admin token
    Then the response should be 200
    And the photo list should be exactly: ""

  Scenario: A long list is read page by page
    Given the bucket lists at most 2 objects per page
    When I call "/pics" with the admin token
    Then the photo list should be exactly: "1111111111111111, 2222222222222222, 3333333333333333, 4444444444444444, 5555555555555555"
    And the list should say it is complete

  Scenario: A list too long to read says so instead of pretending to be complete
    Given the bucket holds 30 originals and lists 1 object per page
    When I call "/pics" with the admin token
    Then the list should say it is incomplete

  # --- One photo ---------------------------------------------------------------------------------------------------

  Scenario: A photo with full metadata shows its camera, size and copyright
    When I call "/pics/1111111111111111" with the admin token
    Then the response should be 200
    And the camera line should be "Nikon Z 6 · NIKKOR Z 24-70mm f/4 S · 24mm · f/4 · 25s · ISO 3200"
    And the size should be the stored file's size, which is over 3 million bytes
    And the copyright should be "Copyright 2026 Diego Narvaez"
    And the artist should be "Diego Narvaez"

  Scenario: Copyright written in the XMP block is found too
    When I call "/pics/2222222222222222" with the admin token
    Then the camera line should be "Canon EOS R5"
    And the copyright should be "© 2026 XMP Owner (Unicode ok)"
    And the artist should be "Xmp Author"

  Scenario: An empty copyright field is reported as no copyright, and the artist is still shown
    When I call "/pics/3333333333333333" with the admin token
    Then the camera line should be "Nikon Z 6 · 24mm · f/4 · 25s · ISO 3200"
    And there should be no copyright
    And the artist should be "Someone 555-1234"

  Scenario Outline: A photo without usable metadata still has its size, and nothing else
    When I call "/pics/<id>" with the admin token
    Then the response should be 200
    And the size should be the stored file's size
    And there should be no camera line, no copyright and no artist

    Examples:
      | id               |
      | 4444444444444444 |
      | 5555555555555555 |

  Scenario: Only the start of a file is ever read, never the whole photograph
    When I call "/pics/1111111111111111" with the admin token
    And I call "/pics/2222222222222222" with the admin token
    And I call "/pics" with the admin token
    Then the bucket should only have been asked to list, and to read at most 131072 bytes from the start of a file

  Scenario: What is not needed is never passed on
    When I call "/pics/1111111111111111" with the admin token
    Then the answer should not contain the location, serial number, date or any other metadata of the file, only the camera, size, copyright and artist

  Scenario: No answer ever holds picture data
    When I call "/pics" with the admin token
    And I call "/pics/1111111111111111" with the admin token
    And I call "/pics/4444444444444444" with the admin token
    Then every answer should be small JSON with no picture data in it

  Scenario Outline: Unknown or malformed photo ids
    When I call "/pics/<id>" with the admin token
    Then the response should be <status> with the error "<error>"

    Examples:
      | id                  | status | error       |
      | 9999999999999999    | 404    | not-found   |
      | 1111                | 404    | not-found   |
      | 111111111111111     | 404    | not-found   |
      | a%2f..%2fb          | 400    | bad-request |
      | 1111111111111111%2f | 400    | bad-request |
      | %E0%A4%A            | 400    | bad-request |
      | -bad                | 400    | bad-request |

  Scenario: A path below a photo is not a photo
    When I call "/pics/1111111111111111/original.jpg" with the admin token
    Then the response should be 400 with the error "bad-request"

  # --- Access ----------------------------------------------------------------------------------------------------

  Scenario Outline: Both routes need the admin token
    When I call "<path>" <token>
    Then the response should be 401 with the error "unauthorized"

    Examples:
      | path                  | token                                |
      | /pics                 | with no token                        |
      | /pics/1111111111111111 | with no token                       |
      | /pics                 | with the token "wrong-token-value-1" |
      | /pics/1111111111111111 | with the token "wrong-token-value-1" |

  Scenario: Without a usable admin token neither route answers
    Given the admin token is "short"
    When I call "/pics" with the token "short"
    Then the response should be 503 with the error "not-configured"

  Scenario: A Worker without the originals bucket says so instead of failing
    Given the Worker has no originals bucket
    When I call "/pics" with the admin token
    Then the response should be 500 with the error "misconfigured"

  Scenario: The API stays read-only for the originals too
    When I send a "DELETE" request to "/pics/1111111111111111" with the admin token
    Then the response should be 405 with the error "method-not-allowed"
    And the originals should be unchanged

  Scenario: The token never appears in an answer
    When I call "/pics" with the admin token
    And I call "/pics/1111111111111111" with the admin token
    And I call "/pics/9999999999999999" with the admin token
    And I call "/pics" with no token
    And I call "/pics/2222222222222222" with the admin token
    Then no response body or header should contain the admin token

  Scenario: The Worker is bound to the originals bucket, read only, and its code cannot write
    Then the Worker's configuration should bind the originals bucket named in the site's photo configuration as ORIGINALS
    And the Worker's code should never write or delete in the originals bucket

  # --- The real Workers runtime ---------------------------------------------------------------------------------------------------

  Scenario: The same code reads real files' metadata in the real Workers runtime
    Given the same photos are stored in a local originals bucket and the Worker runs in the real Workers runtime
    When I call "/pics" with the admin token
    Then the photo list should be exactly: "1111111111111111, 2222222222222222, 3333333333333333, 4444444444444444, 5555555555555555"
    And every listed photo should carry the size and key of the stored file
    When I call "/pics/1111111111111111" with the admin token
    Then the camera line should be "Nikon Z 6 · NIKKOR Z 24-70mm f/4 S · 24mm · f/4 · 25s · ISO 3200"
    And the size should be the stored file's size, which is over 3 million bytes
    And the copyright should be "Copyright 2026 Diego Narvaez"
    When I call "/pics/2222222222222222" with the admin token
    Then the copyright should be "© 2026 XMP Owner (Unicode ok)"
    When I call "/pics/3333333333333333" with the admin token
    Then there should be no copyright
    And the artist should be "Someone 555-1234"
    When I call "/pics/9999999999999999" with the admin token
    Then the response should be 404 with the error "not-found"

  # --- The viewer's logic --------------------------------------------------------------------------------------------------

  Scenario Outline: File sizes read naturally in the page's language
    Then <bytes> bytes in "<locale>" should be shown as "<text>"

    Examples:
      | bytes      | locale | text     |
      | 0          | en     | 0 B      |
      | 999        | en     | 999 B    |
      | 1024       | en     | 1 KB     |
      | 1536       | en     | 1.5 KB   |
      | 3635121    | en     | 3.5 MB   |
      | 3635121    | es     | 3,5 MB   |
      | 1073741824 | en     | 1 GB     |
      | -5         | en     | –        |

  Scenario: The exact size is written with the page's thousands separator
    Then 3635121 bytes in "en" should be written exactly as "3,635,121 bytes"
    And 3635121 bytes in "es" should be written exactly as "3.635.121 bytes"

  Scenario Outline: Thumbnails are scaled down to fit a small square, never up
    Then a <width> by <height> picture should be shown at <shown width> by <shown height>

    Examples:
      | width | height | shown width | shown height |
      | 400   | 600    | 64          | 96           |
      | 600   | 400    | 96          | 64           |
      | 400   | 400    | 96          | 96           |
      | 50    | 40     | 50          | 40           |
      | 1     | 5000   | 1           | 96           |
      | 0     | 0      | 96          | 96           |

  Scenario: The list is joined with what the site knows, without losing or repeating any file
    Given the originals "c3, a1, b2, d4, e5" where the site knows a1 as "Zebra" in "nature", b2 as "Apple" in "nature", c3 as "Moon" in "astro"
    Then the rows should be ordered: "c3, b2, a1, d4, e5"
    And every original should appear exactly once

  # --- What is built -----------------------------------------------------------------------------------------------------------------

  Scenario Outline: The built Admin pages hold the Pics Viewer, in the page's language, knowing every photo of the site
    Then the built page "<page>" should hold the Pics Viewer for the configured API with "<locale>" messages and every photo of the site by its id

    Examples:
      | page                 | locale |
      | /admin/index.html    | en     |
      | /es/admin/index.html | es     |

  Scenario: The tab is called Pics Viewer, in both languages
    Then the built page "/admin/index.html" should have a tab named "Pics Viewer" with the address "#pics-viewer"
    And the built page "/es/admin/index.html" should have a tab named "Visor de fotos" with the address "#pics-viewer"

  Scenario: Every photo of the site has a thumbnail that is its small public web copy
    Then the built page "/admin/index.html" should give every photo of the site a thumbnail that is its public 400 pixel web copy, and never an original

  Scenario: The pages never name the private originals bucket
    Then no built page or script should contain the originals bucket's name

  Scenario: The Pics Viewer only ever shows the site's own thumbnail, and never a picture the API names
    Then the Pics Viewer's code should create no image but the thumbnail taken from the page's own photo data, and should only ask the API for the list and for one photo by its id
    And no answer of the API should be able to carry a picture or a picture address

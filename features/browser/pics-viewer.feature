@browser
Feature: The Admin page's Pics Viewer lists the private originals and describes them on hover, in a real browser
  As the site owner
  I want to hover over an original photo's file to see its camera, size and copyright
  So that I can check my archive without the pictures ever being loaded or shown

  The results API here is the real Worker code answering from fake buckets: runs published by the real
  publisher, and real JPEG files with real EXIF and XMP metadata (some of them megabytes large).

  Background:
    Given the results API holds the admin token "browser-test-admin-token" and these published runs:
      | time                 | commit  | offline results | browser results | smoke | artifacts |
      | 2026-09-21T10:00:00Z | ccccccc | 3 passed        |                 |       |           |
    And the originals bucket holds these files:
      | photo id         | metadata      |
      | 22d56df0b2da3a99 | full          |
      | 4c4f46c18b70c4b5 | empty rights  |
      | 4b3761b8ee641a7d | xmp copyright |
      | ffffffffffffffff | nothing       |

  # --- The tab and signing in ------------------------------------------------------------------------------------

  Scenario: The second tab is the Pics Viewer, and it asks for the token like the Test Results tab
    When I open "/admin/"
    And I click the "Pics Viewer" tab
    Then the "Pics Viewer" tab should be selected, its panel visible and the other panel hidden
    And the address should end with "#pics-viewer"
    And the Pics Viewer should ask for the admin token
    And the results API should not have been asked for the pictures

  Scenario: One sign-in serves both tabs
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I click the "Pics Viewer" tab
    Then the Pics Viewer should list 4 original photos in this order: "Half Moon, Orion Nebula, Chimpanzee Portrait, ffffffffffffffff"

  Scenario: Signing in on the Pics Viewer signs in the Test Results tab too
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    Then the Pics Viewer should list 4 original photos in this order: "Half Moon, Orion Nebula, Chimpanzee Portrait, ffffffffffffffff"
    When I click the "Test Results" tab
    Then the latest run should be shown as commit "ccccccc", Passed, with "3 of 3 passed"

  Scenario: Signing out of the Pics Viewer signs out of the Test Results tab too
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click "Sign out" in the Pics Viewer
    Then the Pics Viewer should ask for the admin token
    When I click the "Test Results" tab
    Then the Test Results tab should ask for the admin token

  Scenario: A wrong token is refused
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "definitely-the-wrong-one"
    Then the Pics Viewer should say "That token was not accepted."
    And the Pics Viewer should ask for the admin token

  Scenario: Nothing about the pictures is requested until the Pics Viewer is shown
    When I open "/admin/"
    And I sign in with the token "browser-test-admin-token"
    And I reload the page
    Then the latest run should be shown as commit "ccccccc", Passed, with "3 of 3 passed"
    And the results API should not have been asked for the pictures
    When I click the "Pics Viewer" tab
    Then the Pics Viewer should list 4 original photos in this order: "Half Moon, Orion Nebula, Chimpanzee Portrait, ffffffffffffffff"

  # --- The list --------------------------------------------------------------------------------------------------------

  Scenario: The list names each file, its photo and its category, and says which files the site does not use
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    Then the file for "Orion Nebula" should show the category "Astrophotography" and the path "photos/22d56df0b2da3a99/original.jpg"
    And the file for "ffffffffffffffff" should show the category "not on the site" and the path "photos/ffffffffffffffff/original.jpg"

  Scenario: The files are real links a keyboard can reach
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    Then every file should be a link that is in the tab order and large enough to tap

  # --- The tooltip ---------------------------------------------------------------------------------------------------------

  Scenario: Hovering a file shows its camera, size and copyright
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I hover over the file "Orion Nebula"
    Then the tooltip should show these facts:
      | Camera    | Nikon Z 6 · NIKKOR Z 24-70mm f/4 S · 24mm · f/4 · 25s · ISO 3200 |
      | Copyright | Copyright 2026 Diego Narvaez                                     |
      | Artist    | Diego Narvaez                                                    |
    And the tooltip should show the stored size of "22d56df0b2da3a99", which is about 2.9 MB
    And the tooltip should be what describes that file for a screen reader

  Scenario: A file without a copyright notice says so
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I hover over the file "Half Moon"
    Then the tooltip should show these facts:
      | Camera    | Nikon Z 6 · 24mm · f/4 · 25s · ISO 3200          |
      | Copyright | No copyright notice recorded in the file.        |
      | Artist    | Someone 555-1234                                 |

  Scenario: Copyright from the XMP block is shown, and a file with no metadata says what is missing
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I hover over the file "Chimpanzee Portrait"
    Then the tooltip should show these facts:
      | Camera    | Canon EOS R5                  |
      | Copyright | © 2026 XMP Owner (Unicode ok) |
    When I hover over the file "ffffffffffffffff"
    Then the tooltip should show these facts:
      | Camera    | No camera information in the file.        |
      | Copyright | No copyright notice recorded in the file. |

  Scenario: The tooltip goes away when the pointer leaves, and only one shows at a time
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I hover over the file "Orion Nebula"
    And I hover over the file "Half Moon"
    Then exactly one tooltip should be showing, for "Half Moon"
    When I move the pointer away from the files
    Then no tooltip should be showing

  Scenario: The tooltip can be reached with the pointer without disappearing
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I hover over the file "Orion Nebula"
    And I move the pointer onto the tooltip
    Then the tooltip should show these facts:
      | Artist | Diego Narvaez |

  Scenario: Keyboard focus shows the tooltip, Escape closes it, and moving on closes it too
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I tab until the file "Orion Nebula" has keyboard focus
    Then the tooltip should show these facts:
      | Copyright | Copyright 2026 Diego Narvaez |
    When I press the key "Escape"
    Then no tooltip should be showing
    And the file "Orion Nebula" should still have keyboard focus
    When I press the key "Tab"
    Then exactly one tooltip should be showing, for the next file in the list

  Scenario: Clicking a file shows the tooltip too, and the link goes nowhere
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I click the file "Orion Nebula"
    Then exactly one tooltip should be showing, for "Orion Nebula"
    And the address should end with "#pics-viewer"
    When I click somewhere else on the page
    Then no tooltip should be showing

  Scenario: Tapping a file on a phone shows the tooltip inside the screen, without sideways scrolling
    Given the visitor uses a phone
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I tap the file "Orion Nebula"
    Then the tooltip should show these facts:
      | Copyright | Copyright 2026 Diego Narvaez |
    And the tooltip should be entirely inside the screen
    And the page should not scroll sideways
    When I tap somewhere else on the page
    Then no tooltip should be showing

  Scenario: Each file is looked up once, however often it is hovered
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I hover over the file "Orion Nebula"
    And I move the pointer away from the files
    And I hover over the file "Orion Nebula"
    And I hover over the file "Half Moon"
    Then the results API should have been asked for photo "22d56df0b2da3a99" 1 time and for photo "4c4f46c18b70c4b5" 1 time

  # --- The thumbnails in the list -----------------------------------------------------------------------------------------------

  Scenario: Each row of the list starts with a small thumbnail of its photo
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    Then the row for "Orion Nebula" should start with a loaded thumbnail, no more than 96 pixels wide and tall, to the left of its title
    And the row for "Half Moon" should start with a loaded thumbnail, no more than 96 pixels wide and tall, to the left of its title
    And the row for "Chimpanzee Portrait" should start with a loaded thumbnail, no more than 96 pixels wide and tall, to the left of its title

  Scenario: A file the site has no copy of says there is no thumbnail
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    Then the row for "ffffffffffffffff" should say "No thumbnail" where the picture would be

  Scenario: The thumbnails are the site's own public 400 pixel copies, so the private originals are never loaded
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I hover over the file "Orion Nebula"
    And I hover over the file "Half Moon"
    And I hover over the file "Chimpanzee Portrait"
    Then the only pictures requested should be the public 400 pixel copies of "22d56df0b2da3a99, 4c4f46c18b70c4b5, 4b3761b8ee641a7d"
    And the page should have asked only for the list and for photo details, always with the token in the Authorization header
    And no request to the API should have been for a photo file, and the token should not be in any address
    And the bucket should have been asked only to list, and to read the first 131072 bytes at most of any file
    And the Pics Viewer should show no canvas or video, and no image other than the list's thumbnails

  Scenario: The thumbnails are decorative for screen readers, lazy, and not part of the tooltip
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I hover over the file "Orion Nebula"
    Then every thumbnail should be lazy-loaded and have an empty description, because the row's text already names the photo
    And the tooltip should show these facts:
      | Camera | Nikon Z 6 · NIKKOR Z 24-70mm f/4 S · 24mm · f/4 · 25s · ISO 3200 |
    And the tooltip should hold no picture

  Scenario: The tooltip holds no picture even while it is still loading
    Given the results API takes 1500 milliseconds to answer
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I hover over the file "Orion Nebula"
    Then the tooltip should say "Reading the file's information…"
    And the tooltip should hold no picture

  Scenario: The list of thumbnails needs nothing from the API but the list
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    Then the only pictures requested should be the public 400 pixel copies of "22d56df0b2da3a99, 4c4f46c18b70c4b5, 4b3761b8ee641a7d"
    And the results API should have been asked for the list only

  # --- When things are not normal --------------------------------------------------------------------------------------------------

  Scenario: An empty originals bucket says so
    Given the originals bucket holds these files:
      | photo id | metadata |
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    Then the Pics Viewer should say "The originals bucket has no photos yet."

  Scenario: A file that vanished says it could not be read, and hovering again tries again
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And the file "photos/22d56df0b2da3a99/original.jpg" disappears from the bucket
    And I hover over the file "Orion Nebula"
    Then the tooltip should say "Could not read this file's information."
    When I move the pointer away from the files
    And the file "photos/22d56df0b2da3a99/original.jpg" comes back
    And I hover over the file "Orion Nebula"
    Then the tooltip should show these facts:
      | Copyright | Copyright 2026 Diego Narvaez |

  Scenario: When the results API cannot be reached the viewer says so, and Refresh recovers
    Given the results API cannot be reached
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    Then the Pics Viewer should say "Could not reach the results service. Check your connection and try again."
    When the results API comes back
    And I click "Refresh" in the Pics Viewer
    Then the Pics Viewer should list 4 original photos in this order: "Half Moon, Orion Nebula, Chimpanzee Portrait, ffffffffffffffff"

  Scenario: A Worker that is missing the originals bucket says something went wrong, and keeps the token
    Given the Worker has no originals bucket
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    Then the Pics Viewer should say "The results service returned an error (500)."
    And the browser should still remember the token

  # --- Language, layout, accessibility --------------------------------------------------------------------------------------------------

  Scenario: The Pics Viewer speaks Spanish on the Spanish page
    When I open "/es/admin/#pics-viewer"
    Then the Pics Viewer should ask for the token in Spanish
    When I sign in to the Pics Viewer with the token "browser-test-admin-token"
    Then the Pics Viewer should list 4 original photos in this order: "La Nebulosa de Orion, Media luna, Retrato de un chimpancé, ffffffffffffffff"
    Then the row for "ffffffffffffffff" should say "Sin miniatura" where the picture would be
    When I hover over the file "La Nebulosa de Orion"
    Then the tooltip should show these facts:
      | Cámara                | Nikon Z 6 · NIKKOR Z 24-70mm f/4 S · 24mm · f/4 · 25s · ISO 3200 |
      | Derechos de autor     | Copyright 2026 Diego Narvaez                                     |
    And the tooltip should show the stored size of "22d56df0b2da3a99", which is about 2,9 MB

  Scenario Outline: Each state of the Pics Viewer passes the automated accessibility audit
    When I open "/admin/#pics-viewer"
    And I show the Pics Viewer in its "<state>" state
    Then the page should pass the automated accessibility audit

    Examples:
      | state            |
      | sign-in          |
      | list             |
      | tooltip showing  |

  Scenario Outline: No state of the Pics Viewer scrolls sideways on a phone
    Given the visitor uses a phone
    When I open "/admin/#pics-viewer"
    And I show the Pics Viewer in its "<state>" state
    Then the page should not scroll sideways

    Examples:
      | state            |
      | sign-in          |
      | list             |
      | tooltip showing  |

  Scenario: Using the Pics Viewer causes no script errors, no policy violations and no unexpected requests
    When I open "/admin/#pics-viewer"
    And I sign in to the Pics Viewer with the token "browser-test-admin-token"
    And I hover over the file "Orion Nebula"
    And I move the pointer away from the files
    And I click "Sign out" in the Pics Viewer
    Then no script error should have been logged
    And no Content-Security-Policy violation should have been reported
    And nothing but the site and the results API should have been requested

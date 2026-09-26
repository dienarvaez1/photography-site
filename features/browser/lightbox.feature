@browser
Feature: The photo lightbox works with mouse, keyboard and screen readers
  As a visitor
  I want to open a photo full-size and move around with the keyboard
  So that the gallery is usable without a mouse and never traps me

  Scenario: Opening a photo shows it in a dialog and moves focus into it
    When I open "/work/nature/"
    And I click photo number 2
    Then the lightbox should be open showing photo number 2 of the page
    And the lightbox photo should be the full-size version
    And keyboard focus should be on the lightbox close button
    And the page behind the lightbox should not scroll

  Scenario: Escape closes the lightbox and returns focus to the photo that opened it
    When I open "/work/nature/"
    And I click photo number 3
    And I press the key "Escape"
    Then the lightbox should be closed
    And keyboard focus should be back on photo number 3
    And the page behind the lightbox should scroll again

  Scenario: Arrow keys move between photos and wrap around at both ends
    When I open "/work/nature/"
    And I click photo number 1
    And I press the key "ArrowRight"
    Then the lightbox should show photo number 2 of the page
    When I press the key "ArrowLeft"
    And I press the key "ArrowLeft"
    Then the lightbox should show the last photo of the page
    When I press the key "ArrowRight"
    Then the lightbox should show photo number 1 of the page

  Scenario: The on-screen arrows work too
    When I open "/work/nature/"
    And I click photo number 1
    And I click the lightbox "next" button
    Then the lightbox should show photo number 2 of the page
    When I click the lightbox "previous" button
    Then the lightbox should show photo number 1 of the page

  Scenario: Tab and Shift+Tab stay inside the open lightbox
    When I open "/work/nature/"
    And I click photo number 1
    Then pressing Tab 7 times should always leave keyboard focus inside the lightbox
    And pressing Shift+Tab 7 times should always leave keyboard focus inside the lightbox

  Scenario: Clicking the dark background closes the lightbox
    When I open "/work/nature/"
    And I click photo number 1
    And I click the dark background of the lightbox
    Then the lightbox should be closed

  Scenario: The close button closes it
    When I open "/work/nature/"
    And I click photo number 1
    And I click the lightbox "close" button
    Then the lightbox should be closed

  Scenario: The lightbox is announced as a dialog with the photo's title, in Spanish too
    When I open "/es/work/nature/"
    And I click photo number 1
    Then the lightbox should be a modal dialog labelled by its caption
    And the lightbox controls should be labelled in "es"

  Scenario: The lightbox works on a phone
    Given the visitor uses a phone
    When I open "/work/nature/"
    And I click photo number 1
    Then the lightbox should be open showing photo number 1 of the page
    And the lightbox photo should fit inside the screen
    When I click the lightbox "close" button
    Then the lightbox should be closed

  Scenario: Opening and closing the lightbox reports no errors
    When I open "/work/nature/"
    And I click photo number 1
    And I press the key "Escape"
    Then no script error should have been logged

  Scenario: The caption includes the camera line, when the photo has one
    When I open "/work/nature/"
    And I click photo number 1
    Then the lightbox should show photo number 1's camera line

  Scenario: A counter shows position in the set, and follows navigation
    When I open "/work/nature/"
    And I click photo number 2
    Then the lightbox should show it is photo 2 of 7
    When I press the key "ArrowRight"
    Then the lightbox should show it is photo 3 of 7

  # --- Deep linking ---------------------------------------------------------------------------------------

  Scenario: Opening a photo puts it in the address, and closing takes it back out
    When I open "/work/nature/"
    And I click photo number 2
    Then the address should have a "photo" parameter
    When I click the lightbox "close" button
    Then the address should have no "photo" parameter

  Scenario: Reloading a page with a photo in the address opens straight to it
    When I open "/work/nature/"
    And I click photo number 2
    And I reload the page
    Then the lightbox should be open showing photo number 2 of the page

  Scenario: A link straight to a photo opens it before any click
    When I open the direct link to photo number 3 of "/work/nature/"
    Then the lightbox should be open showing photo number 3 of the page

  Scenario: The browser's Back button closes the lightbox and returns to the gallery
    When I open "/work/nature/"
    And I click photo number 2
    And I go back in the browser
    Then the lightbox should be closed
    And the address should have no "photo" parameter

  Scenario: Moving between photos replaces the address rather than growing the history
    When I open "/work/nature/"
    And I click photo number 1
    And I press the key "ArrowRight"
    And I press the key "ArrowRight"
    And I go back in the browser
    Then the lightbox should be closed

  # --- Touch: swipe and pinch-zoom -------------------------------------------------------------------------

  Scenario: Swiping left and right on a phone moves between photos
    Given the visitor uses a phone
    When I open "/work/nature/"
    And I click photo number 2
    And I swipe left on the lightbox photo
    Then the lightbox should show photo number 3 of the page
    When I swipe right on the lightbox photo
    Then the lightbox should show photo number 2 of the page

  Scenario: Swiping wraps around at both ends, same as the arrow keys
    Given the visitor uses a phone
    When I open "/work/nature/"
    And I click photo number 1
    And I swipe right on the lightbox photo
    Then the lightbox should show the last photo of the page

  Scenario: Pinching out zooms the open photo in, and pinching in zooms back out
    Given the visitor uses a phone
    When I open "/work/nature/"
    And I click photo number 1
    And I pinch out on the lightbox photo
    Then the lightbox photo should appear zoomed
    When I pinch in on the lightbox photo
    Then the lightbox photo should not appear zoomed

  Scenario: Moving to a different photo resets any zoom
    Given the visitor uses a phone
    When I open "/work/nature/"
    And I click photo number 1
    And I pinch out on the lightbox photo
    Then the lightbox photo should appear zoomed
    When I press the key "ArrowRight"
    Then the lightbox photo should not appear zoomed

  Scenario: A zoomed-in photo does not also register as a swipe
    Given the visitor uses a phone
    When I open "/work/nature/"
    And I click photo number 2
    And I pinch out on the lightbox photo
    And I swipe left on the lightbox photo
    Then the lightbox should show photo number 2 of the page

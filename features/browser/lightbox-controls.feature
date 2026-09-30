@browser
Feature: The photo lightbox's control box
  As a visitor looking at a photo full-size
  I want its controls (zoom in, zoom out, fullscreen, back to the gallery, close) together in one clear box, always
  in the same place and out of the photo's way, each saying what it does
  So that I can find them at a glance and use them without covering the photo

  The box sits below the photo, stacked one box-height above the screen's bottom margin: in the bottom-right corner
  on a laptop, centered along the bottom on a phone. Every test photo is the same tiny synthetic image, so the
  scenarios that need a photo the size of a real one give it the box a real 16:9 photo gets on that screen.

  # --- Where the box sits ------------------------------------------------------------------------------------------

  Scenario Outline: The box sits one box-height above the bottom of the screen: bottom right, centered on a phone
    Given the visitor uses a <device>
    When I open "/work/nature/"
    And I click photo number 1
    Then the control box should sit <where>, stacked one box-height above the bottom margin

    Examples:
      | device | where                                   |
      | laptop | in the screen's bottom-right corner     |
      | phone  | centered along the bottom of the screen |

  Scenario Outline: The box has a white border and holds the five controls, in order
    Given the visitor uses a <device>
    When I open "/work/nature/"
    And I click photo number 1
    Then the control box should have a white border all round
    And the control box should hold, left to right: "zoom in, zoom out, fullscreen, view gallery, close"

    Examples:
      | device |
      | laptop |
      | phone  |

  Scenario Outline: The box is below a real-sized photo and its caption, never over them
    Given the visitor uses a <device>
    When I open "/work/nature/"
    And I click photo number 1
    And the lightbox photo is the size of a real 16:9 photo
    Then the control box should not cover the photo, its title or the counter

    Examples:
      | device |
      | laptop |
      | phone  |

  Scenario: The box stays put while moving between photos, zooming and panning
    When I open "/work/nature/"
    And I click photo number 1
    And I note where the control box is
    And I press the key "ArrowRight"
    Then the control box should not have moved
    When I click the lightbox "zoom in" button 2 times
    And I drag the lightbox photo 3px right and 2px down
    Then the control box should not have moved

  Scenario: A zoomed-in photo passes under the box, which stays on top and clickable
    When I open "/work/nature/"
    And I click photo number 1
    And the lightbox photo is the size of a real 16:9 photo
    And I click the lightbox "zoom in" button 3 times
    Then the lightbox photo should appear zoomed
    And the lightbox photo should reach under the control box
    And every control in the box should be on top of the photo
    When I click the lightbox "close" button
    Then the lightbox should be closed

  Scenario: Tab goes Previous, then through the box left to right, then Next
    When I open "/work/nature/"
    And I click photo number 1
    And I click the lightbox "zoom in" button
    And I focus the lightbox "previous" control
    Then pressing Tab should visit, in order: "zoom in, zoom out, fullscreen, view gallery, close, next"

  # --- Icons ---------------------------------------------------------------------------------------------------------

  Scenario: Zoom in and zoom out are a magnifying glass with a plus and with a minus
    When I open "/work/nature/"
    And I click photo number 1
    Then the lightbox "zoom in" control should be a magnifying glass with a plus
    And the lightbox "zoom out" control should be a magnifying glass with a minus

  Scenario: Every icon is decoration: each control is named by its label alone
    When I open "/work/nature/"
    And I click photo number 1
    Then every control in the box should show only a hidden icon and be named by its label

  Scenario: A disabled control dims its icon only
    When I open "/work/nature/"
    And I click photo number 1
    Then the lightbox "zoom out" control should be disabled with a dimmed icon
    And the lightbox "zoom in" control should be enabled with a full-strength icon

  Scenario: The fullscreen icon turns its corners inward while fullscreen
    When I open "/work/nature/"
    And I click photo number 1
    Then the fullscreen icon's corners should point outward
    When the browser simulates entering fullscreen for the lightbox
    Then the fullscreen icon's corners should point inward
    When the browser simulates exiting fullscreen for the lightbox
    Then the fullscreen icon's corners should point outward

  # --- Tooltips ------------------------------------------------------------------------------------------------------

  Scenario: No tooltip shows until a control is pointed at
    When I open "/work/nature/"
    And I click photo number 1
    And I move the mouse away from the controls
    Then no lightbox tooltip should be showing

  Scenario: Pointing at any control shows its name, a disabled one too, and only that one
    When I open "/work/nature/"
    And I click photo number 1
    Then pointing at each of "zoom in, zoom out, fullscreen, view gallery, close, previous, next" should show just its own tooltip, saying its name

  Scenario: The box's tooltips open above it, and every tooltip stays on screen
    When I open "/work/nature/"
    And I click photo number 1
    Then the tooltips of "zoom in, zoom out, fullscreen, view gallery, close" should open above the control box
    And pointing at each of "zoom in, zoom out, fullscreen, view gallery, close, previous, next" should show a tooltip entirely on screen

  Scenario: Reaching a control with the keyboard shows its tooltip
    When I open "/work/nature/"
    And I click photo number 1
    And I press the key "Shift+Tab"
    Then the lightbox "view gallery" control should show the tooltip "View Nature gallery"
    When I press the key "Tab"
    Then the lightbox "close" control should show the tooltip "Close"

  Scenario: The tooltips follow the page's language, the open photo's category and the fullscreen state
    When I open "/es/work/nature/"
    And I click photo number 1
    And I point at the lightbox "zoom in" control
    Then the lightbox "zoom in" control should show the tooltip "Acercar"
    When I point at the lightbox "view gallery" control
    Then the lightbox "view gallery" control should show the tooltip "Ver galería de Naturaleza"
    When the browser simulates entering fullscreen for the lightbox
    And I point at the lightbox "fullscreen" control
    Then the lightbox "fullscreen" control should show the tooltip "Salir de pantalla completa"

  Scenario: On a phone, tapping a control leaves no tooltip or highlight behind
    Given the visitor uses a phone
    When I open "/work/nature/"
    And I click photo number 1
    And I tap the lightbox "zoom in" control
    And I tap the lightbox "zoom in" control
    Then the lightbox photo should appear zoomed
    And no lightbox tooltip should be showing
    And the lightbox "zoom in" control should not be highlighted

  # --- Dragging a zoomed photo --------------------------------------------------------------------------------------

  Scenario: Letting go of a dragged photo over the dark background keeps the lightbox open
    When I open "/work/nature/"
    And I click photo number 1
    And I click the lightbox "zoom in" button 2 times
    And I drag the lightbox photo up and left, letting go over the dark background
    Then the lightbox should be open showing photo number 1 of the page
    And the lightbox photo should have panned left and up

  Scenario: A press on the photo that ends on the dark background doesn't close it, even unzoomed
    When I open "/work/nature/"
    And I click photo number 1
    And I drag the lightbox photo up and left, letting go over the dark background
    Then the lightbox should be open showing photo number 1 of the page

  Scenario: A real click on the dark background still closes it
    When I open "/work/nature/"
    And I click photo number 1
    And I click the dark background of the lightbox
    Then the lightbox should be closed

  # --- The gallery link --------------------------------------------------------------------------------------------

  Scenario: After switching categories, the gallery link leads to the category now showing
    When I open "/work/nature/"
    And I click the category filter "Pets"
    And I click photo number 1
    Then the lightbox "view gallery" link should point at "/work/pets/"
    And the lightbox "view gallery" control should be labelled "View Pets gallery"

  Scenario: On "All", each photo's gallery link leads to that photo's own category, after a re-sort too
    When I open "/work/all/"
    Then every photo's gallery link should lead to its own category
    When I choose "Oldest first" from the sort control
    Then every photo's gallery link should lead to its own category

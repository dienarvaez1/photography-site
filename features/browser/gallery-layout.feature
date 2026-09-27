@browser
Feature: The justified gallery never stretches a tile far enough to crop away real content
  As a visitor browsing a category
  I want every photo shown at close to its own shape
  So that a portrait's subject (or any photo's edges) is never cropped away just because few
  photos share its row

  Gallery.astro lays out tiles with flex-grow, which stretches a row's tiles to fill its width
  while their height stays fixed — a category with few photos (so a narrow, portrait-oriented tile
  shares a mostly-empty row) used to stretch that tile to several times its natural width, and
  object-fit: cover cropped away most of the image to fill the now much wider box. Each ratio
  class's flex-grow (proportional to its own ratio) and max-width (capped relative to its own
  flex-basis) bound how far any one tile can be stretched, in src/components/Gallery.astro.

  Scenario Outline: A category with just one photo doesn't stretch its tile far past its own shape
    When I open "/work/<category>/"
    Then the first gallery tile's rendered aspect ratio should be within 30% of its photo's own

    Examples:
      | category  |
      | portrait  |
      | abstract  |
      | cityscape |
      | events    |

  Scenario: A category with just one photo centers its tile, instead of pinning it to the left
    When I open "/work/portrait/"
    Then the gallery should be centered in the page's content column, not flush left

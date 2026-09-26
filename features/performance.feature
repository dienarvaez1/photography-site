Feature: The site stays fast
  As a visitor on a phone
  I want small pages and right-sized images
  So that the site loads quickly and doesn't jump around as it loads

  Scenario: Every page stays within its size budget
    When I load every built page
    Then no page's HTML should exceed 30 KB, its scripts 26 KB, or its styles 25 KB, except that the Admin pages' scripts may reach 48 KB

  Scenario: Every image reserves its space, so the page cannot jump while loading
    When I load every built page
    Then every image on every page should declare a width and a height

  Scenario: The header logos are sized for what they show
    Then the file "public/logo.png" should be under 70 KB and at most 1000 pixels wide
    And the file "public/aperture-logo.png" should be under 30 KB and at most 300 pixels wide
    And no image in public should be over 100 KB

  Scenario: The logo is prioritised because it is the first thing on screen
    When I load the built page "/"
    Then the header logo should have high fetch priority and the icon should not

  Scenario Outline: Gallery photos offer the browser several sizes
    Given all photo content entries
    When I load the built page "<route>"
    Then every gallery image should offer the sizes "w400, thumb, w1000" for its own photo, smallest first, with a sizes hint

    Examples:
      | route            |
      | /work/nature/    |
      | /work/landscape/ |
      | /es/work/nature/ |

  Scenario: Category cards offer the browser several sizes too
    Given all photo content entries
    When I load the built page "/"
    Then every category card image should offer the sizes "w400, cover, w1000" for its own cover photo, with a sizes hint

  Scenario Outline: Only the first row of a gallery loads eagerly
    When I load the built page "<route>"
    Then the first 3 gallery images should load eagerly and the rest lazily
    And only the very first gallery image should have high fetch priority

    Examples:
      | route            |
      | /work/nature/    |
      | /es/work/nature/ |

  Scenario Outline: The srcset never lists the same width twice, even for small photos
    Then the sizes "w400, thumb, w1000" of a <width>x<height> photo should give the widths "<widths>"

    Examples:
      | width | height | widths         |
      | 4000  | 3000   | 400, 700, 1000 |
      | 800   | 600    | 400, 700, 800  |
      | 500   | 500    | 400, 500       |
      | 300   | 200    | 300            |

  Scenario: The size ladder is well-formed
    Then the configured web sizes should have unique widths and cover everything the srcsets use

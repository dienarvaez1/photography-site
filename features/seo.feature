Feature: Search and social sharing metadata
  As the site owner
  I want links to my site to look good when shared, and search engines to understand who I am
  So that the site gets found and represented properly in both languages

  Scenario: Every indexable page has a complete share image
    When I load every built page
    Then every page should declare an absolute og:image with its size and description, and a matching twitter:image

  Scenario: Pages without a photo share the branded image, which really is 1200 by 630
    When I load every built page
    Then every page except the category pages should share "/og-image.png" on the site's own domain
    And the file "public/og-image.png" should be a 1200 by 630 image under 100 KB

  Scenario: A category page shares its own first photo
    Given all photo content entries
    When I load every built page
    Then every category page with photos should share the full-size version of its first photo, with that photo's size and title

  Scenario: The error pages are not shared or indexed
    Then the built error pages should carry no share image, canonical or alternate links

  Scenario Outline: The home page publishes structured data for the business
    When I load the built page "<route>"
    Then the page should publish valid JSON-LD for a "WebSite" and a "ProfessionalService"
    And the structured data should be in "<language>" and use the page's own address
    And the structured data description should match the page's meta description
    And the business should have a postal address, an email and contact languages

    Examples:
      | route | language |
      | /     | en       |
      | /es/  | es       |

  Scenario: Only the home pages carry structured data
    When I load every built page
    Then only the pages "/" and "/es/" should contain JSON-LD

  Scenario: Structured data contains only facts that are already public
    When I load the built page "/"
    Then the structured data should contain no phone number, street address or person's name beyond the business name

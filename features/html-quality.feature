Feature: The HTML is valid and every link goes somewhere
  As a visitor, a search engine, or someone using assistive technology
  I want valid pages whose links, anchors and labels all work
  So that nothing is broken, unreachable or unnamed

  Scenario: Every page is valid HTML under the strict recommended rules, with no rules switched off
    When I load every built page and both error pages
    Then no page should have any html-validate problem

  Scenario: Every internal link, image, script and stylesheet points at something that exists
    When I load every built page and both error pages
    Then every internal reference should resolve to a built file

  Scenario: Every in-page anchor and ARIA reference has a target
    When I load every built page and both error pages
    Then every "#anchor", aria-controls, aria-labelledby and label reference should have a target on its page

  Scenario: Ids are unique and headings are in order
    When I load every built page and both error pages
    Then no page should repeat an id
    And every page should have exactly one h1 and never skip a heading level

  Scenario: Links and buttons all have names a screen reader can announce
    When I load every built page and both error pages
    Then every link and button should have an accessible name

  Scenario: Links that leave the site open safely
    When I load every built page and both error pages
    Then every external link should be https, and those opening a new tab should say so to screen readers

  Scenario: The sitemap and the pages agree
    Then every sitemap URL should be a built page, and every built page except the error pages should be in the sitemap

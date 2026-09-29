Feature: The Lighthouse run's index page sums up every page measured
  As the site owner
  I want one page that shows every Lighthouse measurement at a glance
  So that I can see what is slow or over budget without opening a dozen reports

  `npm run test:lighthouse` writes test-results/lighthouse/index.html at the end of every run. These scenarios build it
  from made-up measurements, so they need neither Lighthouse nor the network.

  Scenario: Every page and device is listed with its scores, timings and size, and links to its full report
    Given Lighthouse measured "/" on a phone with performance 91 and a Largest Contentful Paint of 2400 ms
    And Lighthouse measured "/" on a laptop with performance 99 and a Largest Contentful Paint of 900 ms
    And Lighthouse measured "/about/" on a phone with performance 95 and a Largest Contentful Paint of 1800 ms
    When the index page is written
    Then it should list 3 measurements, in this order: "/ Phone, / Laptop, /about/ Phone"
    And the row for "/" on a phone should show performance "91" and a Largest Contentful Paint of "2.4 s"
    And every row should link to its full report and to the page itself
    And it should say "3 of 3 within budget"
    And it should have no "What was over budget" section

  Scenario: A measurement over budget is marked, and what it missed is spelled out
    Given Lighthouse measured "/" on a phone with performance 60 and a Largest Contentful Paint of 7000 ms
    And Lighthouse measured "/about/" on a phone with performance 95 and a Largest Contentful Paint of 1800 ms
    When the index page is written
    Then it should say "1 of 2 within budget"
    And the row for "/" on a phone should be marked over budget
    And the row for "/about/" on a phone should be marked within budget
    And its "What was over budget" section should list "Performance 60 (needs 75)" for "/ · Phone"
    And its "What was over budget" section should list "Largest Contentful Paint 7000 ms (budget 5000 ms)" for "/ · Phone"

  Scenario: A browser error counts against the budget and is shown, safely
    Given Lighthouse measured "/contact/" on a laptop with performance 99 and a Largest Contentful Paint of 800 ms
    And that measurement logged the browser error "Refused to load <script src=x> by policy"
    When the index page is written
    Then the row for "/contact/" on a laptop should be marked over budget
    And its "What was over budget" section should list "Browser error — security: Refused to load <script src=x> by policy" for "/contact/ · Laptop"
    And the page should show that text as text, never as markup

  Scenario: The same problem on several pages is listed once, with every page it happened on
    Given Lighthouse measured "/" on a phone with performance 95 and a Largest Contentful Paint of 2000 ms
    And that measurement logged the browser error "Refused to load the analytics script"
    And Lighthouse measured "/about/" on a phone with performance 95 and a Largest Contentful Paint of 1800 ms
    And that measurement logged the browser error "Refused to load the analytics script"
    And Lighthouse measured "/contact/" on a phone with performance 95 and a Largest Contentful Paint of 1800 ms
    When the index page is written
    Then its "What was over budget" section should list 1 problem
    And its "What was over budget" section should list "Browser error — security: Refused to load the analytics script" for "/ · Phone, /about/ · Phone"

  Scenario: A problem on every page measured says so instead of naming them all
    Given Lighthouse measured "/" on a laptop with performance 99 and a Largest Contentful Paint of 800 ms
    And that measurement logged the browser error "Refused to load the analytics script"
    And Lighthouse measured "/es/" on a laptop with performance 99 and a Largest Contentful Paint of 800 ms
    And that measurement logged the browser error "Refused to load the analytics script"
    When the index page is written
    Then its "What was over budget" section should list "Browser error — security: Refused to load the analytics script" for "Every page measured (2)"

  Scenario: The index page stands on its own
    Given Lighthouse measured "/" on a phone with performance 91 and a Largest Contentful Paint of 2400 ms
    When the index page is written
    Then it should contain no scripts and load nothing from anywhere
    And it should name the site measured, when, and how many runs per page

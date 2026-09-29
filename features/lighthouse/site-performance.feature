@lighthouse
Feature: The live site is fast, accessible and well built, as Google Lighthouse measures it
  As the site owner
  I want each main page measured the way Google measures it, on a phone and on a laptop
  So that a slower page, a heavier page or a new browser error is caught instead of noticed by visitors

  Each page is measured three times per device and judged on the median run (LIGHTHOUSE_RUNS changes that).
  The budgets live in one place, features/support/lighthouse.js. The median run's report is saved under
  test-results/lighthouse/. The Admin page is left out: it is noindex, behind a token, and only for the owner.

  Scenario Outline: <page> on a <device> scores within its budget
    When Lighthouse measures "<page>" on a <device>
    Then its performance, accessibility, best practices and SEO scores should be within the <device> budget

    Examples:
      | page          | device  |
      | /             | phone   |
      | /work/all/    | phone   |
      | /work/nature/ | phone   |
      | /about/       | phone   |
      | /contact/     | phone   |
      | /es/          | phone   |
      | /             | laptop  |
      | /work/all/    | laptop  |
      | /work/nature/ | laptop  |
      | /about/       | laptop  |
      | /contact/     | laptop  |
      | /es/          | laptop  |

  Scenario Outline: <page> on a <device> paints quickly, without shifting or blocking
    When Lighthouse measures "<page>" on a <device>
    Then its First Contentful Paint, Largest Contentful Paint, Total Blocking Time and Cumulative Layout Shift should be within the <device> budget

    Examples:
      | page          | device  |
      | /             | phone   |
      | /work/all/    | phone   |
      | /work/nature/ | phone   |
      | /about/       | phone   |
      | /contact/     | phone   |
      | /es/          | phone   |
      | /             | laptop  |
      | /work/all/    | laptop  |
      | /work/nature/ | laptop  |
      | /about/       | laptop  |
      | /contact/     | laptop  |
      | /es/          | laptop  |

  Scenario Outline: <page> on a <device> stays light and logs no browser errors
    When Lighthouse measures "<page>" on a <device>
    Then its total download should be within the <device> budget
    And it should log no errors in the browser console

    Examples:
      | page          | device  |
      | /             | phone   |
      | /work/all/    | phone   |
      | /work/nature/ | phone   |
      | /about/       | phone   |
      | /contact/     | phone   |
      | /es/          | phone   |
      | /             | laptop  |
      | /work/all/    | laptop  |
      | /work/nature/ | laptop  |
      | /about/       | laptop  |
      | /contact/     | laptop  |
      | /es/          | laptop  |

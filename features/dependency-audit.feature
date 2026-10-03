Feature: The dependency audit fails on high advisories, except the few accepted for a written reason
  As the site owner
  I want CI to stop on any serious advisory in the site's dependencies
  So that a vulnerable package never slips in, while one with no fix yet (and out of the site's reach) doesn't block every change

  scripts/audit.mjs reads `npm audit --json`. These scenarios give it made-up reports.

  Scenario: Only an accepted advisory: the audit passes, and says which one it accepted
    Given an audit report with the advisory "GHSA-ch52-4w7c-c8xp" of "high" severity in "http-cache-semantics"
    Then the audit should find nothing blocking
    And it should list "GHSA-ch52-4w7c-c8xp" as accepted for now

  Scenario Outline: Any other <severity> advisory blocks
    Given an audit report with the advisory "GHSA-ch52-4w7c-c8xp" of "high" severity in "http-cache-semantics"
    And the advisory "GHSA-aaaa-bbbb-cccc" of "<severity>" severity in "left-pad"
    Then the audit should block on "GHSA-aaaa-bbbb-cccc" only

    Examples:
      | severity |
      | high     |
      | critical |

  Scenario: A moderate or low advisory doesn't block
    Given an audit report with the advisory "GHSA-dddd-eeee-ffff" of "moderate" severity in "minimist"
    And the advisory "GHSA-gggg-hhhh-iiii" of "low" severity in "debug"
    Then the audit should find nothing blocking

  Scenario: A package flagged only through another is counted once, through its advisory
    Given an audit report with the advisory "GHSA-aaaa-bbbb-cccc" of "high" severity in "left-pad", which "astro" depends on
    Then the audit should block on "GHSA-aaaa-bbbb-cccc" only

  Scenario: When an accepted package can be fixed without a breaking change, the audit says it's time to drop the exception
    Given an audit report with the advisory "GHSA-ch52-4w7c-c8xp" of "high" severity in "http-cache-semantics", fixable without a breaking change
    Then the audit should say a fix is now available for "http-cache-semantics"

  Scenario: Every accepted advisory says why, and names the issue tracking it
    Then every accepted advisory should give a reason and link an issue on the site's repository

  Scenario: CI runs this audit, not the bare npm audit
    Then the CI workflow's Dependency audit step should run "npm run audit"

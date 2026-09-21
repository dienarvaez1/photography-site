Feature: A deploy cannot silently break the site
  As the site owner
  I want a build that would ship broken contact forms to fail loudly instead
  So that a good deployment is never quietly replaced by a bad one

  Background: Cloudflare's Git build has no .env file, so it used to publish the contact pages
  without their Web3Forms keys (a "not configured" notice instead of the form) on every push.

  # --- The release-build guard --------------------------------------------------------

  Scenario Outline: Only release builds require the contact-form keys
    Then a build with environment "<environment>" and arguments "<arguments>" should count as a release build: "<release>"

    Examples:
      | environment  | arguments | release |
      | none         |           | no      |
      | WORKERS_CI=1 |           | yes     |
      | CF_PAGES=1   |           | yes     |
      | CI=true      |           | yes     |
      | none         | --require | yes     |

  Scenario Outline: The keys are checked for presence, format and difference
    Then the contact-form keys "<english>" and "<spanish>" should have this problem: "<problem>"

    Examples:
      | english   | spanish   | problem                                        |
      | GOOD_A    | GOOD_B    | none                                           |
      | missing   | GOOD_B    | PUBLIC_WEB3FORMS_KEY is not set                |
      | GOOD_A    | missing   | PUBLIC_WEB3FORMS_KEY_ES is not set             |
      | missing   | missing   | PUBLIC_WEB3FORMS_KEY is not set                |
      | not-a-key | GOOD_B    | does not look like a Web3Forms access key      |
      | GOOD_A    | not-a-key | does not look like a Web3Forms access key      |
      | GOOD_A    | GOOD_A    | each language needs its own form               |

  Scenario Outline: The build script refuses to build a release without keys, and says how to fix it
    Given a copy of the build guard in a folder with <dotenv>
    When the build guard runs with environment "<environment>" and arguments "<arguments>"
    Then the build guard should <outcome>

    Examples:
      | dotenv        | environment                                          | arguments | outcome                                      |
      | no .env file  | WORKERS_CI=1                                         |           | fail and name both variables and Cloudflare  |
      | no .env file  | none                                                 |           | pass without complaint                       |
      | no .env file  | WORKERS_CI=1;PUBLIC_WEB3FORMS_KEY=GOOD_A             |           | fail and name both variables and Cloudflare  |
      | no .env file  | WORKERS_CI=1;PUBLIC_WEB3FORMS_KEY=GOOD_A;PUBLIC_WEB3FORMS_KEY_ES=GOOD_B | | pass and confirm the keys              |
      | both keys     | none                                                 | --require | pass and confirm the keys                    |
      | no .env file  | none                                                 | --require | fail and name both variables and Cloudflare  |

  Scenario: Building runs the guard first, and the deploy command is guarded end to end
    Then the "build" script should be preceded by the "prebuild" script running the build guard
    And the "deploy" script should build, then deploy with wrangler, then smoke-check the live site, in that order
    And the "predeploy" script should require the keys, run the tests and verify the photos before anything is deployed
    And the "deploy:unchecked" script should exist as an explicit way around the checks
    And the "smoke" and "test:browser" scripts should exist

  Scenario: The Cloudflare build variables are documented where the guard sends people
    Then the README should name both build variables and the Cloudflare settings page they go in

  # --- GitHub automation ---------------------------------------------------------------

  Scenario: CI runs the whole suite on every push and pull request
    Then the CI workflow should run on pushes to main and on pull requests
    And the CI workflow should type-check, run the tests, run the browser tests and audit dependencies
    And the CI workflow's placeholder keys should satisfy the release-build guard

  Scenario: CI smoke-checks the live site after Cloudflare has built it
    Then the CI workflow should smoke-check the live site only for pushes to main, after the tests pass and after waiting for Cloudflare

  Scenario: The live site is smoke-checked on a schedule
    Then the smoke workflow should run every few hours and on demand

  Scenario: The workflows use a Node version the tools support
    Then the workflows' Node version should satisfy the package's engines requirement
    And the engines requirement should allow native TypeScript imports

  # --- robots.txt and 404 pages ---------------------------------------------------------

  Scenario: robots.txt advertises the sitemap on the site's real address
    Then the built robots.txt should allow crawling and point at the sitemap on the configured site URL
    And no hand-written robots.txt should exist in public

  Scenario Outline: Unknown URLs get a real, localized, unindexed error page
    Given the built error page "<page>"
    Then it should be in the language "<language>" with the localized 404 heading
    And it should ask search engines not to index it and declare no canonical or alternate URL
    And its links should stay in the "<language>" version of the site
    And its language switcher should lead to the other language's home page, never to a page that does not exist
    And it should have the site header and footer

    Examples:
      | page         | language |
      | /404.html    | en       |
      | /es/404.html | es       |

  Scenario: Cloudflare is told to serve those error pages
    Then wrangler.jsonc should serve the nearest 404 page for unknown URLs
    And the generated deploy configuration should keep that setting

  Scenario: Error pages stay out of the sitemap and no error page answers with a success status
    Then the sitemap should not list any 404 page
    And no "404" directory should be built, so only the .html error pages exist

  # --- Content-Security-Policy ------------------------------------------------------------

  Scenario: The baseline security headers and a Content-Security-Policy are declared
    Then the deployment headers file should declare a Content-Security-Policy in addition to the baseline headers

  Scenario: The policy is strict where it matters
    Then the Content-Security-Policy should allow scripts only from the site itself
    And the Content-Security-Policy should forbid plugins, framing and foreign base URLs

  Scenario: The policy allows exactly what the pages load
    Then the Content-Security-Policy should allow the photo host configured in the site
    And the Content-Security-Policy should allow the contact form's API in connect-src and form-action
    And the Content-Security-Policy should allow the results API configured in the site in connect-src and img-src, and nothing broader
    And every external address the built pages and scripts load should be allowed by the policy

  Scenario: The pages contain nothing the strict policy would block
    Then no built page should contain an inline script, an inline event handler or a style attribute

Feature: Every page's footer says which build of the site it is
  As the site owner
  I want every page's footer to name the exact code the site was built from
  So that I can tell at a glance whether what is live is what I think it is

  The footer shows the release tag when the build is exactly a tagged commit with nothing uncommitted, and otherwise
  the short commit hash ("-dirty" added when the build had uncommitted changes).

  # --- Working out the label --------------------------------------------------------------------------------------

  Scenario: Before any release is tagged, the build is the short commit hash
    Given a git repository with one commit
    Then its build label should be the short hash of its latest commit
    And its build commit should be the full hash of its latest commit
    And its build should not be marked dirty

  Scenario: A build of a tagged release is shown as the tag
    Given a git repository with one commit
    And its latest commit is tagged "v1.0.0"
    Then its build label should be "v1.0.0"

  Scenario: A build past the last release is shown as its commit, not the tag
    Given a git repository with one commit
    And its latest commit is tagged "v1.0.0"
    And 2 more commits are made
    Then its build label should be the short hash of its latest commit
    And its full version should be "v1.0.0-2-g" followed by the short hash of its latest commit

  Scenario: Uncommitted changes are never shown as a release
    Given a git repository with one commit
    And its latest commit is tagged "v1.0.0"
    And one of its files is changed without committing
    Then its build label should be the short hash of its latest commit, followed by "-dirty"
    And its build should be marked dirty

  Scenario: Somewhere without git the build still gets a label
    Given a folder that is not a git repository
    Then its build label should be "unknown"
    And its build commit should be none

  Scenario: The build can be named from outside, for a build made without git history
    Given a folder that is not a git repository
    When it is built with BUILD_VERSION "v2.0.0" and BUILD_COMMIT "0123456789abcdef0123456789abcdef01234567"
    Then its build label should be "v2.0.0"
    And its build commit should be "0123456789abcdef0123456789abcdef01234567"

  Scenario: The build time is recorded in UTC
    Given a folder that is not a git repository
    When it is built at "2026-09-28T14:03:27.000Z"
    Then its build time should be "2026-09-28T14:03:27.000Z"

  # --- Showing it -------------------------------------------------------------------------------------------------

  Scenario Outline: Every page's footer names this build, last, in the page's language
    When I load the built page "<route>"
    Then its footer should say "<build> " followed by this checkout's build label, as its last item
    And its footer should give this checkout's full commit hash and when the site was built

    Examples:
      | route        | build   |
      | /            | Build   |
      | /about/      | Build   |
      | /work/nature/ | Build  |
      | /admin/      | Build   |
      | /es/         | Versión |
      | /es/contact/ | Versión |
      | /es/admin/   | Versión |

  Scenario: No page's footer shows the email address
    When I load every built page
    Then no page's footer should show an email address

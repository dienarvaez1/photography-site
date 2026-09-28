Feature: The Admin page says which build of the site it is
  As the site owner
  I want the Admin page's footer to name the exact code the site was built from
  So that I can tell at a glance whether what is live is what I think it is

  The version is `git describe --tags --always --dirty`: the short commit hash until a release is tagged, the tag
  (plus how far past it) once one is, and "-dirty" when the build had uncommitted changes.

  # --- Working out the version ------------------------------------------------------------------------------------

  Scenario: Before any release is tagged, the version is the short commit hash
    Given a git repository with one commit
    Then its build version should be the short hash of its latest commit
    And its build commit should be the full hash of its latest commit
    And its build should not be marked dirty

  Scenario: At a tagged commit, the version is the tag
    Given a git repository with one commit
    And its latest commit is tagged "v1.0.0"
    Then its build version should be "v1.0.0"

  Scenario: Past a tag, the version says how far past, and at which commit
    Given a git repository with one commit
    And its latest commit is tagged "v1.0.0"
    And 2 more commits are made
    Then its build version should be "v1.0.0-2-g" followed by the short hash of its latest commit

  Scenario: Uncommitted changes mark the build dirty
    Given a git repository with one commit
    And one of its files is changed without committing
    Then its build version should be the short hash of its latest commit, followed by "-dirty"
    And its build should be marked dirty

  Scenario: Somewhere without git the build still gets a version
    Given a folder that is not a git repository
    Then its build version should be "unknown"
    And its build commit should be none

  Scenario: The version can be given from outside, for a build made without git history
    Given a folder that is not a git repository
    When it is built with BUILD_VERSION "v2.0.0" and BUILD_COMMIT "0123456789abcdef0123456789abcdef01234567"
    Then its build version should be "v2.0.0"
    And its build commit should be "0123456789abcdef0123456789abcdef01234567"

  Scenario: The build time is recorded in UTC
    Given a folder that is not a git repository
    When it is built at "2026-09-28T14:03:27.000Z"
    Then its build time should be "2026-09-28T14:03:27.000Z"

  # --- Showing it -------------------------------------------------------------------------------------------------

  Scenario Outline: The Admin page's footer names this build, in the page's language
    When I load the built page "<route>"
    Then its footer should say "<build> " followed by this checkout's build version
    And its footer should give this checkout's full commit hash
    And its footer should give when the site was built, as a machine-readable UTC time

    Examples:
      | route      | build   |
      | /admin/    | Build   |
      | /es/admin/ | Versión |

  Scenario Outline: Visitors' pages do not show the build
    When I load the built page "<route>"
    Then its footer should not mention the build

    Examples:
      | route       |
      | /           |
      | /about/     |
      | /es/contact/ |

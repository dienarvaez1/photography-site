Feature: The README stays in step with the tests and the photo commands
  As the site owner
  I want the README to describe every test feature and every photo command
  So that the documentation can never silently drift away from the code again

  Scenario: Every feature file is described in the README
    Then every feature file should be described in the README
    And every browser feature file should be described in the README

  Scenario: The README states the right number of test areas
    Then the number of test areas stated in the README should equal the number of feature files

  Scenario: Every photo command is documented in the README
    Then every "photos:" npm script should appear in the README

  Scenario: Every npm script is documented in the README
    Then every npm script that is not an automatic hook should be documented in the README

@browser
Feature: A failing browser scenario leaves evidence
  As the site owner
  I want a failed browser test to leave a screenshot, a trace and notes
  So that I can see what the browser saw, and those files are stored in R2 with the run

  A small fixture suite with one scenario that fails on purpose and one that passes is run for real.

  Scenario: A failure leaves a screenshot, a replayable trace and notes; a pass leaves nothing
    When the fixture browser suite runs with one failing and one passing scenario
    Then the run should fail because of the one scenario that fails on purpose
    And the artifacts folder should hold exactly one screenshot, one trace and one notes file, all for "fails-on-purpose"
    And the screenshot should be a real PNG image and the trace a real zip archive
    And the notes should name the scenario, the page, the status and the reason it failed, and how to open the trace

  Scenario: Those artifacts are stored in R2 with the run
    When the fixture browser suite runs with one failing and one passing scenario
    And the results are published to a fake results bucket
    Then the bucket should hold the screenshot, trace and notes under the run's "artifacts/browser/" folder
    And the run's summary should list them among its files

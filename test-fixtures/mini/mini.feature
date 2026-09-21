Feature: Mini fixture

  Scenario: Passes
    Given a step that passes

  Scenario: Fails halfway
    Given a step that passes
    When a step that fails with "boom: expected 1 to equal 2"
    Then a step that passes

  Scenario: Has an undefined step
    Given a step nobody defined

  Scenario: Is skipped
    Given a step that skips

  Scenario Outline: Outline <n>
    Given a step that passes

    Examples:
      | n |
      | 1 |
      | 2 |

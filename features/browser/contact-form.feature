@browser
Feature: The contact form works end to end in a real browser
  As a visitor
  I want to send a message and know whether it worked, in my language
  So that I can reach the photographer

  Web3Forms is stubbed: these scenarios never send a real message.

  Scenario Outline: A message is sent, confirmed in the page's language, and the form is cleared
    When I open "<page>"
    And I fill in the contact form with name "Ana Pérez", email "ana@example.com", interest "<interest>" and message "Hola, quiero una sesión."
    And I send the message
    Then the form status should show the "success" message
    And the form should be empty again
    And Web3Forms should have received exactly one submission carrying:
      | name     | Ana Pérez                |
      | email    | ana@example.com          |
      | category | <category value>         |
      | message  | Hola, quiero una sesión. |
    And the submission should use this page's own access key

    Examples:
      | page         | interest         | category value   |
      | /contact/    | Nature           | Nature           |
      | /contact/    | Other            | Other            |
      | /es/contact/ | Naturaleza       | Nature           |
      | /es/contact/ | Otro             | Other            |
      | /es/contact/ | Eventos públicos | Public Events    |

  Scenario Outline: Trouble sending is reported in the page's language and nothing is lost
    Given Web3Forms <behaviour>
    When I open "<page>"
    And I fill in the contact form with name "Ana", email "ana@example.com", interest "Other" and message "Hello"
    And I send the message
    Then the form status should show the "error" message
    And the form should still contain what the visitor typed
    And the send button should be enabled again

    Examples:
      | behaviour        | page         |
      | rejects it       | /contact/    |
      | is unreachable   | /contact/    |
      | rejects it       | /es/contact/ |
      | is unreachable   | /es/contact/ |

  Scenario: The button is disabled and a sending message shown while the request is in flight
    Given Web3Forms is slow
    When I open "/contact/"
    And I fill in the contact form with name "Ana", email "ana@example.com", interest "Other" and message "Hello"
    And I send the message
    Then the send button should be disabled and the form should say it is sending
    And the form status should eventually show the "success" message
    And the send button should be enabled again

  Scenario: A second message can be sent after the first
    When I open "/contact/"
    And I fill in the contact form with name "Ana", email "ana@example.com", interest "Other" and message "First"
    And I send the message
    And the form status should show the "success" message
    And I fill in the contact form with name "Ben", email "ben@example.com", interest "Pets" and message "Second"
    And I send the message
    Then Web3Forms should have received 2 submissions

  Scenario: Required fields are enforced by the browser before anything is sent
    When I open "/contact/"
    And I send the message
    Then no message should have been sent
    And the first required field should be focused and marked invalid

  Scenario: An invalid email address is refused before anything is sent
    When I open "/contact/"
    And I fill in the contact form with name "Ana", email "not-an-email", interest "Other" and message "Hello"
    And I send the message
    Then no message should have been sent

  Scenario: The spam-trap field is invisible and cannot be reached by keyboard or screen reader
    When I open "/contact/"
    Then the spam-trap checkbox should be visually hidden, out of the tab order and hidden from assistive technology
    And tabbing through the form should never land on the spam-trap checkbox

  Scenario Outline: With JavaScript off, the form still posts to Web3Forms as a normal form
    Given JavaScript is switched off
    When I open "<page>"
    And I fill in the contact form with name "Ana", email "ana@example.com", interest "Other" and message "Hello"
    And I send the message
    Then Web3Forms should have received a plain form post carrying the name, email and message
    And the submission should use this page's own access key

    Examples:
      | page         |
      | /contact/    |
      | /es/contact/ |

  Scenario: Sending a message reports no script errors and no policy violations
    When I open "/contact/"
    And I fill in the contact form with name "Ana", email "ana@example.com", interest "Other" and message "Hello"
    And I send the message
    And the form status should show the "success" message
    Then no script error should have been logged
    And no Content-Security-Policy violation should have been reported

Feature: The Admin page's Test Results tab shows the stored test runs
  As the site owner
  I want the Test Results tab to start from the results store's index.json and latest.json and let me open any run
  So that I can see how the tests are doing without opening the bucket

  The interactive behaviour (token, list, opening a run) is tested in a real browser in browser/results-viewer.feature.
  These scenarios cover the pure logic the viewer is built from and what the built pages contain.

  # --- Where the address points ----------------------------------------------------------------------

  Scenario Outline: The address bar says which part of the tab to show
    Then the address "<hash>" should show <view>

    Examples:
      | hash                                                      | view                                         |
      | #test-results                                             | the list of runs                             |
      | #test-results/run/2026-09-21T04-54-28Z-e786ff8-dirty-local | the run "2026-09-21T04-54-28Z-e786ff8-dirty-local" |
      | #test-results/run/2026-09-21T04-54-28Z-e786ff8-local-2    | the run "2026-09-21T04-54-28Z-e786ff8-local-2" |
      | #test-results/run/not-a-run                               | the list of runs                             |
      | #test-results/run/                                        | the list of runs                             |
      | #test-results/run/%E0%A4%A                                | the list of runs                             |
      | #test-results/run/2026-09-21T04-54-28Z-e786ff8-local/x    | the list of runs                             |
      | #test-results/other                                       | the list of runs                             |
      | #pics-viewer                                                    | another tab                                  |
      |                                                           | another tab                                  |
      | #test-resultsx                                            | another tab                                  |

  Scenario: A run's link and the parsed address agree
    Then the link to the run "2026-09-21T04-54-28Z-e786ff8-local" should be shown as that same run again

  # --- Wording and numbers ---------------------------------------------------------------------------------

  Scenario Outline: Durations read naturally
    Then <ms> milliseconds should be shown as "<text>"

    Examples:
      | ms      | text        |
      | 0       | 0 ms        |
      | 999     | 999 ms      |
      | 1000    | 1.0 s       |
      | 1500    | 1.5 s       |
      | 59949   | 59.9 s      |
      | 60000   | 1 min 0 s   |
      | 125000  | 2 min 5 s   |
      | 3599600 | 60 min 0 s  |
      | -1      | –           |

  Scenario Outline: Moments are shown in UTC and in the page's language
    Then the moment "2026-09-21T04:54:28.000Z" in "<locale>" should read "<text>"

    Examples:
      | locale | text                                |
      | en     | Sep 21, 2026, 4:54 AM UTC           |
      | es     | 21 sept 2026, 4:54 UTC              |

  Scenario Outline: A missing or broken moment shows a dash
    Then the moment "<value>" in "en" should read "–"

    Examples:
      | value       |
      |             |
      | not a date  |

  Scenario: Messages fill in their placeholders and leave unknown ones visible
    Then the message "{passed} of {scenarios} passed" with passed 3 and scenarios 5 should read "3 of 5 passed"
    And the message "Hello {name}" with no values should read "Hello {name}"

  Scenario Outline: The totals line tells the truth about failures and skips
    Then totals of <scenarios> scenarios, <passed> passed, <failed> failed and <skipped> skipped should read "<text>"

    Examples:
      | scenarios | passed | failed | skipped | text                                                  |
      | 525       | 525    | 0      | 0       | 525 of 525 passed                                     |
      | 10        | 3      | 2      | 5       | 3 of 10 passed, 2 failed, 5 skipped                   |
      | 10        | 9      | 0      | 1       | 9 of 10 passed, 0 failed, 1 skipped                   |
      | 10        | 8      | 0      | 0       | 8 of 10 passed, 0 failed, 0 skipped                   |

  # --- Which address the page talks to ---------------------------------------------------------------------

  Scenario Outline: The results address can only be overridden when the page itself is on localhost
    Then with the page on "<host>" and the query "<query>", the results address should be "<address>"

    Examples:
      | host                                       | query                          | address                                                  |
      | photography-site.diego-narvaez.workers.dev | ?api=http://localhost:8788     | https://api.configured.test                              |
      | example.com                                | ?api=https://evil.example      | https://api.configured.test                              |
      | localhost                                  | ?api=http://localhost:8788     | http://localhost:8788                                    |
      | 127.0.0.1                                  | ?api=http://127.0.0.1:8788/x   | http://127.0.0.1:8788                                    |
      | localhost                                  | ?api=javascript:alert(1)       | https://api.configured.test                              |
      | localhost                                  | ?api=not a url                 | https://api.configured.test                              |
      | localhost                                  |                                | https://api.configured.test                              |

  Scenario Outline: Only links back to the results API are ever followed
    Then the link "<link>" should be <verdict> for the API "https://api.configured.test"

    Examples:
      | link                                                   | verdict  |
      | https://api.configured.test/files/run/offline.html?a=b | followed |
      | https://api.configured.test/index                      | ignored  |
      | https://evil.example/files/run/offline.html            | ignored  |
      | https://api.configured.test.evil.example/files/x       | ignored  |
      | http://api.configured.test/files/x                     | ignored  |
      | javascript:alert(1)                                    | ignored  |
      | /files/run/offline.html                                | ignored  |

  # --- Sorting a run's files ---------------------------------------------------------------------------------

  Scenario: A run's files are sorted into reports and failure evidence
    Given the links of a run with reports, smoke data and evidence for two failed scenarios
    Then the reports should be listed as: "offline.html, offline.json, browser.html, browser.json, smoke.json"
    And the failure evidence should be grouped per failed scenario as: "browser/a-fails (screenshot, trace, log), browser/b-fails (screenshot)"
    And no file link should be lost or listed twice

  # --- What is built ------------------------------------------------------------------------------------------

  Scenario Outline: The built Admin pages hold the viewer, pointed at the configured API, in the page's language
    Then the built page "<page>" should hold the results viewer for the configured API with "<locale>" messages

    Examples:
      | page              | locale |
      | /admin/index.html | en     |
      | /es/admin/index.html | es  |

  Scenario Outline: The built Admin pages never contain a token or a way to guess one
    Then the built page "<page>" and its scripts should contain no admin token, no bucket credentials and no bucket address

    Examples:
      | page                 |
      | /admin/index.html    |
      | /es/admin/index.html |

  Scenario: Only the tab's own container is handed to the viewer, and the tab still shows without JavaScript
    Then the built page "/admin/index.html" should tell visitors without JavaScript that the viewer needs it

  Scenario Outline: The built Admin pages hold Refresh and Sign out in the header, across from the title, hidden until a sign-in
    Then the built page "<page>" should have "<refresh>" and "<sign out>" buttons in the header beside its title, hidden until script shows them, and none inside the tabs

    Examples:
      | page                 | refresh    | sign out      |
      | /admin/index.html    | Refresh    | Sign out      |
      | /es/admin/index.html | Actualizar | Cerrar sesión |

  Scenario: Only the top buttons can refresh or sign out
    Then no viewer should build a Refresh or Sign out button of its own, and the top buttons should only ask the viewers to reload or forget the token

  Scenario: The viewer only ever puts text on the page
    Then the viewer's code should never use innerHTML, outerHTML, insertAdjacentHTML, document.write, eval or new Function

  Scenario: The viewer remembers the token only for the browser tab and never sends it anywhere but the results API
    Then the viewer's code should keep the token in sessionStorage only and send it only in the Authorization header to the results API

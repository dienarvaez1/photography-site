Feature: The results API serves the private test-results bucket safely
  As the site owner
  I want the Admin page to read test results from the private bucket through a small, locked-down API
  So that the results stay private, nothing can be written, and only someone with the admin token can see them

  The API is a Cloudflare Worker (workers/results-api). These scenarios call its real request handler with runs
  published by the real results publisher into a fake bucket, so the stored format and the API agree.

  Background:
    Given a results API with the admin token "correct-admin-token-123" and these published runs:
      | time                 | commit  | offline results               | browser results | smoke | artifacts       |
      | 2026-09-19T10:00:00Z | aaaaaaa | 3 passed                      |                 |       |                 |
      | 2026-09-20T10:00:00Z | bbbbbbb | 2 passed, 1 failed            |                 |       |                 |
      | 2026-09-21T10:00:00Z | ccccccc | 3 passed                      | 2 passed        | yes   | checkout-fails  |

  # --- Health ------------------------------------------------------------------------------------------------

  Scenario: The health check is public and says whether the token is set
    When I call "/health" with no token
    Then the response should be 200 and say configured "yes"

  Scenario Outline: A token that is missing or too short means the API is not configured
    Given the admin token is <token>
    When I call "/health" with no token
    Then the response should be 200 and say configured "no"

    Examples:
      | token        |
      | not set      |
      | "too-short"  |

  # --- The two entry points -----------------------------------------------------------------------------------

  Scenario: index.json is served as the list of runs, newest first
    When I call "/index" with the admin token
    Then the response should be 200
    And the response should be exactly the stored index.json
    And the listed runs should be, newest first, the commits: "ccccccc, bbbbbbb, aaaaaaa"

  Scenario: latest.json is served as the newest run's summary
    When I call "/latest" with the admin token
    Then the response should be 200
    And the response should be exactly the stored latest.json
    And the summary should be for the commit "ccccccc"

  Scenario: An empty bucket gives an empty list and no latest run
    Given a bucket with no published runs
    When I call "/index" with the admin token
    Then the response should be 200 and list no runs
    When I call "/latest" with the admin token
    Then the response should be 404 with the error "not-found"

  # --- Authentication --------------------------------------------------------------------------------------------

  Scenario Outline: Every data endpoint needs the right token
    When I call "<path>" <token>
    Then the response should be <status> with the error "<error>"

    Examples:
      | path       | token                                | status | error         |
      | /index     | with no token                        | 401    | unauthorized  |
      | /latest    | with no token                        | 401    | unauthorized  |
      | /runs/RUN1 | with no token                        | 401    | unauthorized  |
      | /index     | with the token "wrong-token-value-1" | 401    | unauthorized  |
      | /index     | with the token ""                    | 401    | unauthorized  |
      | /index     | with a Basic authorization header    | 401    | unauthorized  |
      | /index     | with the token "correct-admin-token-12" | 401 | unauthorized  |
      | /index     | with the token "correct-admin-token-1234" | 401 | unauthorized |

  Scenario Outline: With no usable admin token set, every data endpoint refuses, even for a would-be correct token
    Given the admin token is <token>
    When I call "/index" with the token "correct-admin-token-123"
    Then the response should be 503 with the error "not-configured"

    Examples:
      | token       |
      | not set     |
      | "short"     |
      | ""          |

  Scenario Outline: With no usable admin token, even a link signed with that token opens nothing
    Given the admin token is <token>
    When I open a file link for "offline.json" of the newest run, signed with the token <signing token>
    Then the response should be 503 with the error "not-configured"

    Examples:
      | token       | signing token |
      | not set     | ""            |
      | "short"     | "short"       |

  # --- Runs and signed links -------------------------------------------------------------------------------------------

  Scenario: A run's summary comes with a signed link for every file it stored
    When I call the newest run with the admin token
    Then the response should be 200
    And the summary should be for the commit "ccccccc"
    And there should be a signed link for each of the run's stored files, all on the API's own address
    And the links should be valid for 900 seconds

  Scenario: Files whose stored names could escape the run's folder get no link
    Given the newest run's summary also lists these files: "../../index.json, sub/../../../index.json, a b.png, .hidden/x"
    When I call the newest run with the admin token
    Then the response should be 200
    And the links should not include any of those files
    And there should be a signed link for each of the run's ordinary files

  Scenario Outline: A signed link opens its file, with the right type and safe headers
    When I open the signed link for "<file>" of the newest run
    Then the response should be 200
    And its content type should be "<type>"
    And its content should be exactly what was stored
    And it should not be cached, and the browser must not guess its type
    And its extra protection should be "<protection>"

    Examples:
      | file                                | type                          | protection                                  |
      | offline.html                        | text/html; charset=utf-8      | a sandbox that allows scripts but no origin |
      | offline.json                        | application/json; charset=utf-8 | none                                      |
      | summary.json                        | application/json; charset=utf-8 | none                                      |
      | artifacts/browser/checkout-fails.png | image/png                    | none                                        |
      | artifacts/browser/checkout-fails.txt | text/plain; charset=utf-8    | none                                        |
      | artifacts/browser/checkout-fails.zip | application/zip              | a download, not shown in the browser        |

  Scenario Outline: A link that was changed, forged or has run out does not open anything
    When I open the signed link for "offline.html" of the newest run, <problem>
    Then the response should be <status> with the error "<error>"

    Examples:
      | problem                                   | status | error     |
      | but with its signature changed            | 403    | forbidden |
      | but with its signature removed            | 403    | forbidden |
      | but pointed at a different file           | 403    | forbidden |
      | but pointed at a different run            | 403    | forbidden |
      | but with its expiry moved a day later     | 403    | forbidden |
      | but opened after it expired               | 403    | expired   |

  Scenario: A link stops working when the admin token is changed
    When I remember the signed link for "offline.html" of the newest run
    And the admin token is changed to "a-brand-new-admin-token-456"
    And I open the remembered link
    Then the response should be 403 with the error "forbidden"

  Scenario: A valid link to a file that is not there is a plain 404
    When I open a correctly signed link for the file "no-such-file.json" of the newest run
    Then the response should be 404 with the error "not-found"

  Scenario: A run that does not exist is a 404, and a malformed run id is a 400
    When I call "/runs/2030-01-01T00-00-00Z-nothing-local" with the admin token
    Then the response should be 404 with the error "not-found"
    When I call "/runs/not-a-run-id" with the admin token
    Then the response should be 400 with the error "bad-request"

  # --- Reading only what it should ----------------------------------------------------------------------------------------

  Scenario Outline: Paths that try to escape the results folder never reach the bucket
    When I call the file route with the raw path "<path>" and no signature
    Then the response should be <status>
    And the bucket should not have been asked for anything

    Examples:
      | path                                                                        | status |
      | /files/2026-09-21T10-00-00Z-ccccccc-local/../../secrets.txt                 | 404    |
      | /files/2026-09-21T10-00-00Z-ccccccc-local/%2e%2e/index.json                 | 400    |
      | /files/2026-09-21T10-00-00Z-ccccccc-local/..%2f..%2fsecrets.txt             | 400    |
      | /files/2026-09-21T10-00-00Z-ccccccc-local//offline.json                     | 403    |
      | /files/2026-09-21T10-00-00Z-ccccccc-local/offline.json%00.png               | 400    |
      | /files/2026-09-21T10-00-00Z-ccccccc-local/%E0%A4%A                          | 400    |
      | /files/..%2fphotos%2foriginal/offline.json                                  | 400    |
      | /files/photos/x                                                             | 400    |
      | /files/2026-09-21T10-00-00Z-ccccccc-local/artifacts%2f..%2f..%2findex.json  | 400    |

  Scenario: Nothing the API does ever reads outside results/
    When I call "/index" with the admin token
    And I call "/latest" with the admin token
    And I call the newest run with the admin token
    And I open the signed link for "offline.html" of the newest run
    Then the bucket should not have been asked for anything outside "results/"

  Scenario Outline: The API is read-only
    When I send a "<method>" request to "/index" with the admin token
    Then the response should be 405 with the error "method-not-allowed"

    Examples:
      | method |
      | POST   |
      | PUT    |
      | DELETE |
      | PATCH  |

  Scenario Outline: Unknown addresses are plain 404s
    When I call "<path>" with the admin token
    Then the response should be 404 with the error "not-found"

    Examples:
      | path             |
      | /                |
      | /admin           |
      | /index/extra     |
      | /latest/x        |
      | /results/index.json |
      | /favicon.ico     |

  # --- CORS: only the site's own pages may read it ---------------------------------------------------------------------------

  Scenario Outline: Only allowed origins can read responses from a browser
    When I call "/index" with the admin token, from the origin "<origin>"
    Then the response should be 200
    And the response should <allow> that origin to read it

    Examples:
      | origin                     | allow |
      | https://site.test          | allow |
      | http://localhost:4321      | allow |
      | https://evil.example       | not allow |
      | https://site.test.evil.example | not allow |
      | http://site.test           | not allow |

  Scenario: Errors are readable by an allowed page too, so it can tell a wrong token from an outage
    When I call "/index" with no token, from the origin "https://site.test"
    Then the response should be 401 with the error "unauthorized"
    And the response should allow that origin to read it

  Scenario Outline: The browser's preflight check is answered only for allowed origins
    When I send a preflight request for "/index" from the origin "<origin>"
    Then the response should be <status>
    And the preflight should <allow> the Authorization header

    Examples:
      | origin                | status | allow     |
      | https://site.test     | 204    | allow     |
      | https://evil.example  | 403    | not allow |

  # --- Nothing leaks ---------------------------------------------------------------------------------------------------------------

  Scenario: The admin token never appears in any response
    When I call "/health" with no token
    And I call "/index" with the admin token
    And I call "/latest" with the admin token
    And I call the newest run with the admin token
    And I call "/index" with the token "wrong-token-value-1"
    And I open the signed link for "offline.json" of the newest run
    Then no response body or header should contain the admin token

  Scenario: Every JSON answer is uncached and not sniffable
    When I call "/index" with the admin token
    And I call "/latest" with the admin token
    And I call the newest run with the admin token
    And I call "/index" with no token
    And I call "/nowhere" with the admin token
    Then every response should be uncached, not sniffable and no-referrer

  # --- The deployment files ------------------------------------------------------------------------------------------------------------

  Scenario: The Worker is configured for the right bucket, read-only and with matching origins
    Then the Worker's configuration should bind the bucket "photography-site-test" as RESULTS
    And the Worker's configuration should allow exactly the origins listed in the site configuration
    And the Worker's configuration should contain no secret value
    And the Worker's code should never write, delete or list anything in R2

  # --- The real Workers runtime ------------------------------------------------------------------------------------------------------

  Scenario: The same code behaves the same in the real Workers runtime, reading a real R2 bucket
    Given the same runs are stored in a local R2 bucket and the Worker runs in the real Workers runtime
    When I call "/health" with no token
    Then the response should be 200 and say configured "yes"
    When I call "/index" with no token
    Then the response should be 401 with the error "unauthorized"
    When I call "/index" with the admin token, from the origin "https://site.test"
    Then the response should be exactly the stored index.json
    And the response should allow that origin to read it
    When I call "/latest" with the admin token
    Then the response should be exactly the stored latest.json
    When I call the newest run with the admin token
    Then the summary should be for the commit "ccccccc"
    And there should be a signed link for each of the run's stored files, all on the API's own address
    When I open the signed link for "offline.html" of the newest run
    Then the response should be 200
    And its content should be exactly what was stored
    And its extra protection should be "a sandbox that allows scripts but no origin"
    When I open the signed link for "artifacts/browser/checkout-fails.png" of the newest run
    Then its content type should be "image/png"
    And its content should be exactly what was stored
    When I open the signed link for "artifacts/browser/checkout-fails.zip" of the newest run
    Then its extra protection should be "a download, not shown in the browser"
    When I open the signed link for "offline.html" of the newest run, but with its signature changed
    Then the response should be 403 with the error "forbidden"
    When I send a "POST" request to "/index" with the admin token
    Then the response should be 405 with the error "method-not-allowed"
    When I call "/runs/2030-01-01T00-00-00Z-nothing-local" with the admin token
    Then the response should be 404 with the error "not-found"

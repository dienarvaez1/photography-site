Feature: Remove Results talks to R2's API directly, with wrangler's login
  As the site owner
  I want removing recorded runs from the Admin page to take seconds, not minutes
  So that cleaning up old test and Lighthouse runs is not a chore

  Every `wrangler r2 object …` call starts a new wrangler process (about a second each), and a removal deletes a file
  per report. The Admin page's results service makes the same requests to Cloudflare's R2 API itself, with the login
  wrangler already has, asked for once. These scenarios use a stand-in for the API, so they need neither the network
  nor a login.

  Scenario: A delete is one request to the object's address in the bucket, with wrangler's token
    Given R2's API with the account "acc123" and the token "tok-1"
    When the API storage of "photography-site-test" deletes "results/runs/2026-09-23T09-00-00Z-ccccccc-local/offline.json"
    Then R2's API should have been asked "DELETE /accounts/acc123/r2/buckets/photography-site-test/objects/results/runs/2026-09-23T09-00-00Z-ccccccc-local/offline.json" with the token "tok-1"

  Scenario: The credentials are asked of wrangler once, however many requests follow
    Given R2's API with the account "acc123" and the token "tok-1"
    When the API storage of "photography-site-test" deletes 20 files at once
    Then R2's API should have been asked 20 times
    And wrangler should have been asked for the credentials 1 time

  Scenario: Pressing Remove Results gets the credentials ready before anything is deleted
    Given R2's API with the account "acc123" and the token "tok-1"
    When the Admin page asks the results service whether it is there
    Then wrangler should have been asked for the credentials 1 time
    And R2's API should have been asked 0 times

  Scenario: Reading an object returns its bytes; a missing one is null; deleting a missing one is fine
    Given R2's API with the account "acc123" and the token "tok-1", holding "results/index.json" as "{\"runs\":[]}"
    When the API storage of "photography-site-test" reads "results/index.json"
    Then it should get "{\"runs\":[]}"
    When the API storage of "photography-site-test" reads "results/nothing.json"
    Then it should get nothing
    When the API storage of "photography-site-test" deletes "results/nothing.json"
    Then it should not have failed

  Scenario: Writing an object sends its bytes with its content type and cache control
    Given R2's API with the account "acc123" and the token "tok-1"
    When the API storage of "photography-site-test" writes "results/index.json" as JSON with no caching
    Then R2's API should have been asked "PUT /accounts/acc123/r2/buckets/photography-site-test/objects/results/index.json" with the token "tok-1"
    And that request should have carried the file, "application/json" and "no-store"

  Scenario: An expired token is refreshed through wrangler once, and the request tried again
    Given R2's API with the account "acc123" and the token "tok-1"
    And R2's API refuses the token "tok-1", and wrangler's next token is "tok-2"
    When the API storage of "photography-site-test" deletes "results/runs/x/offline.json"
    Then it should not have failed
    And wrangler should have been asked for the credentials 2 times
    And R2's last request should have carried the token "tok-2"

  Scenario: A refusal other than "not there" is an error that names the object
    Given R2's API with the account "acc123" and the token "tok-1"
    And R2's API answers every request with 500
    When the API storage of "photography-site-test" deletes "results/runs/x/offline.json"
    Then it should have failed with "R2 delete photography-site-test/results/runs/x/offline.json failed: 500"

  Scenario: Without wrangler's credentials, every call goes through wrangler as before
    Given wrangler can't give the credentials: "Not logged in"
    When the API storage of "photography-site-test" deletes "results/runs/x/offline.json"
    Then it should not have failed
    And the wrangler storage should have deleted "results/runs/x/offline.json"
    And R2's API should have been asked 0 times

  Scenario: The dev server's results service uses the API storage for the results bucket
    Then the dev server's results service should use the API storage for "photography-site-test"

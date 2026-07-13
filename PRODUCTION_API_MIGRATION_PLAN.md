# Shinjuku DOOH Production API Migration Plan

## 1. Current verified state

As of 2026-07-14:

- The public Web app is deployed at
  `https://shinjukuweb.h1rqg1-makes-site.workers.dev`.
- Its public `app-config.js` contains an empty `apiBaseUrl`.
- The current Cloudflare Worker serves static assets only and intentionally does
  not proxy API requests.
- Local Web, FastAPI, BLE, and Unity compatibility is covered by
  `scripts/test-server-integration.py`.
- No confirmed production HTTPS API Base URL exists yet.

Therefore, production Web-to-API connectivity, production CORS, and the Unity
Production `baseUrl` cannot yet be verified or claimed as complete.

## 2. Migration boundary

The production API must be deployed as a separate service from the existing
static Web Worker. Do not add an unsafe forwarding proxy to the Web Worker and
do not point the Web build at its own static origin.

Two valid implementation paths are:

1. Deploy the existing FastAPI application to an HTTPS-capable ASGI hosting
   environment with persistent storage. This has the smallest contract risk.
2. Reimplement the API in a separate Cloudflare Worker with an explicit durable
   storage design. This is a separate migration project and must run the same
   contract tests before rollout.

Do not choose or deploy either path until the deployment target and persistent
storage are confirmed.

## 3. Required API contract

The production service must preserve these endpoints and field names:

- `GET /`
- `GET /health`
- `POST /encounter`
- `GET /encounters`
- `GET /stats`
- `DELETE /encounters`
- `POST /sync`
- `POST /avatar`
- `POST /user-messages`
- `GET /message-options`
- `GET /profiles/recent`

Important compatibility requirements:

- `POST /encounter` accepts nullable or omitted `target_id`, `device_name`,
  `device_address`, `rssi`, and `timestamp` values.
- `GET /encounters` returns `{ "encounters": [...] }` for Unity.
- `GET /stats` preserves `date_jst`, `time_jst`, `daily_detected_count`, and
  `daily_encounter_count` with their existing types.
- `POST /sync` accepts optional `sync_id` idempotency without requiring it from
  older clients.
- Web-only interests do not appear in Unity-facing encounter objects.
- Timestamps remain ISO 8601 values and statistics are calculated in JST.

## 4. Persistent storage requirements

Production must not depend on an instance-local temporary filesystem.

The selected storage must support:

- atomic or transactional profile and encounter updates;
- idempotency records for recent `sync_id` values;
- concurrent requests without lost updates;
- backup and restore procedures;
- retention or cleanup rules for encounters and idempotency records.

The repository's JSON storage is suitable for the current single-process local
bridge only. It is not a production multi-instance database design.

## 5. HTTPS, CORS, and cache requirements

- The API Base URL must use HTTPS.
- Browser CORS must explicitly allow
  `https://shinjukuweb.h1rqg1-makes-site.workers.dev`.
- The current Web client sends no cookies (`credentials: omit`), so production
  should not require credentialed wildcard CORS.
- `OPTIONS` preflight for JSON `POST` requests must succeed.
- Dynamic responses such as `/encounters`, `/stats`, and `/profiles/recent`
  must not be cached as stale static content.
- Logs may include method, URL, and HTTP status, but not secrets or full personal
  profile payloads.

## 6. Rollout sequence

1. Confirm the production API hosting and persistent storage.
2. Deploy the API to a staging HTTPS URL.
3. Run the repository contract and integration tests against the staging API.
4. Verify CORS from the production Web origin.
5. Confirm the final Base URL without `/encounters` or another endpoint suffix.
6. Set the Cloudflare GitHub build variable:

   `DOOH_API_BASE_URL=https://<confirmed-api-host>`

7. Trigger a new Web build and verify public `app-config.js` contains that exact
   Base URL and no local URL.
8. Share the same Base URL with the Unity owner for:

   `Assets/Settings/DOOHServerConfig_Production.asset`

9. Configure the BLE scanner to use the same API Base URL when production BLE
   posting is required.
10. Run an end-to-end staging event: Web `/sync` -> API `/encounters` -> Unity
    avatar display, plus BLE `/encounter` -> Unity display and `/stats` update.

## 7. Acceptance gates

Production rollout is complete only when all of the following are recorded:

- confirmed Production API Base URL;
- `GET /health`, `/encounters`, and `/stats` return HTTP 200 over HTTPS;
- Web-origin CORS preflight succeeds;
- a Web profile sync appears once in Unity with the selected costume/messages;
- a simulated lost-response retry does not append a duplicate encounter;
- BLE nullable fields remain accepted and device-based counts remain correct;
- public `app-config.js` contains the production URL and no loopback URL;
- API failure produces a finite timeout and retryable Web state;
- Unity Production configuration uses the Base URL without a duplicated path;
- rollback steps and a recent storage backup are available.

## 8. Rollback

If production validation fails:

1. Remove or clear `DOOH_API_BASE_URL` from the Web build environment and
   redeploy the static Web app so it returns to local-only fallback behavior.
2. Restore the previous Unity Production configuration asset.
3. Stop production writes before restoring API storage.
4. Keep the failed deployment logs and contract-test output, without personal
   payloads, for diagnosis.

## 9. Information required to unblock rollout

One of the following is required before implementation can continue:

- a confirmed existing production API Base URL; or
- a confirmed API hosting target and persistent storage choice, with deployment
  access configured outside Git.

No placeholder URL, token, private environment file, or guessed Cloudflare
service address should be committed to this repository.

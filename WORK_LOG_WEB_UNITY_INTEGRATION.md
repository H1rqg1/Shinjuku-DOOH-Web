# Shinjuku DOOH Web / Unity Integration Memo

## 2026-07-08

- Current folder was not a Git repository at the start of this work.
- Existing web UI already had a shared `api.js`, but it only posted avatar and
  message data to a hard-coded FastAPI address.
- Unity side polls `GET /encounters` and `GET /stats` from
  `http://127.0.0.1:8000`.
- Unity avatar costume reflection uses `Encounter.costume_id`.
- Unity catalog IDs found:
  - `costume_fashion01`
  - `costume_fashion02`
  - `costume_fashion03`
- Web outfit IDs map to Unity costume IDs as follows:
  - outfit `1` -> `costume_fashion01`
  - outfit `2` -> `costume_fashion02`
  - outfit `3` -> `costume_fashion03`
- Communication-focused change:
  - Replaced the web API client with a unified `/sync` call.
  - Added a Web-side FastAPI bridge under `server/`.
  - Added Unity-compatible endpoints: `/encounters`, `/stats`, and
    compatibility `POST /encounter`.
  - Kept `POST /avatar`, `POST /user-messages`, and `GET /message-options` for
    existing web flow compatibility.
- UI files (`home.html`, `profile.html`, `avatar.html`, `complete.html`,
  `style.css`) were not edited.
- Verification:
  - `node --check api.js` passed with the bundled Node runtime.
  - `python -m py_compile server/app.py` passed.
  - Short-lived Uvicorn HTTP test passed on port `8765`:
    `/sync` -> `/encounters` -> `/stats` -> `/message-options`.

## 2026-07-08 Completion Audit

- Confirmed local `main` and `origin/main` pointed to commit `165bdb3`.
- Rechecked communication syntax:
  - `node --check api.js`
  - `python -m py_compile server/app.py`
  - Extracted and parsed inline scripts in `home.html` and `complete.html`.
- Ran a short-lived Uvicorn HTTP audit on port `8770`.
- Verified static app delivery:
  - `GET /home.html` returned HTTP `200`.
- Verified Web-to-Unity bridge flow:
  - `DELETE /encounters` reset the Unity queue.
  - `POST /sync` accepted web payload:
    `user_id=audit_user`, `display_name=Audit User`,
    `avatar_code=00020103`, message IDs `talk_hello,status_break`.
  - `GET /encounters` returned one Unity-compatible encounter with:
    `my_id=audit_user`, `target_id=Audit User`,
    `costume_id=costume_fashion02`, `avatar_code=00020103`,
    and the selected message IDs.
  - `GET /stats` returned `daily_detected_count=1` and
    `daily_encounter_count=1`.
- Verified compatibility endpoints:
  - `GET /message-options` returned 8 message options.
  - `POST /avatar` mapped `avatar_code=00030100` to
    `costume_fashion03`.
  - `POST /user-messages` saved selected message IDs.

## 2026-07-08 Cloudflare Pages Static Deployment Fix

- Added `index.html` so Cloudflare Pages has a static entry point.
- Changed `api.js` API base URL resolution so HTTP/HTTPS hosting no longer
  defaults to `window.location.origin`.
- API base URL priority is now:
  - `?apiBaseUrl=...` query parameter, saved to localStorage.
  - `localStorage.dooh_api_base_url`.
  - `http://127.0.0.1:8000`.
- This prevents a Cloudflare Pages deployment from sending `/sync`,
  `/message-options`, `/encounters`, or `/stats` requests to the Pages domain.
- Static deployment verification:
  - `node --check api.js` passed.
  - Inline scripts in `index.html`, `home.html`, and `complete.html` parsed.
  - Local static HTTP server returned `200` for:
    `index.html`, `home.html`, `style.css`, `api.js`, `script.js`,
    `avatar.js`, and all tracked images under `image/`.
  - API base URL simulation for `https://example.pages.dev/home.html`
    returned `http://127.0.0.1:8000`, not the Pages origin.

## 2026-07-08 Cloudflare Workers Build Fix

- The Cloudflare dashboard URL points to `workers/services/view/.../builds`,
  which indicates the Git integration is running as a Workers build rather
  than a Pages build.
- Added `wrangler.toml` for Workers Static Assets:
  - Worker name: `shinjuku0dooh0web`
  - Assets directory: `public`
  - Assets binding: `ASSETS`
  - Compatibility date: `2026-07-08`
- Added `src/worker.js` to serve static assets and return `404` for internal
  files such as `server/`, `README.md`, work logs, and deployment metadata.
- Added `package.json` with `build` and `deploy` scripts so Cloudflare's build
  environment has an explicit deployment path.
- Added `scripts/build-static.js` to copy only the required static web assets
  into `public/`, avoiding accidental deployment of `node_modules` or backend
  source files.
- Updated `wrangler.toml` to use `public/` as the assets directory after
  noticing that deploying the repository root would risk including build
  dependencies.
- Local verification:
  - `node --check api.js`
  - `node --check src/worker.js`
  - `node --check scripts/build-static.js`
  - `tomllib` parsed `wrangler.toml`.
  - `json.load` parsed `package.json`.
  - `node scripts/build-static.js` generated `public/`.
  - A local static HTTP server from `public/` returned `200` for `index.html`,
    `home.html`, `style.css`, `api.js`, `script.js`, `avatar.js`, and all
    tracked image assets.
- Local Wrangler dry-run was not completed because this Codex environment lacks
  npm and the pnpm install path stopped on build-script approval; the repository
  now avoids committing pnpm lock/workspace files so Cloudflare can install with
  npm from `package.json`.

## 2026-07-10 First-run Profile and API Stability Fix

- Reported issue:
  - Opening the public URL should start from profile setup.
  - Selecting messages could still show a "missing data" warning.
- Root cause:
  - `script.js` calls `syncToServer()` immediately when `editMode` is set.
  - `syncToServer()` required both `profile` and `avatar`.
  - If a user saved profile data before creating avatar data, selected messages
    existed but `avatar` was missing, so the generic missing-data warning was
    returned.
- Fix:
  - Added `app-config.js` as the shared API address configuration source.
  - Updated `api.js` to use the shared config and keep the existing
    `?apiBaseUrl=...` / localStorage override behavior.
  - Updated `syncToServer()` to create a default avatar when profile data exists
    but avatar data does not.
  - Updated `index.html` to show `IPUT×DOOH project`, then route to
    `profile.html`.
  - Added intro title styles to `style.css`.
  - Added `app-config.js` to the static build output list.

## 2026-07-10 Saved Account Login

- Added same-device saved account login using existing `localStorage` data:
  `user_id`, `profile`, and `avatar`.
- This keeps the same account on the same browser/device. Cross-device account
  recovery would require a shared backend or external authentication later.
- Added `account.js` to centralize saved account checks and routing.
- Added `login.html` so returning users can continue with the same account,
  edit the profile, or intentionally start a new account.
- Updated `index.html` intro routing:
  - First visit without profile data -> `profile.html`
  - Returning visit with saved profile and user ID -> `login.html`
- Added a guard in `home.html` so direct access without profile data returns to
  profile setup.
- Added login screen styling and included `login.html` / `account.js` in the
  static build output.
- Verification:
  - `node --check account.js`, `app-config.js`, `api.js`, and
    `scripts/build-static.js`.
  - Parsed inline scripts in `index.html`, `login.html`, `home.html`,
    `profile.html`, `avatar.html`, and `complete.html`.
  - VM routing check:
    first visit -> `profile.html`, returning saved account -> `login.html`.
  - `node scripts/build-static.js` generated `public/login.html` and
    `public/account.js`.
  - Local static server from `public/` returned `200` for login/account assets.

## 2026-07-10 Home Live Info and Profile Exchange

- Added a compact home-header panel for Tokyo time and Tokyo temperature.
  - Time is calculated in the browser with the `Asia/Tokyo` timezone.
  - Temperature is fetched from Open-Meteo by latitude/longitude for Tokyo.
- Added profile interests to the profile setup flow.
  - Interests are saved in `localStorage.profile` as `interests` and
    `interestIds`.
  - They are sent to the FastAPI bridge only for Web profile exchange storage.
- Kept Unity/DOOH payload separation:
  - `POST /sync` accepts `interests` and `interest_ids`.
  - `GET /encounters` still returns only Unity-facing data such as
    `costume_id`, `avatar_code`, `display_name`, and `message_ids`.
  - Interests are exposed through the new Web-facing `GET /profiles/recent`
    endpoint instead.
- Added a home "すれ違った人" profile exchange panel.
  - It reads recent profiles from `GET /profiles/recent`.
  - If the bridge is unavailable, it falls back to showing the current local
    profile so the UI does not look broken during static-only use.
- Added `home.js` and included it in the static build output.
- Verification:
  - `node --check` passed for `api.js`, `script.js`, `home.js`, and
    `scripts/build-static.js`.
  - `python -m py_compile server/app.py` passed.
  - Inline scripts in `home.html` and `profile.html` parsed.
  - `node scripts/build-static.js` copied 14 static entries, including
    `home.js`, into `public/`.
  - Local static HTTP serving from `public/` returned `200` for core HTML, CSS,
    and JS files.
  - Short-lived FastAPI check confirmed `GET /profiles/recent` returns
    interests while the latest Unity-facing `/encounters` item does not include
    `interests` or `interest_ids`.

## 2026-07-10 Calm Intro Animation

- Adjusted the `IPUT×DOOH project` intro title animation to feel calmer.
  - Removed the scale-in motion.
  - Changed the title to a slower fade with a small vertical movement.
  - Added a quiet delayed fade-in for the `Start` link.
- Replaced the high-contrast intro background with a quieter light background
  and dark title text.

## 2026-07-10 Intro Exit and Login Avatar Fix

- Updated the intro to better match the requested calm/stylish reference:
  - Dark, quiet background.
  - The intro title fades in calmly.
  - Before routing to the next screen, the intro logo area moves upward and
    fades out.
- Adjusted the saved-account login avatar preview so the top of the head is not
  clipped.

## 2026-07-13 Web API Separation and Cloud Migration Preparation

- Reviewed the full API separation instruction document before changing code.
- Confirmed the project is plain HTML/CSS/JavaScript, built into `public/` and
  deployed as Cloudflare Workers Static Assets.
- Confirmed the worktree was clean on `main` before the task.
- Added `api-client.js` to centralize:
  - API Base URL resolution and endpoint URL generation.
  - Removal of accidental `/encounters`, `/stats`, and other known endpoint
    suffixes from a configured Base URL.
  - HTTP requests, an 8-second default timeout, no-store caching, HTTP status
    handling, JSON parsing, and normalized errors.
- Kept `api.js` as the Web-domain layer for profile synchronization and API
  response compatibility.
  - `GET /encounters` accepts both `{ "encounters": [...] }` and direct arrays.
  - `target_id: null`, empty arrays, and extra response fields remain valid.
  - Missing `encounters` and invalid `/stats` fields are explicit errors.
- Added build-time `DOOH_API_BASE_URL` and optional `DOOH_API_TIMEOUT_MS`.
  - Local pages use `http://127.0.0.1:8000`.
  - Public builds do not fall back to a local API when the production URL is
    unconfigured.
  - Non-local production API URLs must use HTTPS.
- Added `.env.example` and ignored personal `.env` variants.
- Added a retry-safe recent-profile error state while preserving the existing
  profile exchange layout and local profile fallback.
- Did not change Unity, BLE scanner code, FastAPI endpoints, database structure,
  authentication, page design, copy, animation, images, or fonts.
- Production API Base URL remains unconfirmed and must be provided later to both
  the Cloudflare build and Unity production configuration.
- CORS/HTTPS audit:
  - The browser API client sends no credentials and requests dynamic data with
    `cache: no-store`.
  - The existing FastAPI wildcard CORS plus credential setting was documented
    for API-side review and was not changed in this Web separation task.
  - Production connectivity could not be claimed because no confirmed HTTPS API
    URL exists yet.
- Verification:
  - JavaScript syntax checks and `git diff --check` passed.
  - API client tests covered URL normalization, `/encounters` object/direct-array
    compatibility, null values, extra fields, malformed responses, HTTP errors,
    network errors, and timeouts.
  - Builds passed with an empty production setting and an HTTPS production-like
    setting; neither generated a local API URL in `public/app-config.js`.
  - A short-lived FastAPI run returned the existing `/encounters` and `/stats`
    response shapes and served `home.html` plus `api-client.js` with HTTP 200.
  - Browser checks confirmed API-backed message options, three-message selection
    and avatar navigation, API-unconfigured fallback behavior, and no horizontal
    overflow at 390 px or 1440 px widths.

## 2026-07-13 Coordinate Asset Replacement

- Replaced the three tracked coordinate images with the supplied
  `coordinate_01.png`, `coordinate_02.png`, and `coordinate_03.png` assets while
  preserving the existing `outfit1.png` through `outfit3.png` public paths.
  The PNGs were re-encoded with every RGBA pixel preserved to avoid a browser
  compositor issue found in the source encoding.
- Removed the tracked hat image and removed all hat/accessory choices from the
  avatar page, avatar data, saved avatar state, and Web preview rendering.
- Replaced the remaining home-menu and avatar-chat hat/accessory wording with
  coordinate-only wording so the visible experience matches the available data.
- Removed stale non-existent choices for outfit 4, hats 2/3, and accessories.
- Avatar selection now contains exactly three coordinates with IDs 1 through 3,
  preserving the existing Unity costume mapping to `costume_fashion01` through
  `costume_fashion03`.
- Existing saved avatar data is normalized by outfit ID. Old hat/accessory fields
  are discarded, and an unavailable outfit falls back to coordinate 1.
- Unity avatar codes remain 8 digits, with the unused hat/accessory sections set
  to `0000`.
- Browser verification initially exposed a black compositor artifact for
  coordinate 3. Pixel-identical PNG re-encoding resolved it without cropping or
  changing any supplied clothing artwork.
- Added `scripts/test-avatar.js` to cover the three allowed outfit IDs, legacy
  saved-data cleanup, missing-outfit fallback, removed UI labels/references, and
  the final image file set. It also locks the existing 8-digit avatar code and
  `costume_fashion01` through `costume_fashion03` Unity mappings.

## 2026-07-13 Empty Hat and Accessory Slots

- Restored the hat and accessory selection buttons after clarifying that only
  their image assets, not their selection UI, should be removed.
- Added three selectable placeholder slots to each category. Every placeholder
  is labeled `なし` and has no image path, so no removed asset can be requested.
- Restored hat/accessory state persistence and preview-layer hooks so real items
  can be added later without rebuilding the selection flow.
- Kept the Unity-facing avatar code unchanged: Web sync still sends `0000` for
  the unused hat/accessory sections, regardless of the selected placeholder.
- Updated avatar regression coverage for the six empty slots, saved-state
  normalization, absent asset directories, and the Unity zero-value invariant.

## 2026-07-13 FastAPI Unity/BLE Compatibility Audit

- Compared the Web bridge with the Unity-side FastAPI and Unity `Encounter`
  model without changing the Unity or BLE scanner repositories.
- Found that the Web bridge accepted but discarded existing BLE scanner fields:
  `device_name`, `device_address`, and `rssi`.
- Added those optional fields to the compatible `POST /encounter` payload and
  preserved their values in `GET /encounters` output.
- Matched existing target-ID normalization for empty, `None`, and `null` values.
- Matched existing stats identity behavior so unnamed BLE devices are counted by
  `device_address` instead of collapsing every detection into `my_id=dooh_pc`.
- Restored the existing JSON status response for `GET /`; the local Web UI
  remains available at `/home.html` and the other explicit static paths.
- Added the existing `count` response field to `POST /encounter` while retaining
  the bridge-specific `encounter_count` field for backward compatibility.
- Added `scripts/test-server-integration.py`, which starts Uvicorn with temporary
  storage and verifies root/static responses, CORS preflight, two BLE posts,
  null normalization, stats counts, Web `/sync`, Unity `/encounters`, Web profile
  exchange separation, and queue reset through real HTTP requests.
- Production API Base URL remains unconfirmed. No guessed URL was added to the
  Cloudflare build or shared with the Unity production configuration.

## 2026-07-13 Web API Timeout and Duplicate-Sync Hardening

- Rechecked the Unity polling implementation and confirmed that it de-duplicates
  encounters by `my_id`, `target_id`, and `timestamp` without requiring a Web or
  Unity contract change.
- Found that the browser request timeout was cleared immediately after response
  headers arrived. A stalled response body could therefore leave a page waiting
  indefinitely even though a timeout was configured.
- Kept the abort timer active through response-body reading and JSON validation.
  Body-read aborts now produce the same normalized `TIMEOUT` result as connection
  timeouts, and non-positive timeout settings are rejected explicitly.
- HTTP 4xx/5xx responses with non-JSON gateway/error pages now remain
  `HTTP_ERROR` results with URL and status instead of being misclassified as
  successful-response JSON errors.
- Added a shared in-flight promise around Web `POST /sync`. Repeated save actions
  on the same page now share one request; after it settles, a later intentional
  save can start normally.
- Extended `scripts/test-api-client.js` with response-body timeout, invalid
  timeout, HTML 502 response, concurrent-sync coalescing, and post-completion
  sync-reset coverage.

## 2026-07-13 Retry Idempotency and Atomic State Writes

- Closed the remaining duplicate-publication case where FastAPI saved a Web
  profile but its HTTP response was lost before the browser received it.
- Web sync now stores a pending `sync_id` with a fingerprint of the outgoing
  payload. A retry of unchanged data reuses that ID; changed data receives a new
  ID. The pending record is removed only after an HTTP-success response.
- Added optional `sync_id` support to FastAPI without changing older Web, Unity,
  or BLE requests that do not send the field.
- FastAPI stores the first successful response for up to 1,000 recent sync IDs.
  Identical retries return that response without appending another Unity
  encounter; an ID reused with different data returns HTTP `409`.
- `DELETE /encounters` clears retry history with the queue, allowing an
  intentional reset followed by republishing the same profile.
- Server state now writes through a flushed temporary file and `os.replace`, so
  an interrupted write cannot leave a partially written primary JSON file.
- JS tests cover success cleanup, new IDs after success, response-loss retention,
  and same-ID retry. HTTP integration tests cover duplicate suppression,
  conflicting-payload rejection, retry-state persistence, reset cleanup,
  republishing after reset, legacy requests without `sync_id`, and temporary-file
  cleanup.

## 2026-07-14 Production Completion Audit

- Re-ran the API-separation completion audit against the current repository and
  public deployment rather than treating previous implementation notes as proof.
- Confirmed the worktree was clean on `main` at `e0d3fc4` before this audit.
- Confirmed the public Web `app-config.js` currently contains `apiBaseUrl: ""`.
  The public Web therefore does not have a production API target.
- Confirmed local URL references remain limited to local source configuration,
  documentation, and tests; production static builds do not silently select a
  loopback or Web-origin API.
- Confirmed the Web Worker remains a static-asset service and does not contain an
  unsafe API forwarding proxy.
- Completed locally: Base URL separation, URL normalization, response
  compatibility, timeout/error handling, duplicate suppression, retry
  idempotency, BLE compatibility, Unity encounter output, atomic local storage,
  documentation, automated tests, builds, commits, and pushes.
- Not yet verifiable: production HTTPS API connectivity, production Web-origin
  CORS, durable cloud storage, end-to-end Web -> cloud API -> Unity behavior, and
  the Production API Base URL shared with Unity.
- Added `PRODUCTION_API_MIGRATION_PLAN.md` with the required contract, deployment
  boundary, storage requirements, CORS/cache rules, rollout sequence, acceptance
  gates, rollback, and exact information needed to unblock implementation.
- No placeholder URL or guessed Cloudflare API service was configured.
- Re-ran `scripts/test-api-client.js`, `scripts/test-avatar.js`, and
  `scripts/test-server-integration.py`; all passed. JavaScript syntax checks and
  both configured and unconfigured static builds also passed.
- Committed and pushed the migration audit as `8b51233` on `main`; confirmed the
  GitHub remote points to the same commit.
- Confirmed the public root returns HTTP 200, public `app-config.js` still has an
  empty `apiBaseUrl`, and `PRODUCTION_API_MIGRATION_PLAN.md` returns HTTP 404 as
  intended because internal documentation is not part of the static build.
- The Cloudflare Deployments dashboard redirected to its sign-in page in the
  available browser session, so the dashboard build-status badge could not be
  inspected. Public delivery was verified independently over HTTPS.

## 2026-07-15 Administrator Mode

- Added a fixed administrator username trigger without placing the administrator
  password in tracked source or generated static assets.
- Stored the requested local password only in the ignored root `.env`; production
  still requires the same `DOOH_ADMIN_PASSWORD` in the API host's secret settings.
- Added server-side administrator login with one-hour signed bearer tokens and a
  temporary lock after repeated failed attempts.
- Added authenticated profile listing, aggregate page-view metrics, forced
  logout, and irreversible account deletion endpoints.
- Added browser heartbeat revisions so forced logout is applied within 30 seconds.
  Deleted IDs are tombstoned, preventing delayed `/sync` retries from restoring
  removed profiles.
- Added aggregate-only page view recording. Analytics stores path counts but not
  visitor IDs.
- Added `admin-login.html` and `admin.html` while leaving the existing user-facing
  screens and avatar selectors visually unchanged.
- Added age to the Web-only profile record shown to administrators; Unity-facing
  encounter fields remain unchanged.
- Expanded FastAPI integration tests for authentication, authorization, metrics,
  profile listing, forced logout, deletion, and deleted-account replay rejection.
- Added browser-side tests for token handling, authorization headers, admin path
  encoding, view recording, heartbeat, and forced local logout.
- API client, avatar, administrator client, and FastAPI integration tests passed.
- Static build passed and contained the new administrator assets without the
  requested password or token secret.
- In-app browser navigation to the local verification URL was blocked by browser
  policy, so visual DOM inspection could not be completed in that browser.
- The public Cloudflare Web still has an empty production `apiBaseUrl`; therefore
  administrator operations remain unavailable there until the production API is
  deployed and configured.
- Committed and pushed the administrator implementation as `28f1e21` on `main`.
- Cloudflare initially returned HTTP 404 for the new `admin.js`, then returned
  HTTP 200 after approximately 60 seconds, confirming the GitHub-triggered static
  deployment completed.
- Confirmed the deployed root, existing user pages, administrator pages,
  JavaScript/CSS, and all three outfit images resolve to HTTP 200 after redirects.
- Re-scanned deployed administrator assets using the ignored local password and
  confirmed the password is not present publicly.

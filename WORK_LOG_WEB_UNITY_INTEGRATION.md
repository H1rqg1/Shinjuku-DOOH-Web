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

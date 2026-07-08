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

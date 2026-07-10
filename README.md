# Shinjuku-DOOH-Web

Web application and FastAPI bridge for the Shinjuku DOOH Unity project.

## Run the bridge

```powershell
python -m pip install -r server\requirements.txt
python -m uvicorn server.app:app --host 127.0.0.1 --port 8000 --reload
```

Open:

```text
http://127.0.0.1:8000/home.html
```

Unity should poll:

```text
http://127.0.0.1:8000/encounters
http://127.0.0.1:8000/stats
```

## Cloudflare Pages

Cloudflare Pages can deploy this repository as a static site without a build
command. The static entry point is `index.html`, which redirects to
`home.html`.

If the project is connected as a Cloudflare Workers service, use the included
`wrangler.toml`. It deploys the repository as Workers Static Assets and serves
the generated `public/` directory.

Cloudflare Workers build settings:

```text
Build command: npm run build
Deploy command: npm run deploy
```

`api.js` does not use the Cloudflare Pages origin as the API base URL. By
default it sends API requests to:

```text
http://127.0.0.1:8000
```

To point the static app at another bridge server, open the app once with:

```text
https://<pages-domain>/?apiBaseUrl=http://<server-host>:8000
```

The value is saved in `localStorage` as `dooh_api_base_url`.

Opening the root URL shows the `IPUT×DOOH project` intro and then moves to
`profile.html`.

After a profile is saved, the same browser keeps the account in localStorage.
Opening the root URL again moves to `login.html`, where the user can continue
with the saved account.

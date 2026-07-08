# Shinjuku DOOH Web Bridge

This FastAPI server is the communication bridge between the web app and the
Unity DOOH project.

## Run

```powershell
cd "D:\chiki_kyoso\groupwork-prototype - コピー"
python -m pip install -r server\requirements.txt
python -m uvicorn server.app:app --host 127.0.0.1 --port 8000 --reload
```

Open the web app through the server:

```text
http://127.0.0.1:8000/home.html
```

Unity should keep using:

```text
http://127.0.0.1:8000
```

## Endpoints

- `POST /sync`: saves web profile/avatar data and publishes a Unity encounter.
- `POST /avatar`: saves avatar data only.
- `POST /user-messages`: saves selected message IDs only.
- `GET /message-options`: returns selectable messages for the web app.
- `GET /encounters`: returns `{ "encounters": [...] }` for Unity polling.
- `GET /stats`: returns today's count and JST time for Unity UI.
- `POST /encounter`: keeps compatibility with the Unity-side test endpoint.
- `DELETE /encounters`: clears published Unity encounters.

## Unity payload

`POST /sync` converts the web payload into the format Unity already reads:

```json
{
  "my_id": "user id from localStorage",
  "target_id": "display name or user id",
  "timestamp": "server JST ISO timestamp",
  "costume_id": "costume_fashion01",
  "message_ids": ["talk_hello"],
  "avatar_code": "00010100",
  "display_name": "nickname"
}
```

`avatar_code` outfit IDs `1`, `2`, and `3` map to Unity catalog IDs
`costume_fashion01`, `costume_fashion02`, and `costume_fashion03`.

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

- `GET /`: returns the existing DOOH Encounter Server status and endpoint map.
- `POST /sync`: saves web profile/avatar data and publishes a Unity encounter.
  An optional `sync_id` makes retries idempotent without affecting older clients.
- `POST /avatar`: saves avatar data only.
- `POST /user-messages`: saves selected message IDs only.
- `GET /message-options`: returns selectable messages for the web app.
- `GET /encounters`: returns `{ "encounters": [...] }` for Unity polling.
- `GET /stats`: returns today's count and JST time for Unity UI.
- `POST /encounter`: keeps the existing Unity/BLE scanner contract, including
  optional `device_name`, `device_address`, `rssi`, and `timestamp` fields.
- `DELETE /encounters`: clears published Unity encounters.

When a `sync_id` is repeated with the same payload, the server returns the saved
response without appending another encounter. Reusing that ID with different
data returns HTTP `409`. `DELETE /encounters` also clears these internal retry
records so a profile can be published again after an intentional queue reset.

`POST /encounter` normalizes `None`/`null` target IDs in the same way as the
Unity-side FastAPI server. Anonymous detections remain distinguishable by
`device_address` when `GET /stats` calculates the detected-device count.

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

## Integration test

After installing `server/requirements.txt`, run:

```powershell
python scripts/test-server-integration.py
```

The test starts Uvicorn on an available local port and uses a temporary data
directory. It does not read, reset, or overwrite `server/data/`.

Runtime state is written to a temporary file, flushed, and atomically replaced.
An interrupted write therefore leaves the last complete state file available.

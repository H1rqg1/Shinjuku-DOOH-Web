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

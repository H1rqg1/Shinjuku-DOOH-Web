from __future__ import annotations

from contextlib import contextmanager
from http.client import HTTPConnection
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from time import monotonic, sleep
from typing import Any, Dict, Iterator, Optional, Tuple
import json
import os
import socket
import sys

import uvicorn


ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import server.app as app_module


Response = Tuple[int, Dict[str, str], Any]


def find_available_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


@contextmanager
def running_server() -> Iterator[int]:
    with TemporaryDirectory(prefix="dooh-server-test-") as temp_dir:
        app_module.DATA_DIR = Path(temp_dir)
        app_module.DATA_PATH = app_module.DATA_DIR / "dooh_state.json"

        port = find_available_port()
        config = uvicorn.Config(
            app_module.app,
            host="127.0.0.1",
            port=port,
            log_level="error",
            access_log=False,
        )
        server = uvicorn.Server(config)
        thread = Thread(target=server.run, daemon=True)
        thread.start()

        deadline = monotonic() + 10
        while not server.started and thread.is_alive() and monotonic() < deadline:
            sleep(0.02)

        if not server.started:
            server.should_exit = True
            thread.join(timeout=2)
            raise RuntimeError("Test server did not start.")

        try:
            yield port
        finally:
            server.should_exit = True
            thread.join(timeout=5)
            if thread.is_alive():
                server.force_exit = True
                thread.join(timeout=2)


def request_json(
    port: int,
    method: str,
    path: str,
    payload: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
) -> Response:
    request_headers = dict(headers or {})
    body = None

    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")

    connection = HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        connection.request(method, path, body=body, headers=request_headers)
        response = connection.getresponse()
        response_body = response.read().decode("utf-8")
        response_headers = {key.lower(): value for key, value in response.getheaders()}
    finally:
        connection.close()

    try:
        data = json.loads(response_body) if response_body else None
    except json.JSONDecodeError:
        data = response_body

    return response.status, response_headers, data


def assert_status(response: Response, expected: int = 200) -> Any:
    status, _headers, data = response
    assert status == expected, f"Expected HTTP {expected}, got {status}: {data!r}"
    return data


def run() -> None:
    os.environ["DOOH_ADMIN_PASSWORD"] = "integration-test-admin-password"
    os.environ["DOOH_ADMIN_TOKEN_SECRET"] = "integration-test-token-secret"

    with running_server() as port:
        root = assert_status(request_json(port, "GET", "/"))
        assert root["endpoints"]["save"] == "POST /encounter"

        home_status, home_headers, _home = request_json(port, "GET", "/home.html")
        assert home_status == 200
        assert home_headers["content-type"].startswith("text/html")

        cors_status, cors_headers, _cors = request_json(
            port,
            "OPTIONS",
            "/encounter",
            headers={
                "Origin": "https://shinjukuweb.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert cors_status == 200
        assert cors_headers["access-control-allow-origin"] in {
            "*",
            "https://shinjukuweb.example",
        }
        assert "POST" in cors_headers["access-control-allow-methods"]

        configured_password = os.environ.pop("DOOH_ADMIN_PASSWORD")
        unconfigured_identity = assert_status(request_json(port, "POST", "/admin/identify", {
            "username": app_module.ADMIN_USERNAME,
        }))
        assert unconfigured_identity == {"admin_required": True, "admin_configured": False}
        unconfigured_login_status, _unconfigured_headers, _unconfigured_login = request_json(
            port,
            "POST",
            "/admin/login",
            {
                "username": app_module.ADMIN_USERNAME,
                "password": "integration-test-admin-password",
            },
        )
        assert unconfigured_login_status == 503
        os.environ["DOOH_ADMIN_PASSWORD"] = configured_password

        normal_identity = assert_status(request_json(port, "POST", "/admin/identify", {
            "username": "ordinary-user",
        }))
        assert normal_identity == {"admin_required": False, "admin_configured": True}

        admin_identity = assert_status(request_json(port, "POST", "/admin/identify", {
            "username": app_module.ADMIN_USERNAME,
        }))
        assert admin_identity == {"admin_required": True, "admin_configured": True}

        unauthorized_status, _unauthorized_headers, _unauthorized = request_json(
            port,
            "GET",
            "/admin/users",
        )
        assert unauthorized_status == 401

        wrong_login_status, _wrong_login_headers, wrong_login = request_json(
            port,
            "POST",
            "/admin/login",
            {
                "username": app_module.ADMIN_USERNAME,
                "password": "wrong-password",
            },
        )
        assert wrong_login_status == 401
        assert wrong_login["detail"] == "Username or password is incorrect"

        admin_login = assert_status(request_json(port, "POST", "/admin/login", {
            "username": app_module.ADMIN_USERNAME,
            "password": "integration-test-admin-password",
        }))
        assert admin_login["token_type"] == "bearer"
        assert admin_login["token"]
        admin_headers = {"Authorization": f"Bearer {admin_login['token']}"}

        assert_status(request_json(port, "POST", "/analytics/view", {"path": "/"}))
        assert_status(request_json(port, "POST", "/analytics/view", {"path": "/home.html?from=test"}))

        timestamp = app_module.now_iso()
        first_ble = assert_status(request_json(port, "POST", "/encounter", {
            "my_id": "dooh_pc",
            "target_id": None,
            "device_name": " AYA ",
            "device_address": "AA:BB:CC:DD:EE:01",
            "rssi": -65,
            "timestamp": timestamp,
        }))
        assert first_ble["count"] == 1
        assert first_ble["encounter_count"] == 1
        assert first_ble["encounter"]["device_name"] == "AYA"
        assert first_ble["encounter"]["device_address"] == "AA:BB:CC:DD:EE:01"
        assert first_ble["encounter"]["rssi"] == -65

        second_ble = assert_status(request_json(port, "POST", "/encounter", {
            "my_id": "dooh_pc",
            "target_id": "null",
            "device_name": None,
            "device_address": "AA:BB:CC:DD:EE:02",
            "rssi": -72,
            "timestamp": timestamp,
        }))
        assert second_ble["encounter"]["target_id"] is None

        stats = assert_status(request_json(port, "GET", "/stats"))
        assert stats["daily_detected_count"] == 2
        assert stats["daily_encounter_count"] == 2

        sync_payload = {
            "sync_id": "sync-web-user-1",
            "user_id": "web-user-1",
            "display_name": "Web User",
            "age": "20",
            "avatar_code": "00020000",
            "costume_id": "costume_fashion02",
            "selected_message_ids": ["talk_hello", "status_break"],
            "interest_ids": ["music"],
            "interests": ["Music"],
        }
        reserved_payload = dict(sync_payload)
        reserved_payload["sync_id"] = "reserved-admin-name"
        reserved_payload["user_id"] = "reserved-user"
        reserved_payload["display_name"] = app_module.ADMIN_USERNAME
        reserved_status, _reserved_headers, reserved_response = request_json(
            port,
            "POST",
            "/sync",
            reserved_payload,
        )
        assert reserved_status == 403
        assert reserved_response["detail"] == "Administrator username is reserved"

        sync = assert_status(request_json(port, "POST", "/sync", sync_payload))
        assert sync["encounter_count"] == 3
        assert sync["encounter"]["costume_id"] == "costume_fashion02"
        assert sync["encounter"]["message_ids"] == ["talk_hello", "status_break"]
        assert "interests" not in sync["encounter"]

        account_session = assert_status(request_json(port, "POST", "/account/session", {
            "user_id": "web-user-1",
            "session_id": "browser-session-1",
            "revision": 0,
        }))
        assert account_session == {"status": "active", "revision": 0}

        admin_users = assert_status(request_json(
            port,
            "GET",
            "/admin/users",
            headers=admin_headers,
        ))
        web_admin_profile = next(
            user for user in admin_users["users"] if user["user_id"] == "web-user-1"
        )
        assert web_admin_profile["display_name"] == "Web User"
        assert web_admin_profile["age"] == "20"
        assert web_admin_profile["interests"] == ["Music"]
        assert web_admin_profile["active"] is True
        assert admin_users["active"] == 1

        metrics = assert_status(request_json(
            port,
            "GET",
            "/admin/metrics",
            headers=admin_headers,
        ))
        assert metrics["total_views"] == 2
        assert metrics["by_path"] == {"/": 1, "/home.html": 1}

        forced_logout = assert_status(request_json(
            port,
            "POST",
            "/admin/users/web-user-1/logout",
            headers=admin_headers,
        ))
        assert forced_logout["revision"] == 1

        forced_session = assert_status(request_json(port, "POST", "/account/session", {
            "user_id": "web-user-1",
            "session_id": "browser-session-1",
            "revision": 0,
        }))
        assert forced_session == {"status": "force_logout", "revision": 1}

        duplicate_sync = assert_status(request_json(port, "POST", "/sync", sync_payload))
        assert duplicate_sync["encounter_count"] == 3
        assert duplicate_sync["encounter"]["timestamp"] == sync["encounter"]["timestamp"]

        conflicting_payload = dict(sync_payload)
        conflicting_payload["display_name"] = "Different User"
        conflict_status, _conflict_headers, conflict = request_json(
            port,
            "POST",
            "/sync",
            conflicting_payload,
        )
        assert conflict_status == 409
        assert conflict["detail"] == "sync_id was already used with different data"

        encounters = assert_status(request_json(port, "GET", "/encounters"))["encounters"]
        assert len(encounters) == 3
        assert encounters[0]["device_address"] == "AA:BB:CC:DD:EE:01"
        assert encounters[-1]["target_id"] == "Web User"

        profiles = assert_status(request_json(port, "GET", "/profiles/recent"))["profiles"]
        web_profile = next(profile for profile in profiles if profile["user_id"] == "web-user-1")
        assert web_profile["interests"] == ["Music"]

        legacy_sync_payload = dict(sync_payload)
        legacy_sync_payload.pop("sync_id")
        legacy_sync_payload["user_id"] = "legacy-web-user"
        legacy_sync_payload["display_name"] = "Legacy Web User"
        legacy_sync = assert_status(request_json(port, "POST", "/sync", legacy_sync_payload))
        assert legacy_sync["encounter_count"] == 4

        reset = assert_status(request_json(port, "DELETE", "/encounters"))
        assert reset["encounters"] == []
        assert_status(request_json(port, "GET", "/encounters"))["encounters"] == []

        reset_state = json.loads(app_module.DATA_PATH.read_text(encoding="utf-8"))
        assert reset_state["sync_requests"] == {}

        republished_sync = assert_status(request_json(port, "POST", "/sync", sync_payload))
        assert republished_sync["encounter_count"] == 1
        republished_encounters = assert_status(
            request_json(port, "GET", "/encounters")
        )["encounters"]
        assert len(republished_encounters) == 1

        deleted = assert_status(request_json(
            port,
            "DELETE",
            "/admin/users/web-user-1",
            headers=admin_headers,
        ))
        assert deleted == {"message": "deleted", "user_id": "web-user-1"}

        deleted_session = assert_status(request_json(port, "POST", "/account/session", {
            "user_id": "web-user-1",
            "session_id": "browser-session-1",
            "revision": 1,
        }))
        assert deleted_session == {"status": "deleted"}

        deleted_sync_status, _deleted_sync_headers, deleted_sync = request_json(
            port,
            "POST",
            "/sync",
            sync_payload,
        )
        assert deleted_sync_status == 410
        assert deleted_sync["detail"] == "Account was deleted"

        remaining_encounters = assert_status(
            request_json(port, "GET", "/encounters")
        )["encounters"]
        assert all(encounter.get("my_id") != "web-user-1" for encounter in remaining_encounters)

        temp_path = app_module.DATA_PATH.with_name(
            f".{app_module.DATA_PATH.name}.{os.getpid()}.tmp"
        )
        assert not temp_path.exists()

    print("FastAPI Web/Unity integration tests passed.")


if __name__ == "__main__":
    run()

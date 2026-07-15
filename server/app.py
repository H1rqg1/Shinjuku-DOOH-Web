from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
DATA_DIR = BASE_DIR / "data"
DATA_PATH = DATA_DIR / "dooh_state.json"
ADMIN_USERNAME = "DOOH-IPUT-IS-IDIOT-TEAM-K"

load_dotenv(PROJECT_DIR / ".env")

try:
    JST = ZoneInfo("Asia/Tokyo")
except Exception:
    JST = timezone(timedelta(hours=9), name="Asia/Tokyo")

data_lock = Lock()
admin_auth_lock = Lock()
MAX_SYNC_REQUESTS = 1000
MAX_DELETED_USERS = 1000
ADMIN_SESSION_TTL_SECONDS = 60 * 60
ADMIN_LOGIN_WINDOW_SECONDS = 5 * 60
ADMIN_LOGIN_MAX_FAILURES = 5
admin_login_failures: Dict[str, List[float]] = {}

app = FastAPI(title="Shinjuku DOOH Web Bridge")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AvatarPayload(BaseModel):
    user_id: str
    display_name: str = ""
    avatar_code: str
    costume_id: Optional[str] = None


class UserMessagesPayload(BaseModel):
    user_id: str
    selected_message_ids: List[str] = Field(default_factory=list)


class SyncPayload(AvatarPayload):
    sync_id: Optional[str] = None
    age: Optional[str] = None
    selected_message_ids: List[str] = Field(default_factory=list)
    interest_ids: List[str] = Field(default_factory=list)
    interests: List[str] = Field(default_factory=list)


class EncounterPayload(BaseModel):
    my_id: str
    target_id: Optional[str] = None
    device_name: Optional[str] = None
    device_address: Optional[str] = None
    rssi: Optional[int] = None
    timestamp: Optional[str] = None
    costume_id: Optional[str] = None
    message_ids: List[str] = Field(default_factory=list)
    avatar_code: Optional[str] = None
    display_name: Optional[str] = None


class AdminIdentifyPayload(BaseModel):
    username: str = Field(min_length=1, max_length=80)


class AdminLoginPayload(AdminIdentifyPayload):
    password: str = Field(min_length=1, max_length=256)


class AccountSessionPayload(BaseModel):
    user_id: str = Field(min_length=1, max_length=128)
    session_id: str = Field(min_length=1, max_length=128)
    revision: int = Field(default=0, ge=0)


class AnalyticsViewPayload(BaseModel):
    path: str = Field(min_length=1, max_length=120)


DEFAULT_MESSAGES = [
    {"message_id": "talk_hello", "category": "talk", "text": "こんにちは", "enabled": True},
    {"message_id": "talk_evening", "category": "talk", "text": "こんばんは", "enabled": True},
    {"message_id": "mood_good", "category": "mood", "text": "元気です", "enabled": True},
    {"message_id": "mood_relaxed", "category": "mood", "text": "リラックスしています", "enabled": True},
    {"message_id": "status_walking", "category": "status", "text": "お散歩中です", "enabled": True},
    {"message_id": "status_break", "category": "status", "text": "休憩中です", "enabled": True},
    {"message_id": "trait_curious", "category": "trait", "text": "好奇心旺盛です", "enabled": True},
    {"message_id": "trait_calm", "category": "trait", "text": "静かな時間が好きです", "enabled": True},
]


def now_jst() -> datetime:
    return datetime.now(JST)


def now_iso() -> str:
    return now_jst().isoformat(timespec="seconds")


def normalize_text(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None

    text = value.strip()
    return text or None


def is_none_like_id(value: Any) -> bool:
    normalized = normalize_text(value)
    return normalized is None or normalized.lower() in {"none", "null"}


def initial_state() -> Dict[str, Any]:
    return {
        "users": {},
        "encounters": [],
        "messages": DEFAULT_MESSAGES,
        "sync_requests": {},
        "deleted_users": {},
        "analytics": {
            "total_views": 0,
            "by_path": {},
            "updated_at": None,
        },
    }


def ensure_data_file() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not DATA_PATH.exists():
        write_state(initial_state())


def read_state() -> Dict[str, Any]:
    ensure_data_file()

    try:
        with DATA_PATH.open("r", encoding="utf-8") as file:
            state = json.load(file)
    except (json.JSONDecodeError, OSError):
        return initial_state()

    if not isinstance(state, dict):
        return initial_state()

    state.setdefault("users", {})
    state.setdefault("encounters", [])
    state.setdefault("messages", DEFAULT_MESSAGES)
    state.setdefault("sync_requests", {})
    state.setdefault("deleted_users", {})
    state.setdefault("analytics", initial_state()["analytics"])

    if not isinstance(state["users"], dict):
        state["users"] = {}
    if not isinstance(state["encounters"], list):
        state["encounters"] = []
    if not isinstance(state["messages"], list):
        state["messages"] = DEFAULT_MESSAGES
    if not isinstance(state["sync_requests"], dict):
        state["sync_requests"] = {}
    if not isinstance(state["deleted_users"], dict):
        state["deleted_users"] = {}
    if not isinstance(state["analytics"], dict):
        state["analytics"] = initial_state()["analytics"]

    analytics = state["analytics"]
    if not isinstance(analytics.get("total_views"), int):
        analytics["total_views"] = 0
    if not isinstance(analytics.get("by_path"), dict):
        analytics["by_path"] = {}
    analytics.setdefault("updated_at", None)

    return state


def write_state(state: Dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    temp_path = DATA_PATH.with_name(f".{DATA_PATH.name}.{os.getpid()}.tmp")

    try:
        with temp_path.open("w", encoding="utf-8") as file:
            json.dump(state, file, ensure_ascii=False, indent=2)
            file.flush()
            os.fsync(file.fileno())

        os.replace(temp_path, DATA_PATH)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def model_to_dict(model: BaseModel) -> Dict[str, Any]:
    return model.model_dump() if hasattr(model, "model_dump") else model.dict()


def normalize_sync_id(value: Any) -> Optional[str]:
    sync_id = normalize_text(value)
    if sync_id is None:
        return None
    if len(sync_id) > 128:
        raise HTTPException(status_code=400, detail="sync_id must be 128 characters or fewer")
    return sync_id


def build_sync_fingerprint(payload: SyncPayload) -> str:
    values = model_to_dict(payload)
    values.pop("sync_id", None)
    return json.dumps(values, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def trim_sync_requests(sync_requests: Dict[str, Any]) -> None:
    while len(sync_requests) > MAX_SYNC_REQUESTS:
        oldest_sync_id = next(iter(sync_requests))
        del sync_requests[oldest_sync_id]


def trim_deleted_users(deleted_users: Dict[str, Any]) -> None:
    while len(deleted_users) > MAX_DELETED_USERS:
        oldest_user_id = next(iter(deleted_users))
        del deleted_users[oldest_user_id]


def get_admin_credentials() -> Optional[Dict[str, str]]:
    username = ADMIN_USERNAME
    password = os.getenv("DOOH_ADMIN_PASSWORD", "")

    if not password:
        return None

    token_secret = os.getenv("DOOH_ADMIN_TOKEN_SECRET", "")
    if not token_secret:
        token_secret = hashlib.sha256(f"{username}\0{password}".encode("utf-8")).hexdigest()

    return {
        "username": username,
        "password": password,
        "token_secret": token_secret,
    }


def encode_token_part(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def decode_token_part(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}")


def create_admin_token(username: str, secret: str) -> tuple[str, int]:
    expires_at = int(time.time()) + ADMIN_SESSION_TTL_SECONDS
    payload = json.dumps(
        {"sub": username, "exp": expires_at},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    encoded_payload = encode_token_part(payload)
    signature = hmac.new(
        secret.encode("utf-8"),
        encoded_payload.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"{encoded_payload}.{encode_token_part(signature)}", expires_at


def require_admin(authorization: Optional[str] = Header(default=None)) -> str:
    credentials = get_admin_credentials()
    if credentials is None:
        raise HTTPException(status_code=503, detail="Admin mode is not configured")

    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Admin authentication is required")

    try:
        encoded_payload, encoded_signature = token.split(".", 1)
        expected_signature = hmac.new(
            credentials["token_secret"].encode("utf-8"),
            encoded_payload.encode("ascii"),
            hashlib.sha256,
        ).digest()
        supplied_signature = decode_token_part(encoded_signature)
        payload = json.loads(decode_token_part(encoded_payload).decode("utf-8"))
    except (ValueError, TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=401, detail="Admin session is invalid")

    if not hmac.compare_digest(expected_signature, supplied_signature):
        raise HTTPException(status_code=401, detail="Admin session is invalid")
    if payload.get("sub") != credentials["username"]:
        raise HTTPException(status_code=401, detail="Admin session is invalid")
    if not isinstance(payload.get("exp"), int) or payload["exp"] <= int(time.time()):
        raise HTTPException(status_code=401, detail="Admin session has expired")

    return credentials["username"]


def admin_login_key(request: Request) -> str:
    forwarded_for = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


def get_recent_admin_failures(key: str) -> List[float]:
    cutoff = time.monotonic() - ADMIN_LOGIN_WINDOW_SECONDS
    failures = [value for value in admin_login_failures.get(key, []) if value >= cutoff]
    admin_login_failures[key] = failures
    return failures


def normalize_view_path(value: str) -> str:
    path = value.strip().split("?", 1)[0].split("#", 1)[0]
    if not path.startswith("/"):
        path = f"/{path}"
    return path[:120]


def validate_message_ids(message_ids: List[str]) -> List[str]:
    normalized_ids = []

    for message_id in message_ids:
        normalized = normalize_text(message_id)
        if normalized is not None:
            normalized_ids.append(normalized)

    if len(normalized_ids) > 3:
        raise HTTPException(status_code=400, detail="selected_message_ids must contain 3 or fewer items")

    if len(set(normalized_ids)) != len(normalized_ids):
        raise HTTPException(status_code=400, detail="selected_message_ids contains duplicates")

    return normalized_ids


def costume_id_from_avatar_code(avatar_code: str) -> Optional[str]:
    if len(avatar_code) != 8 or not avatar_code.isdigit():
        raise HTTPException(status_code=400, detail="avatar_code must be 8 digits")

    outfit_id = int(avatar_code[:4])
    if 1 <= outfit_id <= 3:
        return f"costume_fashion{outfit_id:02d}"

    return None


def get_user(state: Dict[str, Any], user_id: str) -> Dict[str, Any]:
    user_id = user_id.strip()
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id is required")

    if user_id in state.get("deleted_users", {}):
        raise HTTPException(status_code=410, detail="Account was deleted")

    users = state["users"]
    user = users.get(user_id)

    if not isinstance(user, dict):
        user = {"user_id": user_id, "selected_message_ids": []}
        users[user_id] = user

    return user


def update_avatar(state: Dict[str, Any], payload: AvatarPayload) -> Dict[str, Any]:
    user = get_user(state, payload.user_id)
    costume_id = payload.costume_id or costume_id_from_avatar_code(payload.avatar_code)
    display_name = payload.display_name.strip()

    if secrets.compare_digest(display_name, ADMIN_USERNAME):
        raise HTTPException(status_code=403, detail="Administrator username is reserved")

    user.update(
        {
            "display_name": display_name,
            "avatar_code": payload.avatar_code,
            "costume_id": costume_id,
            "updated_at": now_iso(),
        }
    )

    return user


def update_messages(state: Dict[str, Any], payload: UserMessagesPayload) -> Dict[str, Any]:
    user = get_user(state, payload.user_id)
    user["selected_message_ids"] = validate_message_ids(payload.selected_message_ids)
    user["updated_at"] = now_iso()
    return user


def update_profile_exchange_fields(state: Dict[str, Any], payload: SyncPayload) -> Dict[str, Any]:
    user = get_user(state, payload.user_id)

    user["age"] = normalize_text(payload.age)
    user["interest_ids"] = [
        interest_id for interest_id in (normalize_text(value) for value in payload.interest_ids)
        if interest_id is not None
    ][:5]
    user["interests"] = [
        interest for interest in (normalize_text(value) for value in payload.interests)
        if interest is not None
    ][:5]
    user["updated_at"] = now_iso()

    return user


def is_user_active(user: Dict[str, Any]) -> bool:
    last_active_at = parse_timestamp_to_jst(user.get("last_active_at"))
    if last_active_at is None or not normalize_text(user.get("active_session_id")):
        return False
    return now_jst() - last_active_at <= timedelta(minutes=2)


def build_admin_users(state: Dict[str, Any]) -> List[Dict[str, Any]]:
    users = []

    for user_id, user in state["users"].items():
        if not isinstance(user, dict):
            continue

        users.append({
            "user_id": user_id,
            "display_name": normalize_text(user.get("display_name")) or "Unknown",
            "age": normalize_text(user.get("age")),
            "interests": list(user.get("interests") or [])[:5],
            "message_ids": list(user.get("selected_message_ids") or [])[:3],
            "costume_id": normalize_text(user.get("costume_id")),
            "avatar_code": normalize_text(user.get("avatar_code")),
            "updated_at": normalize_text(user.get("updated_at")),
            "last_active_at": normalize_text(user.get("last_active_at")),
            "active": is_user_active(user),
        })

    users.sort(key=lambda user: user.get("last_active_at") or user.get("updated_at") or "", reverse=True)
    return users


def append_encounter(state: Dict[str, Any], user: Dict[str, Any]) -> Dict[str, Any]:
    user_id = normalize_text(user.get("user_id"))
    if user_id is None:
        raise HTTPException(status_code=400, detail="user_id is required")

    target_id = normalize_text(user.get("display_name")) or user_id
    encounter = {
        "my_id": user_id,
        "target_id": target_id,
        "timestamp": now_iso(),
        "costume_id": normalize_text(user.get("costume_id")),
        "message_ids": list(user.get("selected_message_ids") or []),
        "avatar_code": normalize_text(user.get("avatar_code")),
        "display_name": normalize_text(user.get("display_name")),
    }

    state["encounters"].append(encounter)
    return encounter


def parse_timestamp_to_jst(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value.strip():
        return None

    text = value.strip()
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"

    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=JST)

    return parsed.astimezone(JST)


def get_detection_identity(encounter: Dict[str, Any]) -> Optional[str]:
    target_id = encounter.get("target_id")
    if not is_none_like_id(target_id):
        return f"target:{normalize_text(target_id)}"

    device_address = normalize_text(encounter.get("device_address"))
    if device_address is not None:
        return f"address:{device_address.lower()}"

    timestamp = normalize_text(encounter.get("timestamp"))
    my_id = normalize_text(encounter.get("my_id"))
    if timestamp is not None or my_id is not None:
        return f"anonymous:{my_id or 'unknown'}:{timestamp or 'unknown'}"

    return None


def build_today_stats(encounters: List[Dict[str, Any]]) -> Dict[str, Any]:
    current = now_jst()
    today = current.date()
    detected_ids = set()
    daily_encounter_count = 0

    for encounter in encounters:
        if not isinstance(encounter, dict):
            continue

        timestamp = parse_timestamp_to_jst(encounter.get("timestamp"))
        if timestamp is None or timestamp.date() != today:
            continue

        daily_encounter_count += 1
        identity = get_detection_identity(encounter)
        if identity is not None:
            detected_ids.add(identity)

    return {
        "date_jst": current.strftime("%Y-%m-%d"),
        "time_jst": current.strftime("%H:%M"),
        "daily_detected_count": len(detected_ids) if detected_ids else daily_encounter_count,
        "daily_encounter_count": daily_encounter_count,
    }


def build_recent_profiles(state: Dict[str, Any], limit: int = 10) -> List[Dict[str, Any]]:
    profiles = []
    seen_user_ids = set()

    for encounter in reversed(state["encounters"]):
        if not isinstance(encounter, dict):
            continue

        user_id = normalize_text(encounter.get("my_id"))
        if user_id is None or user_id in seen_user_ids:
            continue

        user = state["users"].get(user_id)
        if not isinstance(user, dict):
            user = {}

        profiles.append(
            {
                "user_id": user_id,
                "display_name": (
                    normalize_text(user.get("display_name"))
                    or normalize_text(encounter.get("display_name"))
                    or "Unknown"
                ),
                "interests": list(user.get("interests") or [])[:5],
                "interest_ids": list(user.get("interest_ids") or [])[:5],
                "message_ids": list(user.get("selected_message_ids") or encounter.get("message_ids") or [])[:3],
                "last_seen_at": normalize_text(encounter.get("timestamp")),
            }
        )
        seen_user_ids.add(user_id)

        if len(profiles) >= limit:
            break

    return profiles


@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "message": "DOOH Encounter Server is running",
        "endpoints": {
            "save": "POST /encounter",
            "list": "GET /encounters",
            "stats": "GET /stats",
            "reset": "DELETE /encounters",
        },
    }


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "service": "Shinjuku DOOH Web Bridge",
        "time_jst": now_iso(),
    }


@app.post("/sync")
def sync_user(payload: SyncPayload) -> Dict[str, Any]:
    sync_id = normalize_sync_id(payload.sync_id)
    fingerprint = build_sync_fingerprint(payload) if sync_id is not None else None

    with data_lock:
        state = read_state()
        sync_requests = state["sync_requests"]

        if sync_id is not None:
            saved_request = sync_requests.get(sync_id)

            if isinstance(saved_request, dict):
                if saved_request.get("fingerprint") != fingerprint:
                    raise HTTPException(
                        status_code=409,
                        detail="sync_id was already used with different data"
                    )

                saved_response = saved_request.get("response")
                if isinstance(saved_response, dict):
                    return saved_response

                del sync_requests[sync_id]

        user = update_avatar(state, payload)
        user = update_messages(state, UserMessagesPayload(
            user_id=payload.user_id,
            selected_message_ids=payload.selected_message_ids,
        ))
        user = update_profile_exchange_fields(state, payload)
        encounter = append_encounter(state, user)
        response = {
            "message": "saved",
            "user": deepcopy(user),
            "encounter": deepcopy(encounter),
            "encounter_count": len(state["encounters"]),
        }

        if sync_id is not None:
            sync_requests[sync_id] = {
                "fingerprint": fingerprint,
                "response": response,
            }
            trim_sync_requests(sync_requests)

        write_state(state)

    return response


@app.post("/avatar")
def save_avatar(payload: AvatarPayload) -> Dict[str, Any]:
    with data_lock:
        state = read_state()
        user = update_avatar(state, payload)
        write_state(state)

    return {"message": "saved", "user": user}


@app.post("/user-messages")
def save_user_messages(payload: UserMessagesPayload) -> Dict[str, Any]:
    with data_lock:
        state = read_state()
        user = update_messages(state, payload)
        write_state(state)

    return {"message": "saved", "user": user}


@app.post("/encounter")
def save_encounter(payload: EncounterPayload) -> Dict[str, Any]:
    encounter = model_to_dict(payload)

    encounter["target_id"] = (
        None if is_none_like_id(encounter.get("target_id"))
        else normalize_text(encounter.get("target_id"))
    )
    encounter["device_name"] = normalize_text(encounter.get("device_name"))
    encounter["device_address"] = normalize_text(encounter.get("device_address"))

    if not encounter.get("timestamp"):
        encounter["timestamp"] = now_iso()

    encounter["message_ids"] = validate_message_ids(encounter.get("message_ids") or [])

    with data_lock:
        state = read_state()
        state["encounters"].append(encounter)
        write_state(state)

    return {
        "message": "saved",
        "encounter": encounter,
        "count": len(state["encounters"]),
        "encounter_count": len(state["encounters"]),
    }


@app.get("/encounters")
def list_encounters() -> Dict[str, Any]:
    with data_lock:
        state = read_state()

    return {"encounters": state["encounters"]}


@app.get("/profiles/recent")
def recent_profiles() -> Dict[str, Any]:
    with data_lock:
        state = read_state()

    return {"profiles": build_recent_profiles(state)}


@app.get("/stats")
def get_stats() -> Dict[str, Any]:
    with data_lock:
        state = read_state()

    return build_today_stats(state["encounters"])


@app.get("/message-options")
def message_options() -> Dict[str, Any]:
    with data_lock:
        state = read_state()

    return {"messages": state["messages"]}


@app.post("/admin/identify")
def identify_admin(payload: AdminIdentifyPayload) -> Dict[str, Any]:
    credentials = get_admin_credentials()
    username = payload.username.strip()
    admin_required = secrets.compare_digest(username, ADMIN_USERNAME)
    return {
        "admin_required": admin_required,
        "admin_configured": credentials is not None,
    }


@app.post("/admin/login")
def admin_login(payload: AdminLoginPayload, request: Request) -> Dict[str, Any]:
    credentials = get_admin_credentials()
    if credentials is None:
        raise HTTPException(status_code=503, detail="Admin mode is not configured")

    key = admin_login_key(request)
    with admin_auth_lock:
        failures = get_recent_admin_failures(key)
        if len(failures) >= ADMIN_LOGIN_MAX_FAILURES:
            raise HTTPException(status_code=429, detail="Too many failed login attempts")

    username_matches = secrets.compare_digest(payload.username.strip(), credentials["username"])
    password_matches = secrets.compare_digest(payload.password, credentials["password"])

    if not username_matches or not password_matches:
        with admin_auth_lock:
            get_recent_admin_failures(key).append(time.monotonic())
        raise HTTPException(status_code=401, detail="Username or password is incorrect")

    with admin_auth_lock:
        admin_login_failures.pop(key, None)

    token, expires_at = create_admin_token(credentials["username"], credentials["token_secret"])
    return {
        "token": token,
        "token_type": "bearer",
        "expires_at": expires_at,
    }


@app.post("/analytics/view")
def record_page_view(payload: AnalyticsViewPayload) -> Dict[str, Any]:
    path = normalize_view_path(payload.path)

    with data_lock:
        state = read_state()
        analytics = state["analytics"]
        analytics["total_views"] += 1
        analytics["by_path"][path] = int(analytics["by_path"].get(path, 0)) + 1
        analytics["updated_at"] = now_iso()
        write_state(state)

    return {"recorded": True}


@app.post("/account/session")
def update_account_session(payload: AccountSessionPayload) -> Dict[str, Any]:
    user_id = payload.user_id.strip()

    with data_lock:
        state = read_state()
        if user_id in state["deleted_users"]:
            return {"status": "deleted"}

        user = state["users"].get(user_id)
        if not isinstance(user, dict):
            return {"status": "unknown"}

        revision = int(user.get("session_revision") or 0)
        if payload.revision != revision:
            return {"status": "force_logout", "revision": revision}

        user["active_session_id"] = payload.session_id.strip()
        user["last_active_at"] = now_iso()
        write_state(state)

    return {"status": "active", "revision": revision}


@app.get("/admin/users")
def list_admin_users(_admin: str = Depends(require_admin)) -> Dict[str, Any]:
    with data_lock:
        state = read_state()

    users = build_admin_users(state)
    return {
        "users": users,
        "total": len(users),
        "active": sum(1 for user in users if user["active"]),
    }


@app.get("/admin/metrics")
def admin_metrics(_admin: str = Depends(require_admin)) -> Dict[str, Any]:
    with data_lock:
        state = read_state()
        analytics = deepcopy(state["analytics"])

    return analytics


@app.post("/admin/users/{user_id}/logout")
def force_logout_user(user_id: str, _admin: str = Depends(require_admin)) -> Dict[str, Any]:
    with data_lock:
        state = read_state()
        user = state["users"].get(user_id)
        if not isinstance(user, dict):
            raise HTTPException(status_code=404, detail="User was not found")

        revision = int(user.get("session_revision") or 0) + 1
        user["session_revision"] = revision
        user["force_logout_at"] = now_iso()
        user.pop("active_session_id", None)
        write_state(state)

    return {"message": "logout_requested", "user_id": user_id, "revision": revision}


@app.delete("/admin/users/{user_id}")
def delete_admin_user(user_id: str, _admin: str = Depends(require_admin)) -> Dict[str, Any]:
    with data_lock:
        state = read_state()
        if not isinstance(state["users"].get(user_id), dict):
            raise HTTPException(status_code=404, detail="User was not found")

        del state["users"][user_id]
        state["encounters"] = [
            encounter for encounter in state["encounters"]
            if not isinstance(encounter, dict) or encounter.get("my_id") != user_id
        ]
        state["sync_requests"] = {}
        state["deleted_users"][user_id] = {"deleted_at": now_iso()}
        trim_deleted_users(state["deleted_users"])
        write_state(state)

    return {"message": "deleted", "user_id": user_id}


@app.delete("/encounters")
def reset_encounters() -> Dict[str, Any]:
    with data_lock:
        state = read_state()
        state["encounters"] = []
        state["sync_requests"] = {}
        write_state(state)

    return {"message": "reset", "encounters": []}


app.mount("/", StaticFiles(directory=PROJECT_DIR), name="static")

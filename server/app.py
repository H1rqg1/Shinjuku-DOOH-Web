from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List, Optional
import json
import os
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
DATA_DIR = BASE_DIR / "data"
DATA_PATH = DATA_DIR / "dooh_state.json"

try:
    JST = ZoneInfo("Asia/Tokyo")
except Exception:
    JST = timezone(timedelta(hours=9), name="Asia/Tokyo")

data_lock = Lock()
MAX_SYNC_REQUESTS = 1000

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

    if not isinstance(state["users"], dict):
        state["users"] = {}
    if not isinstance(state["encounters"], list):
        state["encounters"] = []
    if not isinstance(state["messages"], list):
        state["messages"] = DEFAULT_MESSAGES
    if not isinstance(state["sync_requests"], dict):
        state["sync_requests"] = {}

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

    users = state["users"]
    user = users.get(user_id)

    if not isinstance(user, dict):
        user = {"user_id": user_id, "selected_message_ids": []}
        users[user_id] = user

    return user


def update_avatar(state: Dict[str, Any], payload: AvatarPayload) -> Dict[str, Any]:
    user = get_user(state, payload.user_id)
    costume_id = payload.costume_id or costume_id_from_avatar_code(payload.avatar_code)

    user.update(
        {
            "display_name": payload.display_name.strip(),
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


@app.delete("/encounters")
def reset_encounters() -> Dict[str, Any]:
    with data_lock:
        state = read_state()
        state["encounters"] = []
        state["sync_requests"] = {}
        write_state(state)

    return {"message": "reset", "encounters": []}


app.mount("/", StaticFiles(directory=PROJECT_DIR), name="static")

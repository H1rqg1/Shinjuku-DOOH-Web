// Shared API client for the DOOH web app.
// Cloudflare Pages is a static host, so API requests must never default to
// the current page origin. Use localStorage or ?apiBaseUrl=... for overrides.

const DEFAULT_API_BASE_URL = window.DOOH_CONFIG?.defaultApiBaseUrl || "http://127.0.0.1:8000";
const API_BASE_URL_STORAGE_KEY = window.DOOH_CONFIG?.apiBaseUrlStorageKey || "dooh_api_base_url";
const API_BASE_URL_QUERY_KEY = window.DOOH_CONFIG?.apiBaseUrlQueryKey || "apiBaseUrl";
const API_BASE_URL = resolveApiBaseUrl();

function resolveApiBaseUrl() {
    const params = new URLSearchParams(window.location.search);
    const queryOverride = params.get(API_BASE_URL_QUERY_KEY);

    if (queryOverride && queryOverride.trim()) {
        const normalizedOverride = queryOverride.trim().replace(/\/+$/, "");
        localStorage.setItem(API_BASE_URL_STORAGE_KEY, normalizedOverride);
        return normalizedOverride;
    }

    const override = localStorage.getItem(API_BASE_URL_STORAGE_KEY);

    if (override && override.trim()) {
        return override.trim().replace(/\/+$/, "");
    }

    return DEFAULT_API_BASE_URL;
}

function getUserId() {
    let userId = localStorage.getItem("user_id");

    if (!userId) {
        userId = (window.crypto && window.crypto.randomUUID)
            ? window.crypto.randomUUID()
            : "user_" + Date.now() + "_" + Math.random().toString(16).slice(2);

        localStorage.setItem("user_id", userId);
    }

    return userId;
}

function buildAvatarCode(outfitId, hatId, accessoryId) {
    const c = String(outfitId ?? 0).padStart(4, "0");
    const h = String(hatId ?? 0).padStart(2, "0");
    const a = String(accessoryId ?? 0).padStart(2, "0");

    return c + h + a;
}

function buildCostumeId(outfitId) {
    const id = Number(outfitId ?? 0);

    if (id >= 1 && id <= 3) {
        return "costume_fashion" + String(id).padStart(2, "0");
    }

    return null;
}

function createDefaultAvatar() {
    return {
        outfit: { id: 0, name: "none", image: "" },
        hat: { id: 0, name: "none", image: "" },
        accessory: { id: 0, name: "none", image: "" }
    };
}

async function postJson(path, payload) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });

    let data = null;

    try {
        data = await response.json();
    } catch (err) {
        data = null;
    }

    if (!response.ok) {
        const message = data && data.detail
            ? data.detail
            : `HTTP ${response.status}`;

        throw new Error(message);
    }

    return data;
}

async function saveAvatarSetting(userId, displayName, avatarCode, costumeId) {
    return postJson("/avatar", {
        user_id: userId,
        display_name: displayName,
        avatar_code: avatarCode,
        costume_id: costumeId
    });
}

async function saveUserMessages(userId, selectedMessageIds) {
    return postJson("/user-messages", {
        user_id: userId,
        selected_message_ids: selectedMessageIds
    });
}

async function saveUserSync(payload) {
    return postJson("/sync", payload);
}

async function fetchMessageOptions() {
    try {
        const res = await fetch(`${API_BASE_URL}/message-options`);

        if (!res.ok) {
            throw new Error("status " + res.status);
        }

        const data = await res.json();
        return Array.isArray(data.messages) ? data.messages : [];
    } catch (err) {
        console.warn("Failed to fetch message options. Local fallback will be used.", err);
        return null;
    }
}

function validateBeforeSave({ userId, outfitId, avatarCode, messageIds }) {
    if (!userId) {
        return "user_id is missing";
    }

    if (outfitId === undefined || outfitId === null) {
        return "outfit is not selected";
    }

    if (!/^\d{8}$/.test(avatarCode)) {
        return "avatar_code must be 8 digits";
    }

    if (messageIds.length > 3) {
        return "message count must be 3 or fewer";
    }

    if (new Set(messageIds).size !== messageIds.length) {
        return "message ids contain duplicates";
    }

    return null;
}

async function syncToServer() {
    const profile = JSON.parse(localStorage.getItem("profile") || "null");
    let avatar = JSON.parse(localStorage.getItem("avatar") || "null");

    if (!profile) {
        return { ok: false, message: "保存するデータが不足しています" };
    }

    if (!avatar) {
        avatar = createDefaultAvatar();
        localStorage.setItem("avatar", JSON.stringify(avatar));
    }

    const userId = getUserId();
    const displayName = profile.nickname || "";
    const outfitId = avatar.outfit?.id;

    const avatarCode = buildAvatarCode(
        outfitId,
        avatar.hat?.id,
        avatar.accessory?.id
    );

    const messageIds = Array.isArray(profile.messageIds) ? profile.messageIds : [];
    const validationError = validateBeforeSave({
        userId,
        outfitId,
        avatarCode,
        messageIds
    });

    if (validationError) {
        console.warn("Save validation failed:", validationError);
        return { ok: false, message: "保存に失敗しました: " + validationError };
    }

    const payload = {
        user_id: userId,
        display_name: displayName,
        avatar_code: avatarCode,
        costume_id: buildCostumeId(outfitId),
        selected_message_ids: messageIds
    };

    try {
        const data = await saveUserSync(payload);
        const count = data && typeof data.encounter_count === "number"
            ? ` (${data.encounter_count})`
            : "";

        return { ok: true, message: "保存しました" + count };
    } catch (err) {
        console.error("Sync failed:", err);
        return { ok: false, message: "保存に失敗しました。サーバーに接続できません。" };
    }
}

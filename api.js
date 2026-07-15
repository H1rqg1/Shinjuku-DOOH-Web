// DOOH web domain API. HTTP details live in api-client.js.

const doohApiClient = window.DOOH_API_CLIENT;

function createApiResponseError(message) {
    return new doohApiClient.Error("INVALID_RESPONSE", message);
}

function normalizeMessageOptionsResponse(data) {
    if (!data || !Array.isArray(data.messages)) {
        throw createApiResponseError("メッセージ候補のレスポンス形式が正しくありません。");
    }

    return data.messages;
}

function normalizeRecentProfilesResponse(data) {
    if (!data || !Array.isArray(data.profiles)) {
        throw createApiResponseError("プロフィール一覧のレスポンス形式が正しくありません。");
    }

    return data.profiles;
}

function normalizeEncountersResponse(data) {
    if (Array.isArray(data)) {
        return data;
    }

    if (data && Array.isArray(data.encounters)) {
        return data.encounters;
    }

    throw createApiResponseError("encountersフィールドがないレスポンスを受信しました。");
}

function normalizeStatsResponse(data) {
    const isValid = data
        && !Array.isArray(data)
        && typeof data.date_jst === "string"
        && typeof data.time_jst === "string"
        && typeof data.daily_detected_count === "number"
        && typeof data.daily_encounter_count === "number";

    if (!isValid) {
        throw createApiResponseError("statsレスポンスのフィールドまたは型が正しくありません。");
    }

    return data;
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

const PENDING_SYNC_STORAGE_KEY = "dooh_pending_sync";

function createSyncId() {
    return (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : "sync_" + Date.now() + "_" + Math.random().toString(16).slice(2);
}

function getOrCreateSyncId(payload) {
    const fingerprint = JSON.stringify(payload);
    let pending = null;

    try {
        pending = JSON.parse(localStorage.getItem(PENDING_SYNC_STORAGE_KEY) || "null");
    } catch (err) {
        console.warn("保留中の同期IDを読み込めないため再作成します。", err.message);
    }

    if (pending
        && typeof pending.id === "string"
        && pending.id
        && pending.fingerprint === fingerprint) {
        return pending.id;
    }

    const syncId = createSyncId();

    try {
        localStorage.setItem(PENDING_SYNC_STORAGE_KEY, JSON.stringify({
            id: syncId,
            fingerprint
        }));
    } catch (err) {
        console.warn("同期IDを端末へ保存できませんでした。", err.message);
    }

    return syncId;
}

function clearPendingSyncId(syncId) {
    try {
        const pending = JSON.parse(localStorage.getItem(PENDING_SYNC_STORAGE_KEY) || "null");

        if (pending?.id === syncId) {
            localStorage.removeItem(PENDING_SYNC_STORAGE_KEY);
        }
    } catch (err) {
        console.warn("完了した同期IDを削除できませんでした。", err.message);
    }
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
        outfit: { id: 1, name: "コーデ1", image: "image/clothes/outfit1.png" }
    };
}

async function saveAvatarSetting(userId, displayName, avatarCode, costumeId) {
    return doohApiClient.post("/avatar", {
        user_id: userId,
        display_name: displayName,
        avatar_code: avatarCode,
        costume_id: costumeId
    });
}

async function saveUserMessages(userId, selectedMessageIds) {
    return doohApiClient.post("/user-messages", {
        user_id: userId,
        selected_message_ids: selectedMessageIds
    });
}

async function saveUserSync(payload) {
    return doohApiClient.post("/sync", payload);
}

async function fetchMessageOptions() {
    try {
        const data = await doohApiClient.get("/message-options");
        return normalizeMessageOptionsResponse(data);
    } catch (err) {
        console.warn("メッセージ候補を取得できないため、端末内の候補を使用します。", err.message);
        return null;
    }
}

async function fetchRecentProfiles() {
    const data = await doohApiClient.get("/profiles/recent");
    return normalizeRecentProfilesResponse(data);
}

async function fetchEncounters() {
    const data = await doohApiClient.get("/encounters");
    return normalizeEncountersResponse(data);
}

async function fetchStats() {
    const data = await doohApiClient.get("/stats");
    return normalizeStatsResponse(data);
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

let syncRequest = null;

function syncToServer() {
    if (!syncRequest) {
        syncRequest = performSyncToServer().finally(() => {
            syncRequest = null;
        });
    }

    return syncRequest;
}

async function performSyncToServer() {
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
        0,
        0
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
        age: profile.age ? String(profile.age) : null,
        avatar_code: avatarCode,
        costume_id: buildCostumeId(outfitId),
        selected_message_ids: messageIds,
        interest_ids: Array.isArray(profile.interestIds) ? profile.interestIds : [],
        interests: Array.isArray(profile.interests) ? profile.interests : []
    };
    const syncId = getOrCreateSyncId(payload);
    payload.sync_id = syncId;

    try {
        await saveUserSync(payload);
        clearPendingSyncId(syncId);
        return { ok: true, message: "保存完了" };
    } catch (err) {
        console.error("Profile sync failed:", err.message);
        return { ok: false, message: "保存完了" };
    }
}

window.DOOH_WEB_API = Object.freeze({
    fetchEncounters,
    fetchStats,
    normalizeEncountersResponse,
    normalizeStatsResponse
});

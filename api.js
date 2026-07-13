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

function getSyncFailureMessage(err) {
    if (err?.code === "API_NOT_CONFIGURED") {
        return "API接続先が設定されていません。端末内には保存しました。";
    }

    if (err?.code === "TIMEOUT") {
        return "保存に失敗しました。通信がタイムアウトしました。";
    }

    return "保存に失敗しました。サーバーに接続できません。";
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
        selected_message_ids: messageIds,
        interest_ids: Array.isArray(profile.interestIds) ? profile.interestIds : [],
        interests: Array.isArray(profile.interests) ? profile.interests : []
    };

    try {
        const data = await saveUserSync(payload);
        const count = data && typeof data.encounter_count === "number"
            ? ` (${data.encounter_count})`
            : "";

        return { ok: true, message: "保存しました" + count };
    } catch (err) {
        console.error("Profile sync failed:", err.message);
        return { ok: false, message: getSyncFailureMessage(err) };
    }
}

window.DOOH_WEB_API = Object.freeze({
    fetchEncounters,
    fetchStats,
    normalizeEncountersResponse,
    normalizeStatsResponse
});

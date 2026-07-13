const TOKYO_LATITUDE = 35.6762;
const TOKYO_LONGITUDE = 139.6503;
const PROFILE_REFRESH_INTERVAL_MS = 30000;

function updateTokyoTime() {
    const target = document.getElementById("tokyoTime");

    if (!target) {
        return;
    }

    target.textContent = new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit"
    }).format(new Date());
}

async function updateTokyoTemperature() {
    const target = document.getElementById("tokyoTemp");

    if (!target) {
        return;
    }

    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(TOKYO_LATITUDE));
    url.searchParams.set("longitude", String(TOKYO_LONGITUDE));
    url.searchParams.set("current", "temperature_2m");
    url.searchParams.set("timezone", "Asia/Tokyo");

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error("status " + response.status);
        }

        const data = await response.json();
        const value = Number(data?.current?.temperature_2m);
        const unit = data?.current_units?.temperature_2m || "°C";

        target.textContent = Number.isFinite(value)
            ? `${Math.round(value)}${unit}`
            : "--°C";
    } catch (err) {
        console.warn("Failed to fetch Tokyo temperature.", err);
        target.textContent = "--°C";
    }
}

function getLocalExchangeProfile() {
    const profile = JSON.parse(localStorage.getItem("profile") || "null");
    const userId = localStorage.getItem("user_id");

    if (!profile || !userId) {
        return null;
    }

    return {
        user_id: userId,
        display_name: profile.nickname || "あなた",
        interests: Array.isArray(profile.interests) ? profile.interests : [],
        message_ids: Array.isArray(profile.messageIds) ? profile.messageIds : [],
        last_seen_at: null,
        isLocal: true
    };
}

function renderEncounterProfiles(profiles) {
    const list = document.getElementById("encounterProfiles");

    if (!list) {
        return;
    }

    list.innerHTML = "";

    if (!profiles.length) {
        const empty = document.createElement("p");
        empty.className = "encounter-empty";
        empty.textContent = "まだプロフィールがありません";
        list.appendChild(empty);
        return;
    }

    profiles.slice(0, 3).forEach(profile => {
        const card = document.createElement("article");
        card.className = "encounter-card";

        const name = document.createElement("h3");
        name.textContent = profile.display_name || "Unknown";

        const tags = document.createElement("div");
        tags.className = "encounter-tags";

        const interests = Array.isArray(profile.interests) ? profile.interests : [];

        if (interests.length) {
            interests.slice(0, 3).forEach(text => {
                const tag = document.createElement("span");
                tag.textContent = text;
                tags.appendChild(tag);
            });
        } else {
            const tag = document.createElement("span");
            tag.textContent = profile.isLocal ? "好きなこと未設定" : "プロフィール交換";
            tags.appendChild(tag);
        }

        const meta = document.createElement("p");
        meta.className = "encounter-meta";
        meta.textContent = profile.isLocal ? "あなたのプロフィール" : "最近すれ違いました";

        card.append(name, tags, meta);
        list.appendChild(card);
    });
}

function renderEncounterError(message) {
    const list = document.getElementById("encounterProfiles");

    if (!list) {
        return;
    }

    const error = document.createElement("p");
    error.className = "encounter-empty";
    error.textContent = message;
    list.appendChild(error);
}

async function loadEncounterProfiles() {
    const localProfile = getLocalExchangeProfile();
    const refreshButton = document.getElementById("refreshProfiles");

    if (refreshButton?.disabled) {
        return;
    }

    if (refreshButton) {
        refreshButton.disabled = true;
    }

    try {
        const profiles = typeof fetchRecentProfiles === "function"
            ? await fetchRecentProfiles()
            : [];
        const currentUserId = localStorage.getItem("user_id");
        const filteredProfiles = profiles.filter(profile => profile.user_id !== currentUserId);

        renderEncounterProfiles(filteredProfiles.length ? filteredProfiles : (localProfile ? [localProfile] : []));
    } catch (err) {
        console.warn("最新プロフィールを取得できませんでした。", err.message);
        renderEncounterProfiles(localProfile ? [localProfile] : []);
        renderEncounterError("プロフィールを取得できません。更新ボタンで再試行できます。");
    } finally {
        if (refreshButton) {
            refreshButton.disabled = false;
        }
    }
}

function initHomeWidgets() {
    updateTokyoTime();
    setInterval(updateTokyoTime, 1000);

    updateTokyoTemperature();

    loadEncounterProfiles();
    setInterval(loadEncounterProfiles, PROFILE_REFRESH_INTERVAL_MS);

    const refreshButton = document.getElementById("refreshProfiles");
    if (refreshButton) {
        refreshButton.addEventListener("click", loadEncounterProfiles);
    }
}

initHomeWidgets();

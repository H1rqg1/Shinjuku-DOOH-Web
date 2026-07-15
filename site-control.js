(function (global) {
    "use strict";

    const SESSION_ID_KEY = "dooh_account_session_id";
    const SESSION_REVISION_KEY = "dooh_account_revision";
    const ACCOUNT_KEYS = [
        "profile",
        "avatar",
        "user_id",
        "dooh_pending_sync",
        SESSION_ID_KEY,
        SESSION_REVISION_KEY
    ];
    const client = global.DOOH_API_CLIENT;

    function createSessionId() {
        if (global.crypto && typeof global.crypto.randomUUID === "function") {
            return global.crypto.randomUUID();
        }

        return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function getSessionId() {
        let sessionId = global.localStorage.getItem(SESSION_ID_KEY);

        if (!sessionId) {
            sessionId = createSessionId();
            global.localStorage.setItem(SESSION_ID_KEY, sessionId);
        }

        return sessionId;
    }

    function clearLocalAccount(status) {
        ACCOUNT_KEYS.forEach(key => global.localStorage.removeItem(key));
        global.sessionStorage.removeItem("editMode");

        const message = status === "deleted"
            ? "このアカウントは管理者によって削除されました。"
            : "管理者によってログアウトされました。";

        global.alert(message);
        global.location.replace(`index.html${global.location.search || ""}`);
    }

    async function isAdminUsername(username) {
        if (!client || !client.isConfigured || !username) {
            return false;
        }

        try {
            const result = await client.post("/admin/identify", { username });
            return Boolean(result && result.admin_required);
        } catch (err) {
            console.warn("管理者名を確認できませんでした。", err.message);
            return false;
        }
    }

    async function recordPageView() {
        if (!client || !client.isConfigured) {
            return;
        }

        try {
            await client.post("/analytics/view", {
                path: global.location.pathname || "/"
            });
        } catch (err) {
            console.warn("閲覧数を記録できませんでした。", err.message);
        }
    }

    async function checkAccountSession() {
        if (!client || !client.isConfigured) {
            return;
        }

        const userId = global.localStorage.getItem("user_id");
        if (!userId) {
            return;
        }

        const revision = Number(global.localStorage.getItem(SESSION_REVISION_KEY) || 0);

        try {
            const result = await client.post("/account/session", {
                user_id: userId,
                session_id: getSessionId(),
                revision: Number.isInteger(revision) && revision >= 0 ? revision : 0
            });

            if (result && result.status === "active") {
                global.localStorage.setItem(SESSION_REVISION_KEY, String(result.revision || 0));
                return;
            }

            if (result && (result.status === "force_logout" || result.status === "deleted")) {
                clearLocalAccount(result.status);
            }
        } catch (err) {
            console.warn("アカウント状態を確認できませんでした。", err.message);
        }
    }

    function start() {
        recordPageView();
        checkAccountSession();
        global.setInterval(checkAccountSession, 30000);
    }

    global.DOOH_SITE_CONTROL = {
        isAdminUsername,
        recordPageView,
        checkAccountSession
    };

    if (global.document.readyState === "loading") {
        global.document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }
})(window);

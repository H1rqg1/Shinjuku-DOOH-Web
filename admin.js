(function (global) {
    "use strict";

    const TOKEN_KEY = "dooh_admin_token";
    const USERNAME_KEY = "dooh_admin_username";
    const client = global.DOOH_API_CLIENT;

    function requireClient() {
        if (!client || !client.isConfigured) {
            throw new Error("管理者モードを使うには本番APIの設定が必要です。");
        }
    }

    function getToken() {
        return global.sessionStorage.getItem(TOKEN_KEY) || "";
    }

    function getUsername() {
        return global.sessionStorage.getItem(USERNAME_KEY) || "";
    }

    function authOptions() {
        const token = getToken();
        if (!token) {
            throw new Error("管理者としてログインしてください。");
        }

        return {
            headers: { Authorization: `Bearer ${token}` }
        };
    }

    async function login(username, password) {
        requireClient();
        let result;

        try {
            result = await client.post("/admin/login", { username, password });
        } catch (err) {
            if (err && err.status === 401) {
                throw new Error("管理者IDまたはパスワードが正しくありません。");
            }
            if (err && err.status === 429) {
                throw new Error("ログイン試行回数が上限に達しました。5分後に再試行してください。");
            }
            if (err && err.status === 503) {
                throw new Error("API側で管理者パスワードが設定されていません。");
            }
            throw err;
        }

        if (!result || !result.token) {
            throw new Error("管理者認証の応答が正しくありません。");
        }

        global.sessionStorage.setItem(USERNAME_KEY, username);
        global.sessionStorage.setItem(TOKEN_KEY, result.token);
        return result;
    }

    function logout() {
        global.sessionStorage.removeItem(TOKEN_KEY);
        global.sessionStorage.removeItem(USERNAME_KEY);
    }

    function getUsers() {
        requireClient();
        return client.get("/admin/users", authOptions());
    }

    function getMetrics() {
        requireClient();
        return client.get("/admin/metrics", authOptions());
    }

    function forceLogout(userId) {
        requireClient();
        return client.post(
            `/admin/users/${encodeURIComponent(userId)}/logout`,
            undefined,
            authOptions()
        );
    }

    function deleteUser(userId) {
        requireClient();
        return client.delete(`/admin/users/${encodeURIComponent(userId)}`, authOptions());
    }

    global.DOOH_ADMIN = {
        getUsername,
        hasSession: () => Boolean(getToken()),
        login,
        logout,
        getUsers,
        getMetrics,
        forceLogout,
        deleteUser
    };
})(window);

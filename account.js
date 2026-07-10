(function () {
    const PROFILE_KEY = "profile";
    const AVATAR_KEY = "avatar";
    const USER_ID_KEY = "user_id";

    function readJson(key) {
        try {
            return JSON.parse(localStorage.getItem(key) || "null");
        } catch (err) {
            console.warn(`Failed to read ${key}`, err);
            return null;
        }
    }

    function hasSavedAccount() {
        return Boolean(localStorage.getItem(USER_ID_KEY) && readJson(PROFILE_KEY));
    }

    function getSavedAccount() {
        if (!hasSavedAccount()) {
            return null;
        }

        const profile = readJson(PROFILE_KEY);
        const avatar = readJson(AVATAR_KEY);

        return {
            userId: localStorage.getItem(USER_ID_KEY),
            nickname: profile?.nickname || "User",
            age: profile?.age || "",
            messageCount: Array.isArray(profile?.messageIds) ? profile.messageIds.length : 0,
            hasAvatar: Boolean(avatar)
        };
    }

    function withSearch(path) {
        return path + window.location.search;
    }

    function routeAfterIntro() {
        return hasSavedAccount()
            ? withSearch("login.html")
            : withSearch("profile.html");
    }

    function continueSavedAccount() {
        sessionStorage.removeItem("editMode");
        window.location.href = withSearch("home.html");
    }

    function startNewAccount() {
        sessionStorage.removeItem("editMode");
        localStorage.removeItem(PROFILE_KEY);
        localStorage.removeItem(AVATAR_KEY);
        localStorage.removeItem(USER_ID_KEY);
        window.location.href = withSearch("profile.html");
    }

    window.DOOH_ACCOUNT = {
        hasSavedAccount,
        getSavedAccount,
        routeAfterIntro,
        continueSavedAccount,
        startNewAccount
    };
})();

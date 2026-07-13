(function (global) {
    "use strict";

    const KNOWN_ENDPOINTS = [
        "/profiles/recent",
        "/message-options",
        "/user-messages",
        "/encounters",
        "/encounter",
        "/avatar",
        "/stats",
        "/sync"
    ];

    class DoohApiError extends Error {
        constructor(code, message, details = {}) {
            super(message);
            this.name = "DoohApiError";
            this.code = code;
            this.status = details.status ?? null;
            this.url = details.url || "";
            this.cause = details.cause;
        }
    }

    function isLoopbackHost(hostname) {
        return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    }

    function normalizeApiBaseUrl(value) {
        if (typeof value !== "string" || !value.trim()) {
            return "";
        }

        let parsed;

        try {
            parsed = new URL(value.trim());
        } catch (err) {
            throw new DoohApiError("INVALID_BASE_URL", "API Base URLの形式が正しくありません。", {
                cause: err
            });
        }

        if (!parsed.hostname || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
            throw new DoohApiError("INVALID_BASE_URL", "API Base URLにはhttpまたはhttpsのURLを指定してください。");
        }

        parsed.search = "";
        parsed.hash = "";

        let pathname = parsed.pathname.replace(/\/+$/, "");
        const lowerPath = pathname.toLowerCase();
        const endpoint = KNOWN_ENDPOINTS.find((candidate) => lowerPath.endsWith(candidate));

        if (endpoint) {
            pathname = pathname.slice(0, -endpoint.length).replace(/\/+$/, "");
        }

        parsed.pathname = pathname || "/";

        return parsed.toString().replace(/\/+$/, "");
    }

    function assertPageSecurity(baseUrl) {
        if (!baseUrl) {
            return;
        }

        const parsed = new URL(baseUrl);
        const pageProtocol = global.location?.protocol || "";

        if (pageProtocol === "https:" && parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) {
            throw new DoohApiError(
                "MIXED_CONTENT",
                "HTTPSのWebサイトではHTTPSのAPIを指定してください。"
            );
        }
    }

    function readStorage(key) {
        try {
            return global.localStorage?.getItem(key) || "";
        } catch (err) {
            console.warn("API設定を端末ストレージから読み込めませんでした。", err);
            return "";
        }
    }

    function writeStorage(key, value) {
        try {
            global.localStorage?.setItem(key, value);
        } catch (err) {
            console.warn("API設定を端末ストレージへ保存できませんでした。", err);
        }
    }

    function removeStorage(key) {
        try {
            global.localStorage?.removeItem(key);
        } catch (err) {
            console.warn("不正なAPI設定を端末ストレージから削除できませんでした。", err);
        }
    }

    function resolveApiBaseUrl(config = global.DOOH_CONFIG || {}) {
        const queryKey = config.apiBaseUrlQueryKey || "apiBaseUrl";
        const storageKey = config.apiBaseUrlStorageKey || "dooh_api_base_url";
        const params = new URLSearchParams(global.location?.search || "");
        const queryOverride = params.get(queryKey);

        if (queryOverride && queryOverride.trim()) {
            try {
                const normalizedOverride = normalizeApiBaseUrl(queryOverride);
                assertPageSecurity(normalizedOverride);
                writeStorage(storageKey, normalizedOverride);
                return normalizedOverride;
            } catch (err) {
                console.warn("URLクエリのAPI設定を使用できません。", err.message);
            }
        }

        const storedOverride = readStorage(storageKey);

        if (storedOverride.trim()) {
            try {
                const normalizedOverride = normalizeApiBaseUrl(storedOverride);
                assertPageSecurity(normalizedOverride);
                return normalizedOverride;
            } catch (err) {
                console.warn("保存済みのAPI設定を使用できないため削除します。", err.message);
                removeStorage(storageKey);
            }
        }

        const configuredBaseUrl = normalizeApiBaseUrl(
            config.apiBaseUrl || config.defaultApiBaseUrl || ""
        );
        assertPageSecurity(configuredBaseUrl);
        return configuredBaseUrl;
    }

    function createApiClient(options = {}) {
        const config = options.config || global.DOOH_CONFIG || {};
        const baseUrl = options.baseUrl === undefined
            ? resolveApiBaseUrl(config)
            : normalizeApiBaseUrl(options.baseUrl);
        const timeoutMs = Number(options.timeoutMs ?? config.requestTimeoutMs ?? 8000);
        const fetchImpl = options.fetchImpl || global.fetch?.bind(global);

        assertPageSecurity(baseUrl);

        function buildUrl(path) {
            if (!baseUrl) {
                throw new DoohApiError(
                    "API_NOT_CONFIGURED",
                    "API接続先が設定されていません。DOOH_API_BASE_URLを設定してください。"
                );
            }

            if (typeof path !== "string" || !path.trim()) {
                throw new DoohApiError("INVALID_ENDPOINT", "APIエンドポイントが指定されていません。");
            }

            const endpoint = path.trim().replace(/^\/+/, "");
            return `${baseUrl}/${endpoint}`;
        }

        async function requestJson(path, requestOptions = {}) {
            if (typeof fetchImpl !== "function") {
                throw new DoohApiError("FETCH_UNAVAILABLE", "この環境ではAPI通信を利用できません。");
            }

            const url = buildUrl(path);
            const method = String(requestOptions.method || "GET").toUpperCase();
            const controller = new AbortController();
            const effectiveTimeout = Number(requestOptions.timeoutMs ?? timeoutMs);

            if (!Number.isFinite(effectiveTimeout) || effectiveTimeout <= 0) {
                throw new DoohApiError(
                    "INVALID_TIMEOUT",
                    "API通信のタイムアウト設定が正しくありません。"
                );
            }

            const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);
            const headers = { ...(requestOptions.headers || {}) };
            let body;

            if (requestOptions.body !== undefined) {
                headers["Content-Type"] = headers["Content-Type"] || "application/json";
                body = typeof requestOptions.body === "string"
                    ? requestOptions.body
                    : JSON.stringify(requestOptions.body);
            }

            try {
                let response;

                try {
                    response = await fetchImpl(url, {
                        method,
                        headers,
                        body,
                        signal: controller.signal,
                        cache: "no-store",
                        credentials: "omit"
                    });
                } catch (err) {
                    const timedOut = controller.signal.aborted || err?.name === "AbortError";
                    const code = timedOut ? "TIMEOUT" : "NETWORK_ERROR";
                    const message = timedOut
                        ? "API通信がタイムアウトしました。"
                        : "APIサーバーへ接続できませんでした。";

                    console.error(`[DOOH API] ${method} ${url} -> ${timedOut ? "timeout" : "network error"}`);
                    throw new DoohApiError(code, message, { url, cause: err });
                }

                let responseText;

                try {
                    responseText = await response.text();
                } catch (err) {
                    const timedOut = controller.signal.aborted || err?.name === "AbortError";
                    const code = timedOut ? "TIMEOUT" : "NETWORK_ERROR";
                    const message = timedOut
                        ? "API通信がタイムアウトしました。"
                        : "APIレスポンスを読み取れませんでした。";
                    const result = timedOut ? "timeout" : `${response.status} response read error`;

                    console.error(`[DOOH API] ${method} ${url} -> ${result}`);
                    throw new DoohApiError(code, message, {
                        status: response.status,
                        url,
                        cause: err
                    });
                }
                let data = null;

                if (responseText) {
                    try {
                        data = JSON.parse(responseText);
                    } catch (err) {
                        if (!response.ok) {
                            console.error(`[DOOH API] ${method} ${url} -> ${response.status}`);
                            throw new DoohApiError("HTTP_ERROR", `HTTP ${response.status}`, {
                                status: response.status,
                                url,
                                cause: err
                            });
                        }

                        console.error(`[DOOH API] ${method} ${url} -> ${response.status} invalid JSON`);
                        throw new DoohApiError("INVALID_JSON", "APIから不正なJSONを受信しました。", {
                            status: response.status,
                            url,
                            cause: err
                        });
                    }
                }

                if (!response.ok) {
                    const detail = data && typeof data.detail === "string"
                        ? data.detail
                        : `HTTP ${response.status}`;

                    console.error(`[DOOH API] ${method} ${url} -> ${response.status}`);
                    throw new DoohApiError("HTTP_ERROR", detail, {
                        status: response.status,
                        url
                    });
                }

                return data;
            } finally {
                clearTimeout(timeoutId);
            }
        }

        return {
            baseUrl,
            isConfigured: Boolean(baseUrl),
            buildUrl,
            requestJson,
            get(path, requestOptions) {
                return requestJson(path, { ...requestOptions, method: "GET" });
            },
            post(path, body, requestOptions) {
                return requestJson(path, { ...requestOptions, method: "POST", body });
            },
            delete(path, requestOptions) {
                return requestJson(path, { ...requestOptions, method: "DELETE" });
            }
        };
    }

    global.DOOH_API_CLIENT = Object.assign(createApiClient(), {
        Error: DoohApiError,
        createApiClient,
        normalizeApiBaseUrl,
        resolveApiBaseUrl
    });
})(window);

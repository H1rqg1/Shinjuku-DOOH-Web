const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const rootDir = path.resolve(__dirname, "..");

function createStorage() {
    const values = new Map();

    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        }
    };
}

function createContext() {
    const localStorage = createStorage();
    const window = {
        location: {
            protocol: "https:",
            hostname: "web.example.test",
            search: ""
        },
        localStorage,
        DOOH_CONFIG: {
            apiBaseUrl: "https://api.example.test",
            apiBaseUrlStorageKey: "dooh_api_base_url",
            apiBaseUrlQueryKey: "apiBaseUrl",
            requestTimeoutMs: 100
        },
        crypto: {
            randomUUID() {
                return "test-user";
            }
        }
    };
    const context = {
        window,
        localStorage,
        URL,
        URLSearchParams,
        AbortController,
        setTimeout,
        clearTimeout,
        console: {
            log() {},
            warn() {},
            error() {}
        }
    };

    window.window = window;
    return vm.createContext(context);
}

function loadScript(context, filename) {
    const source = fs.readFileSync(path.join(rootDir, filename), "utf8");
    vm.runInContext(source, context, { filename });
}

function response(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async text() {
            return body;
        }
    };
}

async function run() {
    const context = createContext();
    loadScript(context, "api-client.js");

    const api = context.window.DOOH_API_CLIENT;
    const normalizeCases = [
        ["http://127.0.0.1:8000", "http://127.0.0.1:8000"],
        ["http://127.0.0.1:8000/", "http://127.0.0.1:8000"],
        ["http://127.0.0.1:8000/encounters", "http://127.0.0.1:8000"],
        ["https://example.workers.dev", "https://example.workers.dev"],
        ["https://example.workers.dev/", "https://example.workers.dev"],
        ["https://example.workers.dev/encounters", "https://example.workers.dev"]
    ];

    normalizeCases.forEach(([input, expected]) => {
        assert.strictEqual(api.normalizeApiBaseUrl(input), expected);
    });

    const requestedUrls = [];
    const client = api.createApiClient({
        baseUrl: "https://example.workers.dev/encounters",
        fetchImpl: async (url) => {
            requestedUrls.push(url);
            return response(200, JSON.stringify({ encounters: [] }));
        }
    });

    await client.get("/encounters");
    await client.get("/stats");
    assert.deepStrictEqual(requestedUrls, [
        "https://example.workers.dev/encounters",
        "https://example.workers.dev/stats"
    ]);

    const unconfiguredClient = api.createApiClient({ baseUrl: "", fetchImpl: async () => response(200, "{}") });
    assert.throws(() => unconfiguredClient.buildUrl("/stats"), err => err.code === "API_NOT_CONFIGURED");

    const invalidJsonClient = api.createApiClient({
        baseUrl: "https://api.example.test",
        fetchImpl: async () => response(200, "not-json")
    });
    await assert.rejects(invalidJsonClient.get("/stats"), err => err.code === "INVALID_JSON");

    const httpErrorClient = api.createApiClient({
        baseUrl: "https://api.example.test",
        fetchImpl: async () => response(503, JSON.stringify({ detail: "unavailable" }))
    });
    await assert.rejects(
        httpErrorClient.get("/stats"),
        err => err.code === "HTTP_ERROR" && err.status === 503 && err.url.endsWith("/stats")
    );

    const htmlHttpErrorClient = api.createApiClient({
        baseUrl: "https://api.example.test",
        fetchImpl: async () => response(502, "<html>Bad Gateway</html>")
    });
    await assert.rejects(
        htmlHttpErrorClient.get("/stats"),
        err => err.code === "HTTP_ERROR" && err.status === 502 && err.message === "HTTP 502"
    );

    const networkErrorClient = api.createApiClient({
        baseUrl: "https://api.example.test",
        fetchImpl: async () => {
            throw new Error("offline");
        }
    });
    await assert.rejects(networkErrorClient.get("/stats"), err => err.code === "NETWORK_ERROR");

    const timeoutClient = api.createApiClient({
        baseUrl: "https://api.example.test",
        timeoutMs: 5,
        fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener("abort", () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
            });
        })
    });
    await assert.rejects(timeoutClient.get("/stats"), err => err.code === "TIMEOUT");

    const bodyTimeoutClient = api.createApiClient({
        baseUrl: "https://api.example.test",
        timeoutMs: 5,
        fetchImpl: async (_url, options) => ({
            ok: true,
            status: 200,
            text() {
                return new Promise((_resolve, reject) => {
                    options.signal.addEventListener("abort", () => {
                        const error = new Error("body read aborted");
                        error.name = "AbortError";
                        reject(error);
                    });
                });
            }
        })
    });
    await assert.rejects(bodyTimeoutClient.get("/stats"), err => err.code === "TIMEOUT");

    const invalidTimeoutClient = api.createApiClient({
        baseUrl: "https://api.example.test",
        timeoutMs: 0,
        fetchImpl: async () => response(200, "{}")
    });
    await assert.rejects(
        invalidTimeoutClient.get("/stats"),
        err => err.code === "INVALID_TIMEOUT"
    );

    context.window.localStorage.setItem("dooh_api_base_url", "invalid-url");
    const recoveredClient = api.createApiClient();
    assert.strictEqual(recoveredClient.baseUrl, "https://api.example.test");
    assert.strictEqual(context.window.localStorage.getItem("dooh_api_base_url"), null);

    loadScript(context, "api.js");
    const webApi = context.window.DOOH_WEB_API;
    const directEncounters = [{ my_id: "dooh_pc", target_id: null, timestamp: null }];

    assert.strictEqual(webApi.normalizeEncountersResponse(directEncounters)[0].target_id, null);
    assert.strictEqual(webApi.normalizeEncountersResponse({ encounters: directEncounters })[0].my_id, "dooh_pc");
    assert.throws(
        () => webApi.normalizeEncountersResponse({ items: [] }),
        err => err.code === "INVALID_RESPONSE"
    );

    const stats = {
        date_jst: "2026-07-13",
        time_jst: "10:00",
        daily_detected_count: 12,
        daily_encounter_count: 30,
        extra_field: true
    };
    assert.strictEqual(webApi.normalizeStatsResponse(stats).extra_field, true);
    assert.throws(
        () => webApi.normalizeStatsResponse({ ...stats, daily_encounter_count: "30" }),
        err => err.code === "INVALID_RESPONSE"
    );

    const syncContext = createContext();
    let syncPostCount = 0;
    let releaseSyncPost;
    const syncPostGate = new Promise(resolve => {
        releaseSyncPost = resolve;
    });

    syncContext.window.DOOH_API_CLIENT = {
        Error: class TestApiError extends Error {},
        async post(path, payload) {
            assert.strictEqual(path, "/sync");
            assert.strictEqual(payload.avatar_code, "00020000");
            syncPostCount += 1;
            await syncPostGate;
            return { encounter_count: syncPostCount };
        }
    };
    syncContext.localStorage.setItem("profile", JSON.stringify({
        nickname: "Test User",
        messageIds: ["talk_hello"],
        interestIds: [],
        interests: []
    }));
    syncContext.localStorage.setItem("avatar", JSON.stringify({
        outfit: { id: 2, name: "outfit", image: "image/clothes/outfit2.png" },
        hat: { id: 2, name: "none", image: "" },
        accessory: { id: 2, name: "none", image: "" }
    }));
    loadScript(syncContext, "api.js");

    const firstSync = vm.runInContext("syncToServer()", syncContext);
    const concurrentSync = vm.runInContext("syncToServer()", syncContext);
    assert.strictEqual(syncPostCount, 1);

    releaseSyncPost();
    const syncResults = await Promise.all([firstSync, concurrentSync]);
    assert.strictEqual(syncResults[0].ok, true);
    assert.strictEqual(syncResults[1].ok, true);
    assert.strictEqual(syncPostCount, 1);

    const laterSync = await vm.runInContext("syncToServer()", syncContext);
    assert.strictEqual(laterSync.ok, true);
    assert.strictEqual(syncPostCount, 2);

    console.log("API client tests passed.");
}

run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});

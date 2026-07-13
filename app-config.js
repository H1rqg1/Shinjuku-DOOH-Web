// Local source configuration used when FastAPI serves the repository directly.
// Cloudflare builds generate public/app-config.js from DOOH_API_BASE_URL.
window.DOOH_CONFIG = Object.freeze({
    apiBaseUrl: "http://127.0.0.1:8000",
    apiBaseUrlStorageKey: "dooh_api_base_url",
    apiBaseUrlQueryKey: "apiBaseUrl",
    requestTimeoutMs: 8000
});

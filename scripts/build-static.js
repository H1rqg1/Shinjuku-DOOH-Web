const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "public");
const entries = [
    "index.html",
    "home.html",
    "login.html",
    "profile.html",
    "avatar.html",
    "complete.html",
    "style.css",
    "account.js",
    "api-client.js",
    "api.js",
    "home.js",
    "script.js",
    "avatar.js",
    "image"
];

function readBuildApiConfig() {
    const apiBaseUrl = String(process.env.DOOH_API_BASE_URL || "").trim();
    const timeoutValue = Number(process.env.DOOH_API_TIMEOUT_MS || 8000);

    if (apiBaseUrl) {
        let parsed;

        try {
            parsed = new URL(apiBaseUrl);
        } catch (err) {
            throw new Error("DOOH_API_BASE_URL must be an absolute HTTP(S) URL.");
        }

        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new Error("DOOH_API_BASE_URL must use HTTP or HTTPS.");
        }

        const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);

        if (parsed.protocol !== "https:" && !isLoopback) {
            throw new Error("A non-local DOOH_API_BASE_URL must use HTTPS.");
        }
    }

    if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
        throw new Error("DOOH_API_TIMEOUT_MS must be a positive number.");
    }

    return {
        apiBaseUrl,
        apiBaseUrlStorageKey: "dooh_api_base_url",
        apiBaseUrlQueryKey: "apiBaseUrl",
        requestTimeoutMs: timeoutValue
    };
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

function copyEntry(source, target) {
    const stat = fs.statSync(source);

    if (stat.isDirectory()) {
        fs.mkdirSync(target, { recursive: true });

        for (const child of fs.readdirSync(source)) {
            copyEntry(path.join(source, child), path.join(target, child));
        }

        return;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
}

for (const entry of entries) {
    const source = path.join(rootDir, entry);
    const target = path.join(outputDir, entry);

    if (!fs.existsSync(source)) {
        throw new Error(`Missing static asset: ${entry}`);
    }

    copyEntry(source, target);
}

const buildConfig = readBuildApiConfig();
const generatedConfig = `window.DOOH_CONFIG = Object.freeze(${JSON.stringify(buildConfig)});\n`;

fs.writeFileSync(path.join(outputDir, "app-config.js"), generatedConfig, "utf8");

console.log(`Copied ${entries.length + 1} static entries to public/`);
console.log(`DOOH API configuration: ${buildConfig.apiBaseUrl ? "configured" : "not configured"}`);

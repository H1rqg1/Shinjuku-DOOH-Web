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
    "app-config.js",
    "account.js",
    "api.js",
    "home.js",
    "script.js",
    "avatar.js",
    "image"
];

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

console.log(`Copied ${entries.length} static entries to public/`);

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const rootDir = path.resolve(__dirname, "..");

function createStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
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

function loadScript(context, filename) {
    const source = fs.readFileSync(path.join(rootDir, filename), "utf8");
    vm.runInContext(source, context, { filename });
}

function assertInlineScriptsParse(filename) {
    const source = fs.readFileSync(path.join(rootDir, filename), "utf8");
    const scripts = [...source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
    assert.ok(scripts.length > 0, `${filename} should contain an inline script`);

    scripts.forEach((match, index) => {
        new vm.Script(match[1], { filename: `${filename}:inline-${index + 1}` });
    });
}

async function testAdminClient() {
    const calls = [];
    const sessionStorage = createStorage({ dooh_admin_username: "administrator" });
    const client = {
        isConfigured: true,
        async post(endpoint, body, options) {
            calls.push({ method: "POST", endpoint, body, options });
            if (endpoint === "/admin/login") {
                return { token: "signed-token", token_type: "bearer", expires_at: 1 };
            }
            return { message: "ok" };
        },
        async get(endpoint, options) {
            calls.push({ method: "GET", endpoint, options });
            return endpoint === "/admin/users" ? { users: [] } : { total_views: 0 };
        },
        async delete(endpoint, options) {
            calls.push({ method: "DELETE", endpoint, options });
            return { message: "deleted" };
        }
    };
    const window = { DOOH_API_CLIENT: client, sessionStorage };
    const context = vm.createContext({ window, encodeURIComponent });

    loadScript(context, "admin.js");
    await window.DOOH_ADMIN.login("administrator", "test-password");
    assert.strictEqual(sessionStorage.getItem("dooh_admin_token"), "signed-token");
    assert.strictEqual(window.DOOH_ADMIN.hasSession(), true);

    await window.DOOH_ADMIN.getUsers();
    await window.DOOH_ADMIN.getMetrics();
    await window.DOOH_ADMIN.forceLogout("user/id");
    await window.DOOH_ADMIN.deleteUser("user/id");

    const protectedCalls = calls.filter(call => call.endpoint !== "/admin/login");
    assert.ok(protectedCalls.every(call => call.options.headers.Authorization === "Bearer signed-token"));
    assert.ok(calls.some(call => call.endpoint === "/admin/users/user%2Fid/logout"));
    assert.ok(calls.some(call => call.endpoint === "/admin/users/user%2Fid"));

    window.DOOH_ADMIN.logout();
    assert.strictEqual(window.DOOH_ADMIN.hasSession(), false);
}

async function testSiteControl() {
    const calls = [];
    const alerts = [];
    let replacedUrl = "";
    let accountStatus = { status: "active", revision: 0 };
    const localStorage = createStorage({
        user_id: "web-user",
        profile: "{}",
        avatar: "{}"
    });
    const sessionStorage = createStorage();
    const client = {
        isConfigured: true,
        async post(endpoint, body) {
            calls.push({ endpoint, body });
            if (endpoint === "/admin/identify") {
                return { admin_required: body.username === "DOOH-IPUT-IS-IDIOT-TEAM-K" };
            }
            if (endpoint === "/account/session") {
                return accountStatus;
            }
            return { recorded: true };
        }
    };
    const window = {
        DOOH_API_CLIENT: client,
        localStorage,
        sessionStorage,
        crypto: { randomUUID: () => "browser-session" },
        document: { readyState: "complete" },
        location: {
            pathname: "/home.html",
            search: "?apiBaseUrl=test",
            replace(value) {
                replacedUrl = value;
            }
        },
        setInterval() {},
        alert(message) {
            alerts.push(message);
        }
    };
    const context = vm.createContext({ window, console, Date, Math });

    loadScript(context, "site-control.js");
    await new Promise(resolve => setImmediate(resolve));

    assert.ok(calls.some(call => call.endpoint === "/analytics/view" && call.body.path === "/home.html"));
    assert.ok(calls.some(call => call.endpoint === "/account/session"));
    assert.strictEqual(localStorage.getItem("dooh_account_session_id"), "browser-session");
    assert.strictEqual(
        await window.DOOH_SITE_CONTROL.isAdminUsername("DOOH-IPUT-IS-IDIOT-TEAM-K"),
        true
    );
    assert.strictEqual(
        await window.DOOH_SITE_CONTROL.isAdminUsername("ordinary-user"),
        false
    );

    accountStatus = { status: "force_logout", revision: 1 };
    await window.DOOH_SITE_CONTROL.checkAccountSession();
    assert.strictEqual(localStorage.getItem("user_id"), null);
    assert.strictEqual(localStorage.getItem("profile"), null);
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(replacedUrl, "index.html?apiBaseUrl=test");

    client.isConfigured = false;
    assert.strictEqual(
        await window.DOOH_SITE_CONTROL.isAdminUsername("DOOH-IPUT-IS-IDIOT-TEAM-K"),
        true
    );
}

async function run() {
    assertInlineScriptsParse("admin-login.html");
    assertInlineScriptsParse("admin.html");
    await testAdminClient();
    await testSiteControl();
    console.log("Admin client tests passed.");
}

run().catch(err => {
    console.error(err);
    process.exitCode = 1;
});

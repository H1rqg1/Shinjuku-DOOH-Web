const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const rootDir = path.resolve(__dirname, "..");
const values = new Map([
    ["avatar", JSON.stringify({
        outfit: { id: 2, name: "old outfit", image: "old.png" },
        hat: { id: 1, name: "old hat", image: "image/hat/hat1.png" },
        accessory: { id: 1, name: "old accessory", image: "old.png" }
    })]
]);
const localStorage = {
    getItem(key) {
        return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
        values.set(key, String(value));
    }
};
const sessionStorage = {
    getItem(key) {
        return key === "editMode" ? "true" : null;
    }
};
const preview = {
    innerHTML: "",
    appendChild() {}
};
const document = {
    getElementById(id) {
        return id === "preview" ? preview : null;
    },
    createElement() {
        return {};
    },
    addEventListener() {}
};
const window = {
    addEventListener() {},
    onload: null
};
const context = vm.createContext({
    console,
    document,
    localStorage,
    sessionStorage,
    window
});

const avatarSource = fs.readFileSync(path.join(rootDir, "avatar.js"), "utf8");
vm.runInContext(avatarSource, context, { filename: "avatar.js" });
vm.runInContext("initAvatar()", context);

const outfitIds = JSON.parse(vm.runInContext("JSON.stringify(avatarData.outfit.map(item => item.id))", context));
assert.deepStrictEqual(outfitIds, [1, 2, 3]);

for (const type of ["hat", "accessory"]) {
    const slots = JSON.parse(vm.runInContext(
        `JSON.stringify(avatarData.${type}.map(item => ({ id: item.id, name: item.name, image: item.image })))`,
        context
    ));
    assert.deepStrictEqual(slots.map(item => item.id), [0, 1, 2]);
    assert.ok(slots.every(item => item.name === "\u306a\u3057"));
    assert.ok(slots.every(item => item.image === ""));
}

const normalized = JSON.parse(localStorage.getItem("avatar"));
assert.deepStrictEqual(Object.keys(normalized), ["outfit", "hat", "accessory"]);
assert.strictEqual(normalized.outfit.id, 2);
assert.strictEqual(normalized.outfit.image, "image/clothes/outfit2.png");
assert.strictEqual(normalized.hat.id, 1);
assert.strictEqual(normalized.hat.image, "");
assert.strictEqual(normalized.accessory.id, 1);
assert.strictEqual(normalized.accessory.image, "");

localStorage.setItem("avatar", JSON.stringify({
    outfit: { id: 99 },
    hat: { id: 99 },
    accessory: { id: 99 }
}));
vm.runInContext("loadAvatar(); saveAvatar()", context);
const fallback = JSON.parse(localStorage.getItem("avatar"));
assert.strictEqual(fallback.outfit.id, 1);
assert.strictEqual(fallback.hat.id, 0);
assert.strictEqual(fallback.accessory.id, 0);

const avatarHtml = fs.readFileSync(path.join(rootDir, "avatar.html"), "utf8");
assert.ok(avatarHtml.includes("openModal('hat')"));
assert.ok(avatarHtml.includes("openModal('accessory')"));
assert.ok(!avatarSource.includes("image/hat"));
assert.ok(!avatarSource.includes("image/accessory"));

const outfitFiles = fs.readdirSync(path.join(rootDir, "image", "clothes"));
assert.deepStrictEqual(outfitFiles.sort(), ["outfit1.png", "outfit2.png", "outfit3.png"]);
assert.ok(!fs.existsSync(path.join(rootDir, "image", "hat")));

const apiContext = vm.createContext({
    console,
    localStorage,
    window: {
        DOOH_API_CLIENT: {
            Error: class DoohApiError extends Error {},
            get() {},
            post() {}
        }
    }
});
const apiSource = fs.readFileSync(path.join(rootDir, "api.js"), "utf8");
vm.runInContext(apiSource, apiContext, { filename: "api.js" });
assert.match(apiSource, /buildAvatarCode\(\s*outfitId,\s*0,\s*0\s*\)/);

for (const id of [1, 2, 3]) {
    assert.strictEqual(
        vm.runInContext(`buildAvatarCode(${id}, 0, 0)`, apiContext),
        String(id).padStart(4, "0") + "0000"
    );
    assert.strictEqual(
        vm.runInContext(`buildCostumeId(${id})`, apiContext),
        "costume_fashion" + String(id).padStart(2, "0")
    );
}

console.log("Avatar coordinate tests passed.");

// =============================
// avatar.js（前半）
// =============================

// -----------------------------
// アバター状態
// -----------------------------

const avatar = {
    outfit: null,
    hat: null,
    accessory: null
};

// -----------------------------
// データ
// -----------------------------

const avatarData = {

    outfit: [
        {
            id: 1,
            name: "コーデ1",
            image: "image/clothes/outfit1.png"
        },

        {
            id: 2,
            name: "コーデ2",
            image: "image/clothes/outfit2.png"
        },

        {
            id: 3,
            name: "コーデ3",
            image: "image/clothes/outfit3.png"
        }
    ],

    hat: [
        { id: 0, name: "なし", image: "" },
        { id: 1, name: "なし", image: "" },
        { id: 2, name: "なし", image: "" }
    ],

    accessory: [
        { id: 0, name: "なし", image: "" },
        { id: 1, name: "なし", image: "" },
        { id: 2, name: "なし", image: "" }
    ]

};

// -----------------------------
// 初期化
// -----------------------------

function initAvatar() {

    avatar.outfit = avatarData.outfit[0];
    avatar.hat = avatarData.hat[0];
    avatar.accessory = avatarData.accessory[0];

    // 編集モード（ホームから来た場合）は保存済みの内容を復元する
    if (sessionStorage.getItem("editMode")) {

        loadAvatar();

    }

    saveAvatar();

    updatePreview();

}

// -----------------------------
// モーダルを開く
// -----------------------------

function openModal(type) {

    if (!avatarData[type]) {

        return;

    }

    const modal = document.getElementById("modal");
    const list = document.getElementById("modalList");
    const title = document.getElementById("modalTitle");

    list.innerHTML = "";

    const titles = {
        outfit: "コーデを選択",
        hat: "帽子を選択",
        accessory: "アクセサリーを選択"
    };

    title.textContent = titles[type];

    avatarData[type].forEach(item=>{

        const button=document.createElement("button");

        button.className="option-button";

        if(item.image!==""){

            const img=document.createElement("img");

            img.src=item.image;
            img.className="option-image";

            img.onerror=function(){

                const placeholder=document.createElement("div");

                placeholder.className="option-placeholder";
                placeholder.textContent="準備中";

                this.replaceWith(placeholder);

            };

            const label=document.createElement("div");

            label.textContent=item.name;

            button.appendChild(img);
            button.appendChild(label);

        }else{

            const placeholder=document.createElement("div");
            placeholder.className="option-placeholder";
            placeholder.setAttribute("aria-hidden", "true");

            const label=document.createElement("div");
            label.textContent=item.name;

            button.appendChild(placeholder);
            button.appendChild(label);

        }

        const current=avatar[type];

        if(current&&current.id===item.id){

            button.classList.add("selected");

        }

        button.onclick=()=>{

            avatar[type]=item;

            saveAvatar();

            updatePreview();

            closeModal();

        };

        list.appendChild(button);

    });

    modal.style.display="flex";

}

// -----------------------------
// モーダルを閉じる
// -----------------------------

function closeModal(){

    document.getElementById("modal").style.display="none";

}

// -----------------------------
// 保存
// -----------------------------

function saveAvatar(){

    localStorage.setItem(
        "avatar",
        JSON.stringify(avatar)
    );

}

// -----------------------------
// 読み込み
// -----------------------------

function loadAvatar(){

    const json=localStorage.getItem("avatar");

    if(!json){

        return;

    }

    const save=JSON.parse(json);

    Object.keys(avatarData).forEach(type=>{

        const savedId=Number(save?.[type]?.id);

        avatar[type]=avatarData[type].find(item=>item.id===savedId)
            || avatarData[type][0];

    });

}

// -----------------------------
// プレビュー更新
// -----------------------------

function updatePreview(){

    const preview=document.getElementById("preview");

    preview.innerHTML="";

    const base=document.createElement("img");

    base.src="image/sample.png";
    base.className="base-avatar";

    base.onerror=function(){

        this.remove();

    };

    preview.appendChild(base);

    drawLayer(preview,avatar.outfit);
    drawLayer(preview,avatar.accessory);
    drawLayer(preview,avatar.hat);

}

// -----------------------------
// レイヤー描画
// -----------------------------

function drawLayer(parent,data){

    if(!data){

        return;

    }

    if(data.image===""){

        return;

    }

    const img=document.createElement("img");

    img.src=data.image;

    img.className="avatar-layer";

    img.onerror=function(){

        this.remove();

    };

    parent.appendChild(img);

}
// =============================
// avatar.js（後半）
// =============================

// -----------------------------
// 選択状態表示
// -----------------------------

function updateSelectedText() {

    const outfit = document.getElementById("selectedOutfit");
    const hat = document.getElementById("selectedHat");
    const accessory = document.getElementById("selectedAccessory");

    if (outfit) {
        outfit.textContent = avatar.outfit
            ? avatar.outfit.name
            : "なし";
    }

    if (hat) {
        hat.textContent = avatar.hat ? avatar.hat.name : "なし";
    }

    if (accessory) {
        accessory.textContent = avatar.accessory ? avatar.accessory.name : "なし";
    }

}

// -----------------------------
// リセット
// -----------------------------

function resetAvatar() {

    avatar.outfit = avatarData.outfit[0];
    avatar.hat = avatarData.hat[0];
    avatar.accessory = avatarData.accessory[0];

    saveAvatar();

    updatePreview();

    updateSelectedText();

}

// -----------------------------
// 完了画面へ
// -----------------------------

async function goToComplete() {

    saveAvatar();

    // 編集モード（ホームから来た場合）はホームに直接戻る
    // このタイミングでプロフィール情報もすでに保存済みのはずなので
    // ここでFastAPIへ保存する
    if (sessionStorage.getItem("editMode")) {

        const result = await syncToServer();

        alert(result.message);

        window.location.href = "home.html";

        return;

    }

    window.location.href = "complete.html";

}

// -----------------------------
// 完了画面読み込み
// -----------------------------

function loadCompleteAvatar() {

    const preview = document.getElementById("preview");

    if (!preview) {

        return;

    }

    loadAvatar();

    updatePreview();

}

// -----------------------------
// モーダル外クリック
// -----------------------------

window.addEventListener("click", function (event) {

    const modal = document.getElementById("modal");

    if (!modal) {

        return;

    }

    if (event.target === modal) {

        closeModal();

    }

});

// -----------------------------
// Escキーで閉じる
// -----------------------------

document.addEventListener("keydown", function (event) {

    if (event.key === "Escape") {

        closeModal();

    }

});

// -----------------------------
// デバッグ用
// -----------------------------

function printAvatar() {

    console.log("現在のアバター");

    console.log(avatar);

}

// -----------------------------
// パーツ追加用関数
// -----------------------------

function addItem(type, item) {

    if (!avatarData[type]) {

        return;

    }

    avatarData[type].push(item);

}

// -----------------------------
// パーツ削除用
// -----------------------------

function removeItem(type, id) {

    if (!avatarData[type]) {

        return;

    }

    avatarData[type] = avatarData[type].filter(item => {

        return item.id !== id;

    });

}

// -----------------------------
// id検索
// -----------------------------

function findItem(type, id) {

    if (!avatarData[type]) {

        return null;

    }

    return avatarData[type].find(item => {

        return item.id === id;

    });

}

// -----------------------------
// ランダムコーデ
// -----------------------------

function randomAvatar() {

    avatar.outfit =
        avatarData.outfit[
            Math.floor(
                Math.random() * avatarData.outfit.length
            )
        ];

    saveAvatar();

    updatePreview();

    updateSelectedText();

}

// -----------------------------
// ページ読み込み
// -----------------------------

window.onload = function () {

    initAvatar();

    updateSelectedText();

};

// =============================
// End
// =============================

//==============================
// DOM取得
//==============================

const modal = document.getElementById("wordModal");
const openButton = document.getElementById("openWordModal");
const closeButton = document.getElementById("closeModal");

const wordList = document.getElementById("wordList");
const selectedArea = document.getElementById("selectedWords");


//==============================
// 一言データ（フォールバック用）
// FastAPIの GET /message-options が取得できなかった場合に使う
// ※ このIDはローカル専用の仮IDです。サーバー側のmessage_idとは
//    一致しない可能性があるため、できるだけAPIからの取得を優先します。
//==============================

const fallbackCategories = [

    {
        title: "👋 あいさつ",
        words: [
            { id: "local_greet_1", text: "こんにちは！" },
            { id: "local_greet_2", text: "こんばんは！" },
            { id: "local_greet_3", text: "おはようございます！" },
            { id: "local_greet_4", text: "お疲れさまです！" },
            { id: "local_greet_5", text: "今日もいい日ですね！" },
            { id: "local_greet_6", text: "良い一日を！" },
            { id: "local_greet_7", text: "ごゆっくりどうぞ！" },
            { id: "local_greet_8", text: "ようこそ！" }
        ]
    },

    {
        title: "😊 気分",
        words: [
            { id: "local_mood_1", text: "ごきげんです" },
            { id: "local_mood_2", text: "元気です！" },
            { id: "local_mood_3", text: "のんびりしています" },
            { id: "local_mood_4", text: "わくわくしています" },
            { id: "local_mood_5", text: "リラックスしています" },
            { id: "local_mood_6", text: "少し眠いです" },
            { id: "local_mood_7", text: "穏やかな気分です" },
            { id: "local_mood_8", text: "今日は調子がいいです" },
            { id: "local_mood_9", text: "気楽に過ごしています" },
            { id: "local_mood_10", text: "笑顔です" }
        ]
    },

    {
        title: "🎵 今の様子",
        words: [
            { id: "local_status_1", text: "移動中です" },
            { id: "local_status_2", text: "休憩中です" },
            { id: "local_status_3", text: "待ち時間です" },
            { id: "local_status_4", text: "音楽を聴いています" },
            { id: "local_status_5", text: "景色を楽しんでいます" },
            { id: "local_status_6", text: "読書中です" },
            { id: "local_status_7", text: "お散歩中です" },
            { id: "local_status_8", text: "カフェでゆっくりしています" },
            { id: "local_status_9", text: "ひと休みしています" },
            { id: "local_status_10", text: "ぼーっとしています" }
        ]
    },

    {
        title: "🌱 性格",
        words: [
            { id: "local_trait_1", text: "マイペースです" },
            { id: "local_trait_2", text: "のんびり派です" },
            { id: "local_trait_3", text: "静かな時間が好きです" },
            { id: "local_trait_4", text: "好奇心旺盛です" },
            { id: "local_trait_5", text: "前向きです" },
            { id: "local_trait_6", text: "ゆったり過ごしています" },
            { id: "local_trait_7", text: "楽しいことが好きです" },
            { id: "local_trait_8", text: "コツコツ派です" },
            { id: "local_trait_9", text: "新しいことが好きです" },
            { id: "local_trait_10", text: "聞き役が多いです" }
        ]
    }

];

// カテゴリキー → 見出し表示用（APIから取得した場合に使用）

const categoryTitleMap = {
    talk: "👋 あいさつ・トーク",
    mood: "😊 気分",
    status: "🎵 今の様子",
    trait: "🌱 性格"
};

// 実際に画面に表示するカテゴリ一覧（初期化時にセットされる）

let categories = fallbackCategories;


//==============================
// 選択中（{ id, text } の配列）
//==============================

let selectedWords = [];


//==============================
// モーダル
//==============================

openButton.addEventListener("click", () => {

    modal.style.display = "flex";

});

closeButton.addEventListener("click", () => {

    modal.style.display = "none";

});

modal.addEventListener("click", (event) => {

    if (event.target === modal) {

        modal.style.display = "none";

    }

});


//==============================
// APIから取得したメッセージをカテゴリ形式に変換
//==============================

function buildCategoriesFromApi(messages) {

    const grouped = {};

    messages

        .filter(m => m.enabled !== false)

        .forEach(m => {

            const key = m.category || "other";

            if (!grouped[key]) {

                grouped[key] = [];

            }

            grouped[key].push({ id: m.message_id, text: m.text });

        });

    return Object.keys(grouped).map(key => ({
        title: categoryTitleMap[key] || key,
        words: grouped[key]
    }));

}


//==============================
// 候補生成
//==============================

function createWordButtons() {

    wordList.innerHTML = "";

    categories.forEach(category => {

        const section = document.createElement("div");
        section.className = "category";

        const title = document.createElement("div");
        title.className = "category-title";
        title.textContent = category.title;

        section.appendChild(title);

        const list = document.createElement("div");
        list.className = "word-list";

        category.words.forEach(word => {

            const button = document.createElement("button");

            button.type = "button";

            button.className = "word-button";

            button.textContent = word.text;

            button.dataset.id = word.id;
            button.dataset.word = word.text;

            button.addEventListener("click", () => {

                toggleWord(word, button);

            });

            list.appendChild(button);

        });

        section.appendChild(list);

        wordList.appendChild(section);

    });

}


//==============================
// 選択処理
//==============================

function toggleWord(word, button) {

    const index = selectedWords.findIndex(w => w.id === word.id);

    //解除

    if (index !== -1) {

        selectedWords.splice(index, 1);

        button.classList.remove("selected");

        updateSelectedWords();

        return;

    }

    //3つまで

    if (selectedWords.length >= 3) {

        alert("今のひとことは3つまで選択できます。");

        return;

    }

    selectedWords.push(word);

    button.classList.add("selected");

    updateSelectedWords();

}


//==============================
// 選択表示
//==============================

function updateSelectedWords() {

    selectedArea.innerHTML = "";

    if (selectedWords.length === 0) {

        const p = document.createElement("p");

        p.className = "placeholder";

        p.textContent = "まだ選択されていません";

        selectedArea.appendChild(p);

        return;

    }

    selectedWords.forEach(word => {

        const chip = document.createElement("div");

        chip.className = "word-chip";

        chip.textContent = word.text;

        selectedArea.appendChild(chip);

    });

}


//==============================
// 編集モード：既存データの復元
//==============================

function prefillProfile() {

    if (!sessionStorage.getItem("editMode")) {

        return;

    }

    const saved = JSON.parse(localStorage.getItem("profile"));

    if (!saved) {

        return;

    }

    document.getElementById("nickname").value = saved.nickname || "";
    document.getElementById("age").value = saved.age || "";

    if (Array.isArray(saved.words) && Array.isArray(saved.messageIds)) {

        saved.words.forEach((text, i) => {

            selectedWords.push({
                id: saved.messageIds[i],
                text
            });

        });

        updateSelectedWords();

        document.querySelectorAll(".word-button").forEach(button => {

            if (selectedWords.some(w => w.id === button.dataset.id)) {

                button.classList.add("selected");

            }

        });

    }

}


//==============================
// 初期化
// できればFastAPIからメッセージ候補を取得し、
// 取得できなければローカルの候補を使う
//==============================

async function initMessageOptions() {

    const apiMessages = await fetchMessageOptions();

    if (apiMessages && apiMessages.length > 0) {

        categories = buildCategoriesFromApi(apiMessages);

    } else {

        categories = fallbackCategories;

    }

    createWordButtons();

    updateSelectedWords();

    prefillProfile();

}

initMessageOptions();

// =============================
// 入力値チェック → 遷移
// =============================

async function goToAvatar() {

    const nickname = document.getElementById("nickname").value.trim();
    const age = document.getElementById("age").value.trim();

    // =============================
    // バリデーション
    // =============================

    if (nickname === "") {
        alert("ニックネームを入力してください");
        return;
    }

    if (age === "") {
        alert("年齢を入力してください");
        return;
    }

    if (selectedWords.length === 0) {
        alert("一言を1つ以上選択してください");
        return;
    }

    // =============================
    // 保存（次画面用）
    // =============================

    const profileData = {
        nickname,
        age,
        words: selectedWords.map(w => w.text),
        messageIds: selectedWords.map(w => w.id)
    };

    localStorage.setItem("profile", JSON.stringify(profileData));

    // =============================
    // 遷移
    // =============================

    // 編集モード（ホームから来た場合）はホームに直接戻る
    // このタイミングでアバター情報もすでに保存済みのはずなので
    // ここでFastAPIへ保存する
    if (sessionStorage.getItem("editMode")) {

        const result = await syncToServer();

        alert(result.message);

        window.location.href = "home.html";

        return;

    }

    window.location.href = "avatar.html";

}
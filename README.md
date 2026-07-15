# Shinjuku-DOOH-Web

Shinjuku DOOH Unityプロジェクトで使用する、静的WebアプリケーションとFastAPIブリッジです。

## プロジェクト構成

- 画面: フレームワークを使わないHTML/CSS/JavaScript
- Web向けAPI処理: `api.js`
- HTTP通信、URL生成、タイムアウト、JSON/HTTPエラー処理: `api-client.js`
- 環境設定: `app-config.js`
- ローカルAPI: `server/app.py` (FastAPI)
- 静的ビルド: `scripts/build-static.js`
- 公開: Cloudflare Workers Static Assets (`wrangler.toml`)

## API Base URL

採用するビルド環境変数は次のとおりです。

```text
DOOH_API_BASE_URL
```

任意で通信タイムアウトも変更できます。

```text
DOOH_API_TIMEOUT_MS=8000
```

`DOOH_API_BASE_URL` はBase URLだけを指定してください。誤って
`/encounters` や `/stats` まで指定した場合もクライアント側でBase URLへ
正規化しますが、運用上は付けないでください。

### Local

ローカル値:

```text
http://127.0.0.1:8000
```

FastAPIがリポジトリ直下の静的ファイルを配信するローカル実行では、追跡済みの
`app-config.js`からこの値を使用します。`npm run build`で生成する`public/`版は
ホスト名から自動推測せず、ビルド環境変数を明示してください。

ビルド時に指定する場合はPowerShellで次を実行します。

```powershell
$env:DOOH_API_BASE_URL = "http://127.0.0.1:8000"
npm run build
```

`.env.example` は設定名とローカル値のサンプルです。このプロジェクトは
`.env.local` を自動読込しないため、値は実行シェルまたはデプロイサービスの
ビルド環境変数へ設定してください。`.env` と `.env.*` は
`.env.example` を除いてGit管理外です。

### Production

本番API URLはまだ確定していません。実在しないplaceholderは公開ビルドへ
設定しないでください。

本番URLが決まったら、CloudflareのGitHubビルド環境へ次を追加します。

```text
DOOH_API_BASE_URL=https://<confirmed-api-host>
```

これはWorker実行時ではなく、`npm run build` が実行されるビルド環境で必要です。
公開ホスト上で値が未設定の場合、WebアプリはローカルAPIへ暗黙接続せず、
端末内フォールバックと分かりやすい接続エラーを使用します。

一時的な接続先の確認には、既存のクエリ指定も利用できます。

```text
https://<web-host>/?apiBaseUrl=https://<api-host>
```

正規化された値はブラウザーの `localStorage` に
`dooh_api_base_url` として保存されます。HTTPSの公開ページから、
ループバック以外のHTTP APIを指定することはできません。

## ローカル起動

```powershell
python -m pip install -r server\requirements.txt
python -m uvicorn server.app:app --host 127.0.0.1 --port 8000 --reload
```

Webアプリ:

```text
http://127.0.0.1:8000/home.html
```

Unityが使用するBase URL:

```text
http://127.0.0.1:8000
```

既存の主要エンドポイント:

```text
POST   /encounter
GET    /encounters
GET    /stats
DELETE /encounters
```

## 検証とビルド

```powershell
npm run check
npm test
python scripts/test-server-integration.py
npm run build
```

`npm run build` は公開対象だけを `public/` へ生成し、ビルド時の
`DOOH_API_BASE_URL` を `public/app-config.js` へ注入します。生成された
`public/` はGit管理外です。

`scripts/test-server-integration.py` は一時データディレクトリ上でUvicornを
起動し、BLE互換の `POST /encounter`、Webの `POST /sync`、Unityが読む
`GET /encounters` / `GET /stats`、CORSプリフライト、静的ページ配信をHTTPで
確認します。既存の `server/data/` は変更しません。

## Cloudflare公開

Cloudflare WorkersのGitHub連携では次を使用します。

```text
Build command: npm run build
Deploy command: npm run deploy
```

`wrangler.toml` は `public/` をWorkers Static Assetsとして配信します。
WorkerはAPIプロキシを実装しておらず、Webブラウザーは設定されたAPIへ直接
接続します。APIレスポンスは `cache: no-store` で取得します。
通信タイムアウトは接続だけでなくレスポンス本文の読み込み完了まで適用されます。
同じ画面から保存処理が同時に呼ばれた場合は、進行中の `POST /sync` を共有して
重複送信を防ぎます。
`POST /sync` の応答を受信できなかった場合は、同じ内容の次回送信で保留中の
`sync_id` を再利用します。サーバーは同じIDの保存結果を再利用するため、応答だけ
失われた場合もUnity向けの遭遇データが二重追加されません。

本番WebはHTTPSのため、本番APIもHTTPSが必須です。FastAPIの現在のCORSは
`allow_origins=["*"]` と `allow_credentials=True` です。今回、既存API仕様を
維持するため変更していません。本番移行時にはAPI側でWebの本番Originを許可し、
Cookieを使わない現在のクライアント (`credentials: omit`) に合わせてCORS設定を
見直してください。

## Unity担当への共有

本番API URLが確定したら、エンドポイントを付けないBase URLを共有します。

```text
Production API Base URL: https://<confirmed-api-host>
```

Unity側の設定先:

```text
Assets/Settings/DOOHServerConfig_Production.asset
```

現時点では本番API Base URLは未確定です。

APIのクラウド移行境界、永続化、CORS、受入条件、ロールバック手順は
`PRODUCTION_API_MIGRATION_PLAN.md`に記載しています。

## 管理者モード

プロフィール設定で固定の管理者ID
`DOOH-IPUT-IS-IDIOT-TEAM-K`を入力すると、APIの
`POST /admin/identify`で照合した後に`admin-login.html`へ移動します。
認証成功後の`admin.html`では次を確認・操作できます。

- APIへ同期済みの利用者プロフィール一覧
- 直近2分以内に通信したログイン中プロフィール数
- サイト全体とページ別の閲覧数
- 利用者の強制ログアウト
- 利用者アカウントと関連DOOH encounterの削除

管理者パスワードは静的ファイルやGitへ保存しません。ローカルでは
Git管理外の`.env`へ`DOOH_ADMIN_PASSWORD`を設定し、本番ではAPI配備先の
Secretへ同じ値を設定してください。本番用には推測困難な
`DOOH_ADMIN_TOKEN_SECRET`も別途設定します。

管理者機能、閲覧数、強制操作はFastAPIへの接続が必須です。
`app-config.js`の`apiBaseUrl`が空のCloudflare静的配信だけでは動作しません。

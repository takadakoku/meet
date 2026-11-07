# 東アジア通信システム Web会議（Jitsi Meet セルフホスト）

Jitsi Meet 公式 Docker 構成（[jitsi/docker-jitsi-meet](https://github.com/jitsi/docker-jitsi-meet)）を
無改変で利用し、`.env` だけで local / production を切り替える構成です。
要件は `SPEC.md`、作業ルールは `CLAUDE.md` を参照してください。

> **現状: Phase 5（JWT・ゲスト・ロビー）と会議URL発行ページまでローカルで完了。** 本番は未構築。本番作業の引き継ぎは `HANDOFF.md` を参照。

## 採用バージョン

| 項目 | 値 |
|---|---|
| docker-jitsi-meet | `stable-11248-3`（2026-11-02 公開。`VERSION.env` で一元管理） |
| イメージ | `ghcr.io/jitsi/{web,prosody,jicofo,jvb}:stable-11248-3` |
| 導入サービス | web / prosody / jicofo / jvb のみ（Jigasi・Jibri・Etherpad 等は導入しない） |

`latest` / `stable` タグは使用しません。`VERSION.env` は各環境の `.env` より後に読み込まれるため、
両環境で必ず同じバージョンになります（`.env` に `JITSI_IMAGE_VERSION` を書くとスクリプトがエラーにします）。

## ディレクトリ構成

```
meet/
├── VERSION.env              # 採用バージョン（共通）
├── .htaccess                # Apache 経由での配信を遮断（/var/www/html 配下のため必須）
├── .gitignore               # .env・upstream・node_modules 等を除外
├── upstream/                # 公式リリースアーカイブ（無改変・Git管理外・fetch-upstream.sh で再取得）
│   └── docker-jitsi-meet-stable-11248-3/docker-compose.yml   ← 両環境共通の compose
├── local/
│   ├── .env.example         # ローカル用テンプレート
│   └── .env                 # 実値（Git管理外・パーミッション600）
├── production/
│   ├── .env.example         # 本番用テンプレート（構成のみ・ダミー）
│   └── README.md
├── branding/                # ロゴ・名称のカスタムファイル置き場（現在は空＝Jitsi標準）
├── issuer/                  # 主催者用 会議URL発行ページ（/host/）
├── scripts/                 # 取得・初期化・起動・停止・会議URL発行・主催者アカウント管理
└── tests/e2e/               # 2セッション自動会議テスト
```

設定・永続化データ（Prosodyデータ、自己署名証明書、カスタム設定）は**Webルート外**の
`~/.jitsi-meet-cfg/<環境名>/` に置きます（Handbook の `CONFIG` 構成に準拠）。

## 前提

- Ubuntu 24.04 / Docker Engine / Docker Compose plugin（本PCは Docker 29.4.0・Compose v5.1.2 で確認）
- 実行ユーザーが `docker` グループに所属していること
- 空きポート: TCP 8000・8443（127.0.0.1）、UDP 10000、TCP 8080・8888（127.0.0.1、JVB/Jicofo の管理用）

Docker 未導入の場合は公式手順（https://docs.docker.com/engine/install/ubuntu/）で
`docker-ce`・`docker-compose-plugin` を導入してください。

## ローカル環境の構築手順

```bash
cd /var/www/html/meet

# 1. 公式リリースを取得（VERSION.env のタグ。SHA256 を upstream/*.sha256 に記録）
scripts/fetch-upstream.sh

# 2. local/.env を生成（サービス間パスワードを openssl rand -hex 16 で生成、値は表示しない）
#    ~/.jitsi-meet-cfg/local 配下のディレクトリも作成。既存 .env は上書きしない。
scripts/init-env.sh local

# 3. 起動
scripts/up.sh local
```

ブラウザで **https://localhost:8443** を開きます（自己署名証明書のため初回は警告が出るので「詳細設定 → 進む」）。
会議室名を入力して開始し、別ブラウザ（またはシークレットウィンドウ・別プロファイル）で同じURLを開くと参加できます。

> HTTP（:8000）ではカメラ・マイクが使えません。必ず HTTPS（:8443）を使ってください。

## 運用コマンド

| 操作 | コマンド |
|---|---|
| 起動 | `scripts/up.sh local` |
| 停止（コンテナ削除。データは残る） | `scripts/down.sh local` |
| 再起動 | `scripts/restart.sh local` |
| 状態 | `scripts/status.sh local` |
| ログ | `scripts/logs.sh local [web\|prosody\|jicofo\|jvb] [-f] [--since 10m]` |
| JVB ヘルス | `curl http://127.0.0.1:8080/about/health` |

`down.sh` は `-v` を付けないため、`~/.jitsi-meet-cfg/local` は削除されません。
`RESTART_POLICY=unless-stopped` のため、`down.sh` しない限りPC再起動後も自動起動します。

## ローカル設定の要点（local/.env）

| 設定 | 値 | 理由 |
|---|---|---|
| `HTTP_PORT` / `HTTPS_PORT` | `127.0.0.1:8000` / `127.0.0.1:8443` | 認証なしの検証環境を LAN に公開しない（Docker の公開ポートは UFW を経由しないため） |
| `PUBLIC_URL` | `https://localhost:8443` | Handbook で必須 |
| `TZ` | `Asia/Tokyo` | |
| `JICOFO_MAX_MEMORY` / `VIDEOBRIDGE_MAX_MEMORY` | `512m` / `1024m` | 開発PCのメモリ節約 |
| `DISABLE_DEEP_LINKING` | `true` | スマホで Jitsi 公式アプリへ誘導しない（ブラウザで参加） |
| 認証 | JWT（下記「認証・会議URL」） | 主催者だけが会議を開始できる |

UDP 10000（JVB メディア）は公式 compose の仕様上 0.0.0.0 で待ち受けますが、
シグナリング（8443）が 127.0.0.1 限定のため外部から会議には参加できません。

### LAN 内の別端末（スマートフォン等）から試す場合

`HTTPS_PORT=8443`、`PUBLIC_URL=https://<PCのLAN IP>:8443`、`JVB_ADVERTISE_IPS=<PCのLAN IP>` に変更して
`scripts/down.sh local && scripts/up.sh local`。会議画面が LAN に公開されるため、実施前に判断してください（会議の開始には主催者URLが必要）。
UFW の変更は不要ですが（Docker が直接 iptables を設定するため）、それ自体が「UFW で塞いでも公開される」点に注意。

## 認証・会議URL（Phase 5）

Handbook「Authentication (Token)」の推奨構成（JWT + 主催者待ち）を、公式 Docker の環境変数だけで設定しています。
旧 Secure Domain 方式（Jicofo 認証）は Handbook で非推奨のため使っていません。

| 利用者 | 入り方 | 権限 |
|---|---|---|
| 主催者 | 主催者用URL（JWT 付き） | 会議を開始できる。モデレーター（ロビー・ミュート・退出させる等） |
| 顧客（ゲスト） | ゲスト用URL（ログイン不要） | 主催者が来るまで待機画面。主催者が入ると自動で入室。モデレーターにはならない |

### 会議URLの発行（主催者用ページ）

主催者は **`<PUBLIC_URL>/host/`**（ローカル: https://localhost:8443/host/ ）に ID・パスワードでログインし、
「会議URLを発行する」を押すと、ゲスト用URLと主催者用URLが表示されます。

- 会議室名は英小文字+数字 20 文字のランダム値。会議室名・URL・発行履歴は保存しません（予約機能ではありません）。
- **顧客にはゲスト用URLだけを送ってください。** 主催者用URLを渡すと、その人もモデレーターになります。
- 主催者用URLのトークンは `#` 以降に付くため、ページを開くときにはサーバーへ送られません。
- 主催者用URLの有効期限は 3時間 / 24時間 / 3日 / 7日 から選択。トークンはその会議室専用です。

主催者アカウントの管理（保存先: `${CONFIG}/issuer/users.json`、scrypt ハッシュ、Webルート外）:

```bash
scripts/host-user.sh local add takada --name "高田"   # パスワード（12文字以上）を2回入力
scripts/host-user.sh local passwd takada               # 変更するとログイン中のセッションも無効
scripts/host-user.sh local del takada
scripts/host-user.sh local list
```

| 発行ページの仕様 | 内容 |
|---|---|
| 構成 | `issuer/`（Flask + gunicorn、バージョン固定）。公式 compose に `issuer/docker-compose.issuer.yml` を重ねて起動。ポート非公開で、Jitsi の nginx が `/host/` だけ中継 |
| ログイン保護 | 同一IDで5回失敗→15分ロック、同一IPで20回失敗→15分ロック。CSRF トークン、Cookie は Secure・HttpOnly・SameSite=Strict、8時間で失効 |
| 秘密情報 | JWT 署名鍵・セッション鍵は `.env` から環境変数で渡すだけ。ブラウザへは主催者用URLのみ |
| ログ | ログイン成功/失敗/ロック（ID と接続元IP）と「発行した」事実のみ。会議室名・URLは記録しない |

コマンドでも発行できます（管理者用・テスト用）: `scripts/issue-meeting.sh local [--hours N] [--name 表示名]`

| 設定（`.env`） | 値 | 意味 |
|---|---|---|
| `ENABLE_AUTH` / `AUTH_TYPE` | `1` / `jwt` | JWT 認証 |
| `JWT_APP_ID` / `JWT_APP_SECRET` | `oriental-meet` / 自動生成 | 署名鍵は `init-env.sh` が生成。表示・共有しない |
| `ENABLE_GUESTS` | `1` | トークンなしでもゲストとして接続可 |
| `JICOFO_ENABLE_AUTH` | `0` | Handbook: トークン認証では Jicofo 認証を無効にする |
| `ENABLE_AUTO_OWNER` | `0` | 主催者不在時にゲストをモデレーターへ自動昇格させない |
| `XMPP_MODULES` / `XMPP_MUC_MODULES` | `persistent_lobby` / `muc_wait_for_host` | ゲストを主催者到着まで待機させる |
| `ENABLE_LOBBY` | `1` | 主催者がロビー（入室承認制）を会議中にオン/オフできる |

> **ロビーの運用（2026-11-07 決定）:** SPEC 4.4 は「本番でロビーを有効にする」としていますが、ユーザー判断により
> **全会議での自動適用はせず、主催者が必要なときにオンにする運用**とします。理由: 会議室名が会議ごとのランダム値（約103bit）で推測不能なこと、
> 主催者が参加者一覧で確認し、不審な参加者を退出させたりロビーをオンにしたりできること。
> 残るリスクはゲスト用URLの転送・漏えいで、その会議に限り主催者在室中は入室できる点です。

ゲスト待機画面の「Log-in」ボタン（パスワード入力。本構成では使えない）は非表示にし、
待機メッセージを「主催者が参加すると自動的に会議に入ります」に変更しています（`branding/`）。

## 動作確認（自動テスト）

疑似カメラ・マイクを使ったヘッドレス Chrome 2セッションで、参加・音声/映像の双方向受信・チャット・画面共有を検証します。

```bash
cd tests/e2e
npm install          # puppeteer-core のみ（ブラウザはシステムの google-chrome を使用）
npm run test:jvb     # JVB（サーバー中継）経由
npm run test:p2p     # 2人時の既定動作（P2P）
node auth-test.js    # 認証: 主催者/ゲスト権限・主催者待ち・ロビー・不正トークン拒否
node issuer-test.js  # 発行ページ: ログイン・発行・入室・ロック・CSRF・セッション無効化（テスト用アカウントは自動削除）
```

`test.js` は1人目を主催者URL、2人目をゲストURLで参加させます（`scripts/issue-meeting.sh` を使用）。

注: テストでは会議室名にランダム値を使用します。URLで `prejoinConfig.enabled=false` にすると
Jitsi の仕様でメディア無しで参加するため、テストはプリジョイン画面の「参加」ボタンを押す方式にしています。

## 秘密情報の扱い

- `local/.env` / `production/.env` は `.gitignore` 済み・パーミッション 600。`.env.example` はダミー値のみ。
- 本番の `.env` はVPS上で生成し、ローカルと共有しない（`init-env.sh production` / `up.sh production` は `ALLOW_PRODUCTION=1` が無いと拒否）。
- このディレクトリは Apache の公開ルート配下にあるため、`.htaccess`（`Require all denied`）で `http://localhost/meet/` を 403 にしています。削除しないでください。

## バージョン更新手順

1. 公式 `CHANGELOG.md` とリリースノートを確認
2. `VERSION.env` の `JITSI_IMAGE_VERSION` を更新
3. `scripts/fetch-upstream.sh`（新しいディレクトリに展開）
4. 新旧 `env.example` / `docker-compose.yml` の差分を確認し、必要なら `.env.example` を更新
5. `scripts/down.sh local && scripts/up.sh local` → `tests/e2e` で回帰確認

## ブランド変更

公式の仕組み（`${CONFIG}/web/custom-config.js` 等を起動時に追記）を使います。
詳細は `branding/README.md`。`branding/web/` にファイルを置いて `scripts/restart.sh local` するだけで適用され、
コンテナ再作成後も維持されます。現在はロゴ・ファビコン・表示名「東アジア通信システム Web会議」を適用済み。

## 既知事項

- 起動直後、Jicofo が Prosody のユーザー登録完了前に接続して `SASLError not-authorized` を数回出しますが、自動再試行で接続されます。
- Prosody の `mod_http ... Not listening on any ports, 'health' will be unreachable` は起動時に出力されますが、会議動作（BOSH/WebSocket）に影響はありません。
- Jicofo の REST（:8888 `/about/health`）は既定で無効のため応答しません。
- 通常の通話は DTLS-SRTP で暗号化されますが、JVB 経由の会議は E2EE ではありません（SPEC 9.2）。
- `XMPP_MODULES` は公式テンプレートの仕様でゲスト用ドメインにも読み込まれるため、`persistent_lobby` が2回ロードされます。処理は冪等で、`tests/e2e/auth-test.js` で動作を確認済みです。
- **トークンがログに残る場合があります（未解決）。** nginx の error ログ（WebSocket 切断時のリクエスト行）と Prosody の error ログ（拒否されたトークン）に、公式イメージの標準動作として JWT が出力されます。署名鍵は出力されません。access ログは公式設定でマスク済みです。
# meet

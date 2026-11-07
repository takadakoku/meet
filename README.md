# 東アジア通信システム Web会議（Jitsi Meet セルフホスト）

Jitsi Meet 公式 Docker 構成（[jitsi/docker-jitsi-meet](https://github.com/jitsi/docker-jitsi-meet)）を
無改変で利用し、`.env` だけで local / production を切り替える構成です。
要件は `SPEC.md`、作業ルールは `CLAUDE.md` を参照してください。

> **現状: Phase 1（ローカル構築・基本会議テスト）完了。** 認証は未設定のため、ローカル専用（127.0.0.1）でのみ動かしています。

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
├── scripts/                 # 取得・初期化・起動・停止等
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
| 認証 | 無効 | Phase 3 で JWT を検証予定 |

UDP 10000（JVB メディア）は公式 compose の仕様上 0.0.0.0 で待ち受けますが、
シグナリング（8443）が 127.0.0.1 限定のため外部から会議には参加できません。

### LAN 内の別端末（スマートフォン等）から試す場合

`HTTPS_PORT=8443`、`PUBLIC_URL=https://<PCのLAN IP>:8443`、`JVB_ADVERTISE_IPS=<PCのLAN IP>` に変更して
`scripts/down.sh local && scripts/up.sh local`。**認証なしの会議室が LAN に公開される**ため、実施前に判断してください。
UFW の変更は不要ですが（Docker が直接 iptables を設定するため）、それ自体が「UFW で塞いでも公開される」点に注意。

## 動作確認（自動テスト）

疑似カメラ・マイクを使ったヘッドレス Chrome 2セッションで、参加・音声/映像の双方向受信・チャット・画面共有を検証します。

```bash
cd tests/e2e
npm install          # puppeteer-core のみ（ブラウザはシステムの google-chrome を使用）
npm run test:jvb     # JVB（サーバー中継）経由
npm run test:p2p     # 2人時の既定動作（P2P）
```

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
# meet

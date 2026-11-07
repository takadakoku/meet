# branding/

会社ロゴ・名称を適用するためのディレクトリです。**現在: ロゴ・ファビコン・表示名「東アジア通信システム Web会議」適用済み**。

`scripts/up.sh` / `scripts/restart.sh` 実行時に、`branding/web/` 配下の以下のファイルが
`${CONFIG}/web/` へコピーされます（ファイルが無ければ `${CONFIG}/web/` 側からも除去）。

| ファイル | 公式の扱い（stable-11248-3 で確認） |
|---|---|
| `web/custom-config.js` | 起動時に生成 `config.js` の末尾へ追記 |
| `web/custom-interface_config.js` | 起動時に生成 `interface_config.js` の末尾へ追記 |
| `web/nginx/custom-meet.conf` | 起動時に nginx の `meet.conf` 末尾へ追記（ロゴ・ファビコン配信） |
| `web/branding/` | 画像一式。`${CONFIG}/web/branding/` → 起動時に `/run/web/config/branding/` へコピーされ、`/branding/…` で配信 |

根拠: `upstream/docker-jitsi-meet-*/web/rootfs/etc/s6-overlay/scripts/config`、
Handbook「Jitsi Meet configuration」節。生成済みの `config.js` / `interface_config.js` は直接編集しない。

## 適用内容（2026-11-07）

元素材: リポジトリ直下 `logo_mark.png`（紙飛行機マーク, 139×95 透過PNG）

| 画像 | 生成方法 | 使用箇所 |
|---|---|---|
| `web/branding/logo.png` | 元素材そのまま | （予備。ロゴマーク単体） |
| `web/branding/logo-with-name.png` | 元素材（余白除去）の下に白文字「Oriental Network Co., Ltd.」（Noto Sans SemiBold）を配置、379×124（2倍解像度） | 会議画面左上（`DEFAULT_LOGO_URL`・dynamic branding `logoImageUrl`）、ウェルカム画面（`DEFAULT_WELCOME_PAGE_LOGO_URL`） |
| `web/branding/plugin.head.html` | 公式の空フックを差し替え | 左上ロゴ枠を 71×32 → 190×62 に拡大する CSS のみ |
| `web/branding/favicon.png` | 128×128 透過に縮小・中央配置 | ファビコン（`/images/favicon.svg` を nginx で差し替え。title.html が固定参照のため） |
| `web/branding/apple-touch-icon.png` | 180×180 白背景に中央配置 | iOS ホーム画面アイコン |
| `web/branding/title.html` | 公式 title.html を複製し名称・画像のみ変更 | 初期タブ名・OGP。ファビコンを `branding/favicon.png?v=2` に変更（旧URLは1年キャッシュのため） |
| `web/branding/dynamic-branding.json` + `labels-*.json` | — | 公式 dynamic branding（`config.dynamicBrandingUrl`）でウェルカム画面見出しを上書き |

表示名 `東アジア通信システム Web会議` は `interfaceConfig.APP_NAME`（タブ名）と上記 labels（見出し）で設定。
ウェルカム画面下部の Jitsi 公式アプリ案内は `interfaceConfig.DISPLAY_WELCOME_FOOTER = false`、
スマホでの「アプリで開く」案内は `.env` の `DISABLE_DEEP_LINKING=true`（公式環境変数）で非表示。

**バージョン更新時は title.html の元ファイルとの差分を確認すること。**

会議画面ロゴのリンク先は `https://oriental-network.com/`。

## 未対応・要判断

- ロゴが 139×95 と小さいため、高解像度端末ではややぼやける。SVG または 512px 以上の透過PNGがあれば差し替え推奨
- PWA アイコン・OGP 画像（`jitsilogo.png`）は未変更

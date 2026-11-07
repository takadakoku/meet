# 申し送り（ローカル開発 → 本番VPS作業）

作成: 2026-11-07（ローカル開発PCでの作業終了時点）。VPS 上で作業する Claude はまず `CLAUDE.md`・`SPEC.md`・`README.md` とこのファイルを読むこと。

## 1. 現状

| フェーズ | 状況 |
|---|---|
| 環境調査・ローカル構築・基本会議テスト | 完了 |
| ロゴ・名称 | 完了（表示名「東アジア通信システム Web会議」、ロゴ＋「Oriental Network Co., Ltd.」） |
| JWT・ゲスト・主催者待ち・会議URL発行ページ | 完了（ローカルで自動テスト全合格） |
| ローカル受入テスト | **ユーザー判断でスキップ**。スマホ実機・別ネットワークは本番受入テストで確認する |
| 本番VPS調査・見積もり（CLAUDE.md の Phase 7） | **未着手。ここから再開** |

採用バージョン: `docker-jitsi-meet stable-11248-3`（`VERSION.env`）。

## 2. ユーザーが決定済みの事項

- 表示名は `東アジア通信システム Web会議`。
- 会議URLは**主催者用ページ（`/host/`）で ID・パスワードログインして発行**する（`issuer/`）。CLI の `scripts/issue-meeting.sh` は管理者・テスト用。
- **ロビーは全会議に自動適用しない**。主催者が必要なときに会議中にオンにする（SPEC 4.4 からの変更。理由は README「ロビーの運用」）。
- Jitsi 公式アプリへの誘導（ウェルカム画面下部の帯、スマホの「アプリで開く」）は表示しない。

## 3. VPS への持ち込み方

- ローカルの変更（Phase 5・発行ページ・この申し送り）は**未コミット**。push してから VPS で clone する。
- GitHub リポジトリ `takadakoku/meet` は**公開（public）**。秘密情報は含まれていないが、`SPEC.md` に VPS のスペック・料金などが載っている。公開のままでよいかはユーザーに確認すること。
- **持ち込まないもの**: `local/.env`、`~/.jitsi-meet-cfg/local/`（ローカル用の鍵・アカウント）、`tests/e2e/node_modules/`、`upstream/`（VPS 上で `scripts/fetch-upstream.sh` を実行して取得する）。
- ローカルでは `/var/www/html/meet` に置いたため `.htaccess` で Apache からの配信を遮断している。**VPS ではWebルートの外**（例: `/opt/meet` やデプロイユーザーのホーム）に置くこと。

本番の初期化の流れ（実行前にユーザー承認を得る）:

```bash
scripts/fetch-upstream.sh
ALLOW_PRODUCTION=1 scripts/init-env.sh production   # パスワード・JWT署名鍵・セッション鍵を生成（表示しない）
# production/.env の空欄（PUBLIC_URL、ポート、JVB_ADVERTISE_IPS、TLS 関連）を調査結果に基づいて埋める
scripts/host-user.sh production add <ID> --name "<表示名>"   # 主催者アカウント（パスワード 12 文字以上）
ALLOW_PRODUCTION=1 scripts/up.sh production
```

## 4. 本番VPS調査で確認すること（SPEC 8.2 ＋ 実装上の要点）

- **既存サービスとポート**: 80/443 を既存の Web サーバー（Laravel・Apache・Nginx 等）が使っているか。使っている場合、既存側のリバースプロキシで `meet.oriental-network.com` を Jitsi web コンテナへ振り分ける構成になる見込み。その場合、次の経路が通ることを確認する。
  - `/xmpp-websocket` と `/colibri-ws/`（WebSocket の Upgrade ヘッダーを通す）
  - `/http-bind`
  - `/host/`（発行ページ）
  - 既存の設定変更は必ず事前説明・承認。
- **TLS**: Jitsi の Let's Encrypt 機能（80/443 を直接受ける）を使うか、既存プロキシで終端するかを決める。公式の `env.example` と Handbook で該当する変数を確認してから設定する。
- **UDP 10000**: JVB のメディア用ポート。`JVB_ADVERTISE_IPS` に VPS のグローバルIP を設定する。クラウド側のパケットフィルタと UFW の両方を確認する。Docker の公開ポートは UFW を経由しない点に注意。
- **メモリ**: 現行 VPS は 2GB。ローカルでは `JICOFO_MAX_MEMORY=512m` / `VIDEOBRIDGE_MAX_MEMORY=1024m` に設定しているが、`production/.env.example` には未設定。SPEC は「2GB をそのまま本番採用しない、4GB 以上の専用環境を比較検討」としている。`free -h`・既存負荷・スワップを測ってから提案する。
- **DNS**: `meet.oriental-network.com` の管理者と現在のレコード。
- **uid**: issuer コンテナと Jitsi の各コンテナは uid 1000 で動く。デプロイユーザーの uid が 1000 でない場合、`~/.jitsi-meet-cfg/production/issuer/`（700）を issuer が読めない。`init-env.sh` の uid≠1000 分岐には issuer 用の処理が無いので対応が必要。

## 5. 未解決・注意事項

1. **JWT がログに残る（未解決）**: 公式イメージの標準動作で、次の2か所に JWT が出力される。署名鍵は出ない。access ログは公式設定でマスク済み。
   - nginx の error ログ: WebSocket 切断時のリクエスト行
   - Prosody の error ログ: 拒否したトークン

   CLAUDE.md の「JWT をログに出さない」に反するため、本番では対策を提案すること。候補: Docker の `logging` で `max-size`/`max-file` を設定する、ログ保存期間を決める（SPEC 9.3）、外部転送しない、トークン期限を短くする。
2. **既存プロキシの背後に置く場合の接続元IP**: `custom-meet.conf` は issuer へ `X-Forwarded-For $remote_addr` を渡している。外側にプロキシがあると全員がプロキシの IP になり、「同一IPで20回失敗→15分ロック」が全利用者に効いてしまう。nginx の `real_ip` 設定などで本当のクライアントIPを渡すこと（公式 nginx 設定と整合を確認）。
3. **`/host/` の公開範囲**: 社外から開けるか、社内IPに限定するかは未決定。ユーザーに確認する。
4. **`#jwt=` はダブルクォート（`%22`）で囲む必要がある**。Jitsi は `#` 以降の値を JSON として解釈するため、囲まないとトークンが無視されてゲスト扱いになる（`issuer/meeting.py` は対応済み）。
5. **`persistent_lobby` が2回ロードされる**。`XMPP_MODULES` がゲスト用ドメインにも入るため。処理は冪等で、テストでは問題なし。
6. **バージョン更新時に差分確認が必要なファイル**（いずれも公式ファイルの差し替え・上書き）:
   - `branding/web/branding/title.html`
   - `branding/web/branding/plugin.head.html`（ゲスト待機画面の Log-in ボタンを CSS で非表示）
   - `labels-*.json`（待機メッセージの文言）
7. **自動テストは `https://localhost:8443` 固定**（`tests/e2e/`）。本番では手動で受入テストを行う。
8. **ロゴは 139×95 の PNG から作成**。社名の書体は仮選定（Noto Sans）。正式なロゴタイプや高解像度素材があれば差し替える。
9. **バックアップ対象**: `production/.env` と `~/.jitsi-meet-cfg/production/issuer/users.json`。どちらも秘密情報なので、保管場所はユーザーと決める。

## 6. 本番受入テスト（SPEC 10）

ローカルで自動確認済み:

| 項目 | 内容 |
|---|---|
| T-01〜T-04 | 会議室作成、URL参加、ゲスト参加、主催者認証 |
| T-06〜T-11 | マイク、カメラ、画面共有、チャット、ロゴ、ブランド維持 |
| T-15 | 権限分離 |
| 不正トークン | 改ざん・期限切れ・別会議室用は拒否 |
| 発行ページ | ログイン、ロック、CSRF、セッション無効化 |

本番で必ず行うこと:

- T-12: スマートフォン実機（iOS Safari / Android Chrome）
- T-13: 証明書エラーが出ない
- T-14: 社内Wi-Fi とモバイル回線など、別ネットワークの 2〜3 端末で通話できる
- T-05（ロビー）: 主催者が手動でオンにした場合の動作だけ確認する（2章の決定のとおり）
- ログ保存期間・監視・バックアップの確認
- 社内担当者向けの簡易手順書（発行ページの使い方、ゲスト用URLだけを送ること）

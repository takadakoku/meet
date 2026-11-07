# production/

本番環境用の**構成のみ**です。現時点では本番設定・本番秘密情報は一切含みません。

- `.env.example` … 本番用テンプレート（ダミー・空欄）
- `.env` … 本番VPS上でのみ `ALLOW_PRODUCTION=1 scripts/init-env.sh production` で生成する（ローカル・Gitへ置かない）

本番の値（ドメイン、ポート、グローバルIP、TLS、JWT）は Phase 5 でユーザー承認後に確定します。
`scripts/up.sh production` も `ALLOW_PRODUCTION=1` が無いと実行されません。

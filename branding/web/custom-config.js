// ---- 会社ブランディング（branding/web/custom-config.js） ----
// 公式の仕組みで生成 config.js の末尾に追記される。
// Jitsi の dynamic branding: ロゴ・ウェルカム画面見出し（翻訳文言の上書き）を JSON で指定
config.dynamicBrandingUrl = '/branding/dynamic-branding.json';

// 主催者待ちダイアログの「I am the host（ログイン）」ボタンを出さない（JWT 専用構成のため）
config.hideLoginButton = true;

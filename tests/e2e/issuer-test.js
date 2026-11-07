// 会議URL発行画面（/host/）の検証。テスト用アカウントを一時作成し、終了時に削除する。
// パスワードはランダム生成してメモリ上だけで使い、表示しない。
const puppeteer = require('puppeteer-core');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // ローカル自己署名証明書のため（このテストプロセスのみ）
const ROOT = path.resolve(__dirname, '../..');
const BASE = 'https://localhost:8443';
const HOST = `${BASE}/host/`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browsers = [];

const userCmd = (args, input) => execFileSync(path.join(ROOT, 'scripts/host-user.sh'), ['local', ...args],
  { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const pw1 = crypto.randomBytes(18).toString('base64url');
const pw2 = crypto.randomBytes(18).toString('base64url');
const pwLock = crypto.randomBytes(18).toString('base64url');
const UID = 'e2e-host-' + crypto.randomBytes(3).toString('hex');
const LOCK_UID = 'e2e-lock-' + crypto.randomBytes(3).toString('hex');

async function launch() {
  const b = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome', headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jitsi-issuer-')),
    args: ['--ignore-certificate-errors', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-first-run', '--lang=ja'],
  });
  browsers.push(b);
  return b;
}

async function login(page, uid, pw) {
  await page.goto(HOST, { waitUntil: 'networkidle2' });
  await page.type('#user_id', uid);
  await page.type('#password', pw);
  const [resp] = await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('button[type=submit]')]);
  return resp.status();
}

async function joinState(page, ms) {
  const end = Date.now() + ms;
  let st = {};
  while (Date.now() < end) {
    st = await page.evaluate(() => window.APP && APP.store ? {
      joined: APP.conference.isJoined(), role: APP.store.getState()['features/base/participants'].local?.role,
    } : {}).catch(() => ({}));
    if (st.joined) return st;
    await sleep(1000);
  }
  return st;
}

(async () => {
  const R = {};
  userCmd(['add', UID, '--name', 'テスト主催者'], pw1 + '\n');
  userCmd(['add', LOCK_UID, '--name', 'ロック確認'], pwLock + '\n');
  try {
    // --- HTTP レベル: 未ログイン・CSRF・短いパスワード ---
    let r = await fetch(`${BASE}/host/create`, { method: 'POST', redirect: 'manual' });
    R.H1_create_without_session_rejected = r.status === 400;
    r = await fetch(HOST);
    const cookie = r.headers.get('set-cookie').split(';')[0];
    r = await fetch(`${BASE}/host/create`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'hours=24&csrf=wrong' });
    R.H2_wrong_csrf_rejected = r.status === 400;
    R.H3_headers = ['content-security-policy', 'x-frame-options', 'cache-control'].every(h => (r.headers.get(h) || '').length > 0) || undefined;
    try { userCmd(['add', 'e2e-short', '--name', 'x'], 'short\n'); R.H4_short_password_refused = false; } catch { R.H4_short_password_refused = true; }

    // --- ログイン失敗 → 成功 → 発行 ---
    const b = await launch();
    const page = await b.newPage();
    R.L1_wrong_password_status = await login(page, UID, 'wrong-password-123');
    R.L1_wrong_password_rejected = R.L1_wrong_password_status === 401 && (await page.content()).includes('正しくありません');
    R.L2_login_ok = (await login(page, UID, pw1)) === 200 && (await page.$('select#hours')) !== null;
    await page.select('#hours', '3');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('form[action$="/create"] button')]);
    const guestUrl = await page.$eval('#guest-url', e => e.value);
    const hostUrl = await page.$eval('#host-url', e => e.value);
    R.L3_urls_issued = /^https:\/\/localhost:8443\/[a-z0-9]{20}$/.test(guestUrl) && hostUrl.startsWith(guestUrl + '#jwt=%22');
    const expiresText = await page.$eval('.warn-text', e => e.textContent);
    const exp = new Date(expiresText.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/)[1].replace(' ', 'T') + ':00+09:00');
    R.L4_expiry_about_3h = Math.abs(exp - Date.now() - 3 * 3600e3) < 120e3;
    await page.setViewport({ width: 1100, height: 900 });
    await page.screenshot({ path: path.join(os.tmpdir(), 'issuer-created.png'), fullPage: true });

    // 主催者ボタン（新しいタブ）で会議へ
    const newTab = new Promise(res => b.once('targetcreated', t => res(t.page())));
    await page.click('a.btn-primary[target=_blank]');
    const hp = await newTab;
    await hp.waitForSelector('[data-testid="prejoin.joinMeeting"]', { visible: true, timeout: 60000 }).then(e => e.click());
    let st = await joinState(hp, 30000);
    R.M1_host_button_joins_as_moderator = st.joined && st.role === 'moderator';
    R.M1_host_display_name = await hp.evaluate(() => APP.store.getState()['features/base/participants'].local?.name);

    const gb = await launch();
    const gp = await gb.newPage();
    await gp.goto(guestUrl + '#userInfo.displayName="Guest"', { waitUntil: 'domcontentloaded' });
    await gp.waitForSelector('[data-testid="prejoin.joinMeeting"]', { visible: true, timeout: 60000 }).then(e => e.click());
    st = await joinState(gp, 30000);
    R.M2_guest_url_joins_as_participant = st.joined && st.role === 'participant';
    await gb.close();
    await hp.close();

    // --- パスワード変更で既存セッションが無効になる ---
    userCmd(['passwd', UID], pw2 + '\n');
    await page.goto(HOST, { waitUntil: 'networkidle2' });
    R.S1_session_invalid_after_passwd = (await page.$('#password')) !== null;
    R.S2_old_password_rejected = (await login(page, UID, pw1)) === 401;
    R.S3_new_password_ok = (await login(page, UID, pw2)) === 200;
    // --- ログアウト ---
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('form[action$="/logout"] button')]);
    R.S4_logout = (await page.$('#password')) !== null;
    // --- 削除で既存セッションが無効になる ---
    await login(page, UID, pw2);
    userCmd(['del', UID]);
    await page.goto(HOST, { waitUntil: 'networkidle2' });
    R.S5_session_invalid_after_delete = (await page.$('#password')) !== null;

    // --- 連続失敗でロック（正しいパスワードでも 15 分拒否） ---
    const lp = await (await launch()).newPage();
    for (let i = 0; i < 5; i++) await login(lp, LOCK_UID, 'bad-password-' + i);
    R.K1_locked_after_5_failures = (await login(lp, LOCK_UID, pwLock)) === 429 && (await lp.content()).includes('15分間');

    // --- スマホ幅の表示 ---
    const mp = await (await launch()).newPage();
    await mp.setViewport({ width: 390, height: 844, isMobile: true });
    await mp.goto(HOST, { waitUntil: 'networkidle2' });
    R.U1_mobile_no_horizontal_scroll = await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    await mp.screenshot({ path: path.join(os.tmpdir(), 'issuer-login-mobile.png') });
  } finally {
    for (const u of [UID, LOCK_UID]) { try { userCmd(['del', u]); } catch { /* 削除済み */ } }
    await Promise.all(browsers.map(b => b.close().catch(() => {})));
  }
  console.log(JSON.stringify(R, null, 2));
  const failed = Object.entries(R).filter(([, v]) => v === false);
  console.log(failed.length ? `FAILED: ${failed.map(f => f[0]).join(', ')}` : 'ALL PASSED');
  process.exit(failed.length ? 1 : 0);
})().catch(async e => { console.error(e); await Promise.all(browsers.map(b => b.close().catch(() => {}))); process.exit(1); });

// Phase 5: JWT（主催者）・ゲスト・主催者待ち・ロビーの検証。独立したブラウザセッションで実行する。
// 主催者URLは scripts/issue-meeting.sh local で発行したものを使う（スクリプト自体の検証も兼ねる）。
// 異常系（期限切れ・別会議室用・署名不正）のトークンだけはテスト内で生成する。
// 署名鍵は local/.env から読むだけで、表示・ログ出力はしない。
const puppeteer = require('puppeteer-core');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browsers = [];

function issueMeeting() {
  const out = execFileSync(path.join(ROOT, 'scripts/issue-meeting.sh'), ['local', '--hours', '1', '--name', 'Host'], { encoding: 'utf8' });
  const room = out.match(/会議室名\s*:\s*(\S+)/)[1];
  const guest = out.match(/^(https:\/\/\S+\/[a-z0-9]{20})$/m)[1];
  const host = out.match(/^(https:\/\/\S+#jwt=\S+)$/m)[1];
  return { room, guest, host };
}

function signToken(claims) {
  const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'local/.env'), 'utf8')
    .split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: env.JWT_APP_ID, iss: env.JWT_APP_ID, sub: 'meet.jitsi', iat: now, nbf: now - 60, exp: now + 3600,
    context: { user: { name: 'Host', moderator: true } }, ...claims };
  const input = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64(payload);
  return input + '.' + crypto.createHmac('sha256', env.JWT_APP_SECRET).update(input).digest('base64url');
}

async function open(name, url) {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome', headless: 'new',
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jitsi-auth-')),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--ignore-certificate-errors',
      '--no-first-run', '--lang=en-US', '--autoplay-policy=no-user-gesture-required'],
  });
  browsers.push(browser);
  const page = await browser.newPage();
  const extra = `config.p2p.enabled=false&userInfo.displayName="${name}"`;
  await page.goto(url + (url.includes('#') ? '&' : '#') + extra, { waitUntil: 'domcontentloaded' });
  const join = await page.waitForSelector('[data-testid="prejoin.joinMeeting"]', { visible: true, timeout: 60000 }).catch(() => null);
  if (join) await join.click();
  return { browser, page, name };
}

const state = p => p.page.evaluate(() => {
  const s = window.APP && APP.store.getState();
  if (!s) return { app: false };
  const lobby = s['features/lobby'] || {};
  return {
    joined: Boolean(APP.conference && APP.conference.isJoined()),
    role: s['features/base/participants'].local?.role,
    knocking: Boolean(lobby.knocking),
    waitingForHost: Boolean(lobby.lobbyWaitingForHost),
  };
});

async function waitFor(p, fn, ms) {
  const end = Date.now() + ms;
  let st;
  while (Date.now() < end) { st = await state(p); if (fn(st)) return st; await sleep(1000); }
  return st;
}
const close = async p => { await p.browser.close().catch(() => {}); };
const text = p => p.page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 160));

(async () => {
  const R = {};

  // --- 1. 主催者が先に入室 → モデレーター。ゲストは後から参加でき、モデレーターではない ---
  {
    const m = issueMeeting();
    R.issue_room_random = /^[a-z0-9]{20}$/.test(m.room);
    R.issue_token_in_hash_only = !m.guest.includes('jwt') && m.host.includes('#jwt=') && !m.host.split('#')[0].includes('jwt');
    const H = await open('Host', m.host);
    let s = await waitFor(H, s => s.joined, 30000);
    R.T1_host_joined = s.joined;
    R.T1_host_is_moderator = s.role === 'moderator';
    const G = await open('Guest', m.guest);
    s = await waitFor(G, s => s.joined, 30000);
    R.T1_guest_joined_after_host = s.joined;
    R.T1_guest_not_moderator = s.role === 'participant';
    await sleep(5000);
    const media = await G.page.evaluate(async () => {
      const sess = APP.conference._room.jvbJingleSession; if (!sess) return {};
      const st = await sess.peerconnection.peerconnection.getStats(); const o = { audio: 0, video: 0 };
      st.forEach(x => { if (x.type === 'inbound-rtp') o[x.kind] += x.bytesReceived || 0; }); return o;
    });
    R.T1_guest_receives_host_media = media.audio > 0 && media.video > 0;

    // --- 7. 主催者が退出してもゲストはモデレーターに昇格しない ---
    await close(H);
    await sleep(10000);
    s = await state(G);
    R.T7_guest_not_promoted_after_host_left = s.role !== 'moderator';
    await close(G);
  }

  // --- 2. ゲストが先に来た場合は待機 → 主催者入室で自動的に参加 ---
  {
    const m = issueMeeting();
    const G = await open('Guest', m.guest);
    let s = await waitFor(G, s => s.joined, 15000);
    R.T2_guest_alone_cannot_start = !s.joined;
    R.T2_guest_waiting_text = await text(G);
    const H = await open('Host', m.host);
    s = await waitFor(H, s => s.joined, 30000);
    R.T2_host_joined = s.joined && s.role === 'moderator';
    s = await waitFor(G, s => s.joined, 40000);
    R.T2_guest_admitted_when_host_arrives = s.joined;
    R.T2_guest_not_moderator = s.role === 'participant';

    // --- 8. ロビー: 主催者がロビーを有効化 → 新しいゲストはノック → 主催者が承認で入室 ---
    R.T8_host_role_before_lobby = (await state(H)).role;
    await H.page.evaluate(() => APP.conference._room.enableLobby()).catch(e => { R.T8_enable_lobby_error = e.message; });
    await sleep(3000);
    const G2 = await open('Guest2', m.guest);
    s = await waitFor(G2, s => s.knocking, 30000);
    R.T8_lobby_guest_knocking = s.knocking && !s.joined;
    const knock = await H.page.waitForFunction(() => {
      const k = APP.store.getState()['features/lobby'].knockingParticipants; return k.length ? k[0].id : null;
    }, { timeout: 30000 }).then(h => h.jsonValue()).catch(() => null);
    R.T8_host_sees_knock = Boolean(knock);
    if (knock) await H.page.evaluate(id => APP.conference._room.lobbyApproveAccess(id), knock);
    s = await waitFor(G2, s => s.joined, 30000);
    R.T8_guest_admitted_by_host = s.joined;
    R.T8_admitted_guest_not_moderator = s.role === 'participant';
    await Promise.all([close(G2), close(G), close(H)]);
  }

  // --- 3〜6. 不正なトークンでは主催者として入れない ---
  const negative = async (label, url) => {
    const P = await open('Bad', url);
    const s = await waitFor(P, s => s.joined, 20000);
    R[label] = !(s.joined && s.role === 'moderator') && !s.joined;
    R[label + '_jwt_was_loaded'] = await P.page.evaluate(() => Boolean(APP.store.getState()['features/base/jwt'].jwt));
    R[label + '_screen'] = await text(P);
    await close(P);
  };
  {
    const m = issueMeeting();
    const other = issueMeeting();
    const tok = m.host.split('#jwt=')[1].replace(/%22/g, '');
    const sig = tok.slice(tok.lastIndexOf('.') + 1);
    const forged = tok.slice(0, tok.lastIndexOf('.') + 1) + (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    const q = t => `%22${t}%22`;
    await negative('T3_forged_signature_rejected', `${m.guest}#jwt=${q(forged)}`);
    await negative('T4_token_for_other_room_rejected', `${other.guest}#jwt=${q(tok)}`);
    await negative('T5_expired_token_rejected', `${m.guest}#jwt=${q(signToken({ room: m.room, iat: 1, nbf: 1, exp: Math.floor(Date.now() / 1000) - 600 }))}`);
    await negative('T6_wrong_secret_rejected', `${m.guest}#jwt=${q((() => { const t = signToken({ room: m.room }); return t.slice(0, t.lastIndexOf('.')) + '.' + crypto.createHmac('sha256', 'wrong-secret').update(t.slice(0, t.lastIndexOf('.'))).digest('base64url'); })())}`);
  }

  console.log(JSON.stringify(R, null, 2));
  const failed = Object.entries(R).filter(([k, v]) => !k.endsWith('_screen') && !k.endsWith('_text') && v === false);
  console.log(failed.length ? `FAILED: ${failed.map(f => f[0]).join(', ')}` : 'ALL PASSED');
  process.exit(failed.length ? 1 : 0);
})().catch(async e => { console.error(e); await Promise.all(browsers.map(b => b.close().catch(() => {}))); process.exit(1); });

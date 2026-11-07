// 2つの独立したブラウザセッションで会議参加・音声/映像・チャット・画面共有を検証する
const puppeteer = require('puppeteer-core');

const BASE = process.env.BASE || 'https://localhost:8443';
const P2P = process.env.P2P === '1';
// Phase 5 以降は認証必須: 1人目（Alice）は主催者URL（JWT）、2人目（Bob）はゲストURLで参加する
const issued = require('child_process').execFileSync(require('path').resolve(__dirname, '../../scripts/issue-meeting.sh'), ['local', '--hours', '1'], { encoding: 'utf8' });
const room = issued.match(/会議室名\s*:\s*(\S+)/)[1];
const hostHash = issued.match(/#(jwt=\S+)$/m)[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch(name) {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: 'new',
    userDataDir: require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'jitsi-e2e-')),
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen',
      '--ignore-certificate-errors',
      '--no-first-run', '--lang=en-US',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error' && /share|desktop|screen|display/i.test(m.text())) console.log(`[${name}] console:`, m.text().slice(0, 300)); });
  page.on('pageerror', e => console.log(`[${name}] pageerror:`, e.message));
  const hash = [
    ...(name === 'Alice' ? [hostHash] : []),
    `config.p2p.enabled=${P2P}`,
    `userInfo.displayName="${name}"`,
  ].join('&');
  await page.goto(`${BASE}/${room}#${hash}`, { waitUntil: 'domcontentloaded' });
  const join = await page.waitForSelector('[data-testid="prejoin.joinMeeting"], [aria-label="Join meeting"]', { visible: true, timeout: 60000 });
  await join.click();
  await page.waitForFunction(() => window.APP && APP.conference && APP.conference.isJoined(), { timeout: 60000 });
  return { browser, page, name };
}

async function inboundStats(page) {
  return page.evaluate(async () => {
    const room = APP.conference._room;
    const sess = room.isP2PActive() ? room.p2pJingleSession : room.jvbJingleSession;
    if (!sess) return null;
    const stats = await sess.peerconnection.peerconnection.getStats();
    const out = { audio: 0, video: 0, transport: room.isP2PActive() ? 'p2p' : 'jvb' };
    stats.forEach(s => { if (s.type === 'inbound-rtp') out[s.kind] += s.bytesReceived || 0; });
    return out;
  });
}

(async () => {
  const results = {};
  const A = await launch('Alice');
  results.T01_room_created = true;
  const B = await launch('Bob');
  results.T02_second_session_joined = true;

  await B.page.waitForFunction(() => APP.conference.membersCount === 2, { timeout: 30000 });
  results.members = await A.page.evaluate(() => APP.conference.membersCount);

  let sa, sb;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    sa = await inboundStats(A.page); sb = await inboundStats(B.page);
    if (sa && sb && sa.audio > 0 && sb.audio > 0 && sa.video > 0 && sb.video > 0) break;
  }
  console.log('inbound bytes A:', sa, ' B:', sb);
  results.T06_audio_bidirectional = sa.audio > 0 && sb.audio > 0;
  results.T07_video_bidirectional = sa.video > 0 && sb.video > 0;

  // チャット
  await A.page.evaluate(() => APP.conference._room.sendTextMessage('hello from Alice'));
  await B.page.waitForFunction(() =>
    (APP.store.getState()['features/chat'].messages || []).some(m => m.message === 'hello from Alice'), { timeout: 15000 });
  results.T09_chat = true;

  // 画面共有
  try {
    await A.page.mouse.move(400, 400);
    await A.page.waitForSelector('[aria-label="Start sharing your screen"]', { timeout: 10000 });
    await A.page.evaluate(() => document.querySelector('[aria-label="Start sharing your screen"]').click());
    await sleep(5000);
    console.log('A tracks after click:', await A.page.evaluate(() => JSON.stringify(APP.store.getState()['features/base/tracks'].filter(t => t.local).map(t => [t.mediaType, t.videoType, t.muted]))));
    await B.page.waitForFunction(() =>
      APP.conference._room.getParticipants().some(p => p.getTracks().some(t => t.getVideoType && t.getVideoType() === 'desktop')),
      { timeout: 20000 });
    results.T08_screenshare_received = true;
  } catch (e) {
    results.T08_screenshare_received = 'FAILED: ' + e.message.split('\n')[0];
  }

  console.log('room:', room);
  console.log(JSON.stringify(results, null, 2));
  await A.browser.close(); await B.browser.close();
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });

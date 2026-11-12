/* Voxel Bellandur — functional test suite.
   node tests/spec.js   (PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1) */
const { chromium } = require('playwright');
const path = require('path');

const URL = 'file://' + path.join(__dirname, '..', 'voxel-bellandur.html');
let pass = 0, fail = 0;
const results = [];
function ok(cond, name, detail) {
  if (cond) { pass++; results.push('  PASS  ' + name + (detail ? '   [' + detail + ']' : '')); }
  else { fail++; results.push('  FAIL  ' + name + (detail ? '   [' + detail + ']' : '')); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 640, height: 420 } });
  page.setDefaultTimeout(300000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message.split('\n')[0]));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction('window.__vb!==undefined', { timeout: 300000 });
  const boot = (Date.now() - t0) / 1000;
  await page.waitForTimeout(2000);

  /* ---------------------------------------------------------------- boot */
  const st = await page.evaluate(() => window.__vb.stats());
  /* wall-clock here includes software rasterisation of the first frames; the
     number that matters is the app's own boot timer */
  ok(st.boot < 12, 'in-app boot under 12 s', st.boot + ' s');
  ok(boot < 45, 'page reaches first frame (headless swiftshader)', boot.toFixed(1) + ' s');
  ok(st.lit > 200000, 'instanced voxels built', String(st.lit));
  ok(st.calls > 0 && st.calls < 40, 'draw calls stay low', String(st.calls));
  ok(st.vehicles >= 700, 'traffic populated', String(st.vehicles));
  ok(st.buildings > 4000, 'building count', String(st.buildings));

  /* ------------------------------------------------------------ day cycle */
  const t = async (h) => { await page.evaluate((hh) => window.__vb.setHour(hh), h); await page.waitForTimeout(260); return page.evaluate(() => window.__vb.timeState()); };
  const noon = await t(12.5), golden = await t(17.6), dusk = await t(19.4), night = await t(22.0), dawn = await t(6.2);
  ok(noon.sunI > 0.8, 'noon sun is full strength', noon.sunI);
  ok(noon.dusk < 0.05, 'no lights at noon', noon.dusk);
  ok(noon.spillOpacity <= 0.01, 'no light spill at noon', noon.spillOpacity);
  ok(night.dusk > 0.9, 'all lights on at night', night.dusk);
  ok(night.spillOpacity > 0.25, 'street light spill on at night', night.spillOpacity);
  ok(night.sunI < 0.02, 'sun is down at night', night.sunI);
  ok(dusk.sunI < noon.sunI && dusk.dusk > noon.dusk, 'sun fades as the lights come on');
  ok(golden.dusk > 0.02 && golden.dusk < 0.9, 'golden hour is a blend', golden.dusk);
  ok(dawn.dusk > 0.2, 'lights still on at dawn', dawn.dusk);
  ok(night.skyTop !== noon.skyTop, 'sky colour changes with the hour', night.skyTop + ' / ' + noon.skyTop);
  ok(noon.bloom !== night.bloom, 'bloom follows the light', noon.bloom + ' -> ' + night.bloom);
  /* the wave: the fraction of lit windows must rise monotonically through dusk */
  const frac = async (h) => {
    await page.evaluate((hh) => window.__vb.setHour(hh), h);
    await page.waitForTimeout(200);
    return page.evaluate(() => window.__vb.timeState().uDusk);
  };
  const f1 = await frac(17.4), f2 = await frac(18.6), f3 = await frac(19.6);
  ok(f1 < f2 && f2 < f3, 'lights switch on progressively, not all at once', `${f1} < ${f2} < ${f3}`);

  await page.evaluate(() => window.__vb.setHour(16.2));

  /* -------------------------------------------------------------- traffic */
  const sig = await page.evaluate(() => window.__vb.signals());
  ok(sig >= 5, 'signalised junctions found', String(sig));
  const before = await page.evaluate(() => window.__vb.vehicles());
  await page.evaluate(() => window.__vb.step(25));
  const after = await page.evaluate(() => window.__vb.vehicles());
  let moved = 0;
  for (let i = 0; i < before.length; i++) {
    if (Math.hypot(after[i].x - before[i].x, after[i].z - before[i].z) > 1) moved++;
  }
  ok(moved > before.length * 0.5, 'most vehicles move along the lane graph', moved + '/' + before.length);
  let queuedSeen = 0, movingSeen = 0;
  for (let k = 0; k < 12; k++) {
    await page.evaluate(() => window.__vb.step(4));
    const v = await page.evaluate(() => window.__vb.vehicles());
    const q = v.filter((x) => x.queued).length;
    queuedSeen = Math.max(queuedSeen, q);
    movingSeen = Math.max(movingSeen, v.length - q);
  }
  ok(queuedSeen > 0, 'vehicles stop and queue at signals', String(queuedSeen));
  ok(movingSeen > 300, 'traffic keeps flowing elsewhere', String(movingSeen));
  const onTrunk = after.filter((v) => v.cls <= 2).length / after.length;
  ok(onTrunk > 0.5, 'traffic concentrated on the trunk roads', (onTrunk * 100).toFixed(0) + '%');
  ok(after.some((v) => v.type === 'auto'), 'autorickshaws present');
  ok(after.some((v) => v.type === 'bus'), 'buses present');

  /* ---------------------------------------------------------- light spill */
  await page.evaluate(() => window.__vb.setHour(21.0));
  await page.evaluate(() => window.__vb.step(1));
  const spill = await page.evaluate(() => window.__vb.spill());
  ok(spill.cap > 500, 'light-spill layer allocated', String(spill.cap));
  ok(spill.dyn > 100, 'headlight smears driven per vehicle', String(spill.dyn));
  await page.evaluate(() => window.__vb.setHour(12.0));
  await page.evaluate(() => window.__vb.step(0.5));
  const spillDay = await page.evaluate(() => window.__vb.spill());
  ok(spillDay.opacity <= 0.02, 'spill vanishes in daylight', spillDay.opacity);

  /* ------------------------------------------------------------- presets */
  const poses = [];
  for (let i = 0; i < 5; i++) {
    await page.evaluate((p) => window.__vb.preset(p), i);
    await page.waitForTimeout(120);
    poses.push(await page.evaluate(() => [window.__vb.pos(), window.__vb.tgt()]));
  }
  let distinct = 0;
  for (let i = 1; i < 5; i++) if (Math.hypot(poses[i][0][0] - poses[i - 1][0][0], poses[i][0][2] - poses[i - 1][0][2]) > 20) distinct++;
  ok(distinct === 4, 'all five presets are distinct', String(distinct));

  /* --------------------------------------------------------------- atlas */
  await page.evaluate(() => window.__vb.preset(0));
  await page.evaluate(() => window.__vb.setAtlas(true));
  await page.evaluate(() => window.__vb.step(4));
  const atlasK = await page.evaluate(() => window.__vb.atlasK());
  const atlasPos = await page.evaluate(() => window.__vb.pos());
  ok(atlasK > 0.9, 'atlas morph reaches flat', atlasK);
  ok(atlasPos[1] > 600, 'atlas camera goes top-down', atlasPos[1]);
  await page.evaluate(() => window.__vb.setAtlas(false));
  await page.evaluate(() => window.__vb.step(4));
  const backK = await page.evaluate(() => window.__vb.atlasK());
  ok(backK < 0.1, 'atlas morph reverses', backK);

  /* --------------------------------------------------------------- chase */
  await page.evaluate(() => window.__vb.setChase(true));
  await page.evaluate(() => window.__vb.step(3));
  const ch = await page.evaluate(() => {
    const v = window.__vb.vehicles()[window.__vb.chaseIdx() % window.__vb.vehicles().length];
    const p = window.__vb.pos();
    return { d: Math.hypot(p[0] - v.x, p[2] - v.z), y: p[1] };
  });
  ok(ch.d < 30, 'chase camera sits on a vehicle', ch.d.toFixed(1));
  ok(ch.y < 20, 'chase camera is at street level', ch.y);
  await page.evaluate(() => window.__vb.setChase(false));

  /* --------------------------------------------------------------- audio */
  const a0 = await page.evaluate(() => window.__vb.audio.state());
  ok(a0.on === false, 'audio is off until asked', a0.state);
  const a1 = await page.evaluate(() => window.__vb.audio.start().toString() && window.__vb.audio.state());
  ok(a1.on === true && a1.gain > 0.01, 'audio starts on demand', JSON.stringify(a1));
  const a2 = await page.evaluate(() => { window.__vb.audio.stop(); return window.__vb.audio.state(); });
  ok(a2.on === false && a2.gain < 0.01, 'audio stops cleanly', JSON.stringify(a2));

  /* ------------------------------------------------------------ postcard */
  const card = await page.evaluate(() => window.__vb.postcard(1));
  ok(typeof card === 'string' && card.length > 20000, 'postcard renders a captioned PNG', (card.length / 1024 | 0) + ' kB');

  /* ---------------------------------------------------------------- hash */
  const h1 = await page.evaluate(() => { window.__vb.preset(3); return window.__vb.hash(); });
  ok(/^#p=[-\d.,]+&t=[-\d.,]+&h=[\d.]+/.test(h1), 'camera state serialises to a permalink', h1.slice(0, 40));
  const h2 = await page.evaluate(() => { window.__vb.applyHash('#p=10,120,240&t=0,0,0&h=19.6'); return [window.__vb.pos(), window.__vb.hour()]; });
  ok(near(h2[0][1], 120, 1.5) && near(h2[1], 19.6, 0.1), 'permalink restores camera and hour', JSON.stringify(h2[0]));

  /* ------------------------------------------------------------ UI toggles */
  /* the headless renderer runs at well under 1 fps, which starves Playwright's
     "stable element" check; the buttons are verified clickable by hit test below,
     so the actual clicks skip that check */
  const clickSafe = async (sel) => {
    await page.evaluate((s) => document.querySelector(s).click(), sel);
    await page.waitForTimeout(120);
    return true;
  };
  const clickable = async (id) => page.evaluate((i) => {
    const e = document.getElementById(i); if (!e) return false;
    const b = e.getBoundingClientRect();
    const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return !!t && (t === e || e.contains(t));
  }, id);
  for (const id of ['btnAtlas', 'btnChase', 'btnSound', 'btnCard', 'btnPlay', 'btnLabels', 'btnBloom', 'btnTime', 'hour']) {
    ok(await clickable(id), 'control is on top and clickable: #' + id);
  }
  const uiState = async () => page.evaluate(() => ({
    labels: document.getElementById('btnLabels').classList.contains('on'),
    bloom: document.getElementById('btnBloom').classList.contains('on'),
    hide: document.body.classList.contains('hideui'),
    living: document.getElementById('btnAnim').classList.contains('on'),
    sound: document.getElementById('btnSound').classList.contains('on'),
  }));
  const lab0 = (await uiState()).labels;
  await clickSafe('#btnLabels'); await page.waitForTimeout(150);
  const lab1 = (await uiState()).labels;
  ok(lab1 === !lab0, 'labels button toggles', lab0 + ' -> ' + lab1);
  await clickSafe('#btnLabels'); await page.waitForTimeout(150);
  ok((await uiState()).labels === lab0, 'labels button toggles back');
  await clickSafe('#btnBloom'); await page.waitForTimeout(150);
  ok((await uiState()).bloom === false, 'bloom button toggles');
  await clickSafe('#btnBloom');
  await page.keyboard.press('h'); await page.waitForTimeout(150);
  ok((await uiState()).hide === true, 'H hides the UI');
  await page.keyboard.press('h');
  await clickSafe('#btnAnim'); await page.waitForTimeout(150);
  ok((await uiState()).living === false, 'living button freezes the city');
  await clickSafe('#btnAnim');
  await clickSafe('#btnSound'); await page.waitForTimeout(300);
  ok((await uiState()).sound === true, 'sound button starts audio');
  ok((await page.evaluate(() => window.__vb.audio.state())).on === true, 'sound button really turns the audio on');
  await clickSafe('#btnSound');
  await clickSafe('#btnTime'); await page.waitForTimeout(400);
  const ev = await page.evaluate(() => window.__vb.timeState());
  ok(ev.h > 18, 'evening button drives the hour', ev.h);
  await clickSafe('#btnTime');

  /* slider */
  await page.evaluate(() => {
    const el = document.getElementById('hour');
    el.value = '21.5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const sl = await page.evaluate(() => window.__vb.hour());
  ok(near(sl, 21.5, 0.2), 'hour slider scrubs the day', sl);

  ok(errors.length === 0, 'no console errors', errors.slice(0, 2).join(' | ') || 'clean');

  console.log('\n' + results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SUITE CRASH', e.message); process.exit(2); });

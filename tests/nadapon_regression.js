// 邪魔ポン・ダブロン・三家和・ロン取り戻しの回帰テスト（37件）
//
// 実際の index.html を実ブラウザ（Playwright/Chromium）で動かし、本物のボタンを押して結果を記録する。
// 手牌と捨て牌だけを場面に合わせて差し替え、進行・判定・ボタンの処理は index.html のものをそのまま使う。
//
// 使い方（リポジトリ直下で静的サーバーを立ててから）:
//   python -m http.server 8811 --bind 127.0.0.1
//   node tests/nadapon_regression.js --out before.json          # 結果を保存
//   node tests/nadapon_regression.js --compare before.json after.json   # 2つの結果を突き合わせる
// 環境変数:
//   NADAPON_URL        既定 http://127.0.0.1:8811/index.html
//   PLAYWRIGHT_MODULE  playwright をリポジトリ外に入れている場合、そのパス（例: /path/to/node_modules/playwright）
//   CHROMIUM_PATH      Chromium の実行ファイル（省略時は Playwright の既定）
//
// 比較するのは「何が成立したか」（チー・ポン・カン・ロン・流局、窓が開いたか、ボタンが押せたか）だけ。
// 発声などの時刻は timing に別に記録し、比較には含めない。

const fs = require('fs');
const path = require('path');

const URL = process.env.NADAPON_URL || 'http://127.0.0.1:8811/index.html';

// 牌の書き方: 1m〜9m / 1p〜9p / 1s〜9s、0m・0p・0s は赤5、1z〜4z は東南西北、5z〜7z は白發中
function parse(str) {
  const out = [];
  const re = /(\d+)([mpsz])/g;
  let m;
  while ((m = re.exec(str))) {
    for (const ch of m[1]) {
      const n = Number(ch);
      const suit = { m: 'man', p: 'pin', s: 'sou' }[m[2]];
      if (m[2] === 'z') out.push(n <= 4 ? { suit: 'wind', num: n } : { suit: 'dragon', num: n - 4 });
      else if (n === 0) out.push({ suit, num: 5, red: true });
      else out.push({ suit, num: n });
    }
  }
  return out;
}

// よく使う手牌
const H = {
  pon5: '55m19p19s123z567z2p',          // 5萬ポンだけできる（聴牌していない）
  pon5red: '05m19p19s123z567z2p',       // 赤5＋5萬
  kan5: '555m19p19s123z56z2p',          // 5萬3枚（ポン・カン両方）
  chi46: '46m123456p78p119s',           // 4萬6萬でチー可、聴牌していない（チーでシャンテンが進む）
  filler: '234678s33p123m89m',          // 何もできない手
  filler2: '19m19p19s1234z567z',         // 何もできない手（国士1シャンテン、5萬は関係ない）
  discarder: '5m234678s66p778m9m4z',     // 先頭の5萬を捨てる
  discarderRed: '0m234678s66p778m9m4z',  // 先頭の赤5萬を捨てる
  ron5: '123456789p777z5m',             // 5萬単騎（中の暗刻で役あり）
  ron5b: '123456789s777z5m',            // 5萬単騎（別の手）
  ron5c: '123789p456s777z5m',            // 5萬単騎（3人目用）
  ronPon5: '123456p777z55m99s',         // 5萬・9索のシャンポン（ロン＋ポン可）
};

// 37件の場面
function cases() {
  const list = [];
  const jama = (id, discarder, extra) => list.push({ id, rule: 'akaNeo', discarder, ...extra });
  for (const d of ['top', 'right']) {
    const chiSeat = d === 'top' ? 'left' : 'top';
    const other = d === 'top' ? 'right' : 'left';
    const base = { hands: { bottom: H.pon5, [chiSeat]: H.chi46, [other]: H.filler, [d]: H.discarder } };
    jama(`J-${d}-放置`, d, { ...base, actions: [{ at: 0, click: 'throughBtn' }] });
    jama(`J-${d}-窓内ポン`, d, { ...base, actions: [{ at: 0, click: 'throughBtn' }, { at: 1000, click: 'ponBtn' }] });
    jama(`J-${d}-窓後ポン`, d, { ...base, actions: [{ at: 0, click: 'throughBtn' }, { at: 3300, click: 'ponBtn' }] });
    jama(`J-${d}-窓内スルーで即確定`, d, { ...base, actions: [{ at: 0, click: 'throughBtn' }, { at: 800, click: 'throughBtn' }] });
    jama(`J-${d}-窓内カン`, d, { hands: { ...base.hands, bottom: H.kan5 }, actions: [{ at: 0, click: 'throughBtn' }, { at: 1000, click: 'kanBtn' }] });
    jama(`J-${d}-赤5手で窓内ポン`, d, { hands: { ...base.hands, bottom: H.pon5red }, actions: [{ at: 0, click: 'throughBtn' }, { at: 1000, click: 'ponBtn' }] });
    jama(`J-${d}-赤5捨てで窓内ポン`, d, { hands: { ...base.hands, [d]: H.discarderRed }, actions: [{ at: 0, click: 'throughBtn' }, { at: 1000, click: 'ponBtn' }] });
    jama(`J-${d}-CPUがチーしない`, d, { ...base, random: 0.99, actions: [{ at: 0, click: 'throughBtn' }] });
  }
  jama('J-left-スルー(チーは自分だけ)', 'left', { hands: { bottom: H.pon5, top: H.filler, right: H.filler2, left: H.discarder }, actions: [{ at: 0, click: 'throughBtn' }] });
  jama('J-left-その場でポン', 'left', { hands: { bottom: H.pon5, top: H.filler, right: H.filler2, left: H.discarder }, actions: [{ at: 0, click: 'ponBtn' }] });
  jama('J-top-その場でポン', 'top', { hands: { bottom: H.pon5, left: H.chi46, right: H.filler, top: H.discarder }, actions: [{ at: 0, click: 'ponBtn' }] });
  for (const r of ['original', 'mLeagueOriginal', 'wwStandard', 'wwPremium']) {
    list.push({ id: `J-${r}-邪魔ポン無効`, rule: r, discarder: 'top', hands: { bottom: H.pon5, left: H.chi46, right: H.filler, top: H.discarder }, actions: [{ at: 0, click: 'throughBtn' }] });
  }
  // ダブロン
  list.push({ id: 'W-akaNeo-自分和了', rule: 'akaNeo', discarder: 'top', hands: { bottom: H.ron5, left: H.ron5b, right: H.filler, top: H.discarder }, actions: [{ at: 0, click: 'winBtn' }] });
  list.push({ id: 'W-akaNeo-自分スルー', rule: 'akaNeo', discarder: 'top', hands: { bottom: H.ron5, left: H.ron5b, right: H.filler, top: H.discarder }, actions: [{ at: 0, click: 'throughBtn' }] });
  list.push({ id: 'W-akaNeo-CPUだけ2人', rule: 'akaNeo', discarder: 'top', hands: { bottom: H.filler2, left: H.ron5, right: H.ron5b, top: H.discarder }, actions: [] });
  list.push({ id: 'W-original-頭ハネ(自分と上家)', rule: 'original', discarder: 'top', hands: { bottom: H.ron5, left: H.ron5b, right: H.filler, top: H.discarder }, actions: [{ at: 0, click: 'winBtn' }] });
  list.push({ id: 'W-original-頭ハネ(CPU2人)', rule: 'original', discarder: 'top', hands: { bottom: H.filler2, left: H.ron5, right: H.ron5b, top: H.discarder }, actions: [] });
  list.push({ id: 'W-akaNeo-ダブロン時はポン無し', rule: 'akaNeo', discarder: 'top', hands: { bottom: H.ronPon5, left: H.ron5b, right: H.filler, top: H.discarder }, actions: [{ at: 0, click: 'throughBtn' }] });
  // 三家和
  list.push({ id: 'S-他家打牌-自分和了', rule: 'akaNeo', discarder: 'top', hands: { bottom: H.ron5, left: H.ron5b, right: H.ron5c, top: H.discarder }, actions: [{ at: 0, click: 'winBtn' }] });
  list.push({ id: 'S-他家打牌-自分スルー', rule: 'akaNeo', discarder: 'top', hands: { bottom: H.ron5, left: H.ron5b, right: H.ron5c, top: H.discarder }, actions: [{ at: 0, click: 'throughBtn' }] });
  list.push({ id: 'S-自分打牌-CPU3人', rule: 'akaNeo', discarder: 'bottom', hands: { bottom: H.discarder, left: H.ron5b, right: H.ron5c, top: H.ron5 }, actions: [] });
  // ロン取り戻し
  list.push({ id: 'R-ロン+ポンをスルー→上家チー', rule: 'akaNeo', discarder: 'top', hands: { bottom: H.ronPon5, left: H.chi46, right: H.filler, top: H.discarder }, actions: [{ at: 0, click: 'throughBtn' }, { at: 1000, probe: 'winBtn' }] });
  list.push({ id: 'R-ロン+ポンをスルー→窓内ポン→和了', rule: 'akaNeo', discarder: 'top', hands: { bottom: H.ronPon5, left: H.chi46, right: H.filler, top: H.discarder }, actions: [{ at: 0, click: 'throughBtn' }, { at: 800, click: 'ponBtn' }, { at: 1200, click: 'winBtn' }] });
  list.push({ id: 'R-ロンだけスルー(ポン無し)→上家チー可', rule: 'akaNeo', discarder: 'top', hands: { bottom: H.ron5, left: H.chi46, right: H.filler, top: H.discarder }, actions: [{ at: 0, click: 'throughBtn' }] });
  list.push({ id: 'R-CPU邪魔ポン窓-和了で取り戻す', rule: 'akaNeo', direct: 'ronOnly', discarder: 'top', hands: { bottom: H.ron5, left: H.chi46, right: H.pon5, top: H.discarder }, actions: [{ at: 1000, click: 'winBtn' }] });
  list.push({ id: 'R-CPU邪魔ポン窓-放置', rule: 'akaNeo', direct: 'ronOnly', discarder: 'top', hands: { bottom: H.ron5, left: H.chi46, right: H.pon5, top: H.discarder }, actions: [] });
  list.push({ id: 'R-CPU邪魔ポン窓-見逃し無しなら窓なし', rule: 'akaNeo', direct: 'cpuResponder', discarder: 'top', hands: { bottom: H.filler2, left: H.chi46, right: H.pon5, top: H.discarder }, actions: [] });
  return list;
}

async function runCase(browser, c) {
  const ctx = await browser.newContext();
  await ctx.addInitScript((rid) => { try { sessionStorage.clear(); localStorage.clear(); sessionStorage.setItem('mugenMahjongRedSelectedRuleId', rid); } catch (e) {} }, c.rule);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // 起動直後の1回目の読み込みが返ってこないことがあるため、短めの待ちで3回まで試す
  for (let i = 0; ; i++) {
    try { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 8000 }); break; }
    catch (e) { if (i >= 2) throw e; }
  }
  await page.waitForFunction(() => typeof handleDiscard === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(200);

  const handsIn = {};
  for (const [s, str] of Object.entries(c.hands)) handsIn[s] = parse(str);

  const offered = await page.evaluate(({ c, hs }) => {
    turnGeneration++; // 自動で進む手番を止める
    const replace = (arr, tiles) => arr.splice(0, arr.length, ...tiles.map(t => ({ ...t })));
    for (const s of ['bottom', 'right', 'top', 'left']) {
      replace(s === 'bottom' ? myHandTiles : hands[s], hs[s] || []);
      melds[s].length = 0; discards[s].length = 0; discardHistory[s].length = 0;
      riichiDeclared[s] = false; furitenTemp[s] = false; furitenRiichi[s] = false; ippatsuActive[s] = false;
    }
    passedRon.bottom = null; lastDrawnTile = null; pendingSelfKan = null;
    if (c.random != null) { const v = c.random; Math.random = () => v; } else { Math.random = () => 0; }

    // 呼ばれた処理を記録する（index.html の関数はグローバルなので、差し替えれば内部の呼び出しも通る）
    const log = window.__log = [];
    const now = () => performance.now();
    const wrap = (name, fn) => { const o = window[name]; window[name] = function (...a) { fn(a); return o.apply(this, a); }; };
    const tiles = ts => (ts || []).map(t => t.num + t.suit[0] + (t.red ? 'r' : '')).join(',');
    wrap('executeChi', a => { log.push({ t: now(), ev: 'chi', by: a[0], from: a[1] }); setTimeout(() => turnGeneration++, 0); });
    wrap('executeCall', a => { log.push({ t: now(), ev: a[3], by: a[0], from: a[1], tiles: tiles(a[4]) }); if (a[0] !== 'bottom') setTimeout(() => turnGeneration++, 0); });
    wrap('finalizeRon', a => log.push({ t: now(), ev: 'ron', winners: a[0].map(w => w.seat).join('+') }));
    wrap('handleSankahou', a => log.push({ t: now(), ev: 'sankahou' }));
    wrap('openNadaponWindow', a => log.push({ t: now(), ev: 'window', kind: 'chi', pon: a[4].pon, kan: a[4].kan }));
    wrap('openNadaponWindowRonOnly', a => log.push({ t: now(), ev: 'window', kind: 'ronOnly' }));
    wrap('playSfx', a => log.push({ t: now(), ev: 'sfx', src: String(a[0]).split('/').pop() }));
    const oST = window.setTimeout;
    window.setTimeout = function (fn, ms, ...rest) { if (ms === NADAPON_WINDOW_MS) log.push({ t: now(), ev: 'timer3s' }); return oST.call(this, fn, ms, ...rest); };
    const oAdv = window.advanceTurnAfterDiscard;
    window.advanceTurnAfterDiscard = function (seat) { log.push({ t: now(), ev: 'advance', seat }); turnGeneration++; };

    renderMyHand(false);
    window.__t0 = now();
    const d = c.discarder;
    const tile = (d === 'bottom' ? myHandTiles : hands[d])[0];
    if (c.direct === 'ronOnly' || c.direct === 'cpuResponder') {
      // CPU同士の邪魔ポン（上家チーに下家がポンで割り込む）の窓を、index.html の関数を直接呼んで開く
      if (c.direct === 'ronOnly') passedRon.bottom = { tile, discarderSeat: d };
      hands[d].splice(0, 1); discards[d].push(tile); discardHistory[d].push(tileKey(tile));
      const combo = hands.left.filter(t => t.suit === 'man' && (t.num === 4 || t.num === 6));
      const ponTiles = hands.right.filter(t => t.suit === 'man' && t.num === 5).slice(0, 2);
      const origNada = window.shouldCpuNadaPon;
      window.shouldCpuNadaPon = (seat, t, type) => (seat === 'right' && type === 'pon') ? ponTiles : null;
      voiceChiAndMaybeOpenWindow(d, tile, 'left', combo, { seat: 'right', pon: true, kan: false });
      window.shouldCpuNadaPon = origNada;
    } else {
      const hand = d === 'bottom' ? myHandTiles : hands[d];
      hand.splice(0, 1); tile.tsumogiri = false;
      discards[d].push(tile); discardHistory[d].push(tileKey(tile));
      renderDiscard(d);
      handleDiscard(d, tile);
    }
    const en = id => !document.getElementById(id).disabled;
    return { win: en('winBtn'), through: en('throughBtn'), chi: en('chiBtn'), pon: en('ponBtn'), kan: en('kanBtn') };
  }, { c, hs: handsIn });

  const actions = [];
  const start = Date.now();
  for (const a of c.actions) {
    const wait = a.at - (Date.now() - start);
    if (wait > 0) await page.waitForTimeout(wait);
    if (a.probe) {
      const en = await page.evaluate(id => !document.getElementById(id).disabled, a.probe);
      actions.push(`${a.probe}:${en ? '押せる' : '押せない'}`);
      continue;
    }
    const en = await page.evaluate(id => !document.getElementById(id).disabled, a.click);
    if (en) await page.click('#' + a.click);
    actions.push(`${a.click}:${en ? '押した' : '無効'}`);
  }
  await page.waitForTimeout(3600);

  const res = await page.evaluate(() => {
    const t0 = window.__t0;
    return {
      log: window.__log.map(x => ({ ...x, t: Math.round(x.t - t0) })),
      furitenBottom: furitenTemp.bottom,
      bottomMelds: melds.bottom.map(m => m.type + ':' + m.handTiles.map(t => t.num + t.suit[0] + (t.red ? 'r' : '')).join(',')),
    };
  });
  await ctx.close();

  const ev = res.log.filter(x => x.ev !== 'sfx' && x.ev !== 'timer3s');
  const sfx = res.log.filter(x => x.ev === 'sfx');
  const signature = {
    offered,
    actions,
    events: ev.map(x => [x.ev, x.by || x.winners || x.kind || x.seat || '', x.tiles || '', x.pon != null ? `pon${x.pon}kan${x.kan}` : ''].filter(Boolean).join(':')),
    bottomMelds: res.bottomMelds,
    furitenBottom: res.furitenBottom,
    errors,
  };
  const find = (pred) => { const x = res.log.find(pred); return x ? x.t : null; };
  const timing = {
    windowOpen: find(x => x.ev === 'window'),
    timer3sStart: find(x => x.ev === 'timer3s'),
    chiVoice: find(x => x.ev === 'sfx' && /chi/.test(x.src)),
    chiDone: find(x => x.ev === 'chi'),
    sfx: sfx.map(x => `${x.t}:${x.src}`).join(' '),
  };
  return { id: c.id, signature, timing };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--compare') {
    const a = JSON.parse(fs.readFileSync(args[1], 'utf8'));
    const b = JSON.parse(fs.readFileSync(args[2], 'utf8'));
    let diff = 0;
    for (const x of a) {
      const y = b.find(r => r.id === x.id);
      const same = y && JSON.stringify(x.signature) === JSON.stringify(y.signature);
      if (!same) diff++;
      console.log(`${same ? '同じ' : '違う'}  ${x.id}` + (same ? '' : `\n   前: ${JSON.stringify(x.signature)}\n   後: ${JSON.stringify(y && y.signature)}`));
    }
    console.log(`\n${a.length}件中 ${a.length - diff}件同じ、${diff}件違う`);
    process.exit(diff ? 1 : 0);
  }
  const outIdx = args.indexOf('--out');
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const launch = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  const browser = await chromium.launch(launch);
  const results = [];
  try {
    for (const c of cases().filter(c => !only || c.id.includes(only))) {
      const r = await runCase(browser, c);
      results.push(r);
      console.error(`${r.id}  ${r.signature.events.join(' / ') || '(何も起きない)'}${r.signature.errors.length ? '  エラー:' + r.signature.errors[0] : ''}`);
    }
  } finally {
    await browser.close();
  }
  const json = JSON.stringify(results, null, 1);
  if (outIdx >= 0) fs.writeFileSync(args[outIdx + 1], json);
  else console.log(json);
  console.error(`\n${results.length}件 実行`);
}

main();

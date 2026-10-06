// push 前の自動チェック（.githooks/pre-push から呼ばれる）
//
// 1. index.html の <script> を取り出して node --check で構文を確認する
// 2. 回帰テスト tests/nadapon_regression.js を実ブラウザで走らせ、
//    正解の記録 tests/nadapon_expected.json と突き合わせる
// どちらかが失敗したら終了コード 1 を返す（＝ push が止まる）。
//
// 使い方（リポジトリ直下で）:
//   node tests/prepush_check.js                    # 作業フォルダの index.html を確認
//   node tests/prepush_check.js --rev <コミット>   # そのコミットの index.html を確認（フックはこちら）
//   node tests/prepush_check.js --update-baseline  # 挙動を意図して変えたとき、正解の記録を作り直す
//
// 準備: 初回と git clone の直後に `npm install` と `git config core.hooksPath .githooks`

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED = path.join(__dirname, 'nadapon_expected.json');
const REGRESSION = path.join(__dirname, 'nadapon_regression.js');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

const args = process.argv.slice(2);
const rev = args.includes('--rev') ? args[args.indexOf('--rev') + 1] : null;
const update = args.includes('--update-baseline');

function git(...a) { return execFileSync('git', a, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }); }

// 同じコミットを同じテストで確認済みなら、2回目は省く（push 先が2つあるとフックが2回呼ばれるため）
function cacheKey() {
  const h = crypto.createHash('sha1').update(rev);
  for (const f of [__filename, REGRESSION, EXPECTED]) h.update(fs.readFileSync(f));
  return h.digest('hex');
}
function cacheFile() { return path.resolve(ROOT, git('rev-parse', '--git-path', 'prepush-passed').toString().trim()); }

function checkSyntax(html, tmp) {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, n = 0;
  while ((m = re.exec(html))) {
    n++;
    const file = path.join(tmp, `script${n}.js`);
    // <script> より前の行数ぶん空行を足し、エラーの行番号を index.html の行番号に合わせる
    fs.writeFileSync(file, '\n'.repeat(html.slice(0, m.index).split('\n').length - 1) + m[1]);
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status !== 0) {
      console.error(r.stderr.split(file).join('index.html'));
      return false;
    }
  }
  if (n === 0) { console.error('index.html に <script> が見つからない'); return false; }
  return true;
}

// index.html だけ確認対象の中身を返し、画像や音は作業フォルダから返す静的サーバー
function startServer(html) {
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
    if (p === '/' || p === '/index.html') { res.writeHead(200, { 'Content-Type': MIME['.html'] }); return res.end(html); }
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function runRegression(url, out) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [REGRESSION, '--out', out], { cwd: ROOT, env: { ...process.env, NADAPON_URL: url }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => resolve({ code, err }));
  });
}

function compare(expected, actual) {
  let diff = 0;
  for (const x of expected) {
    const y = actual.find(r => r.id === x.id);
    if (y && JSON.stringify(x.signature) === JSON.stringify(y.signature)) continue;
    diff++;
    console.error(`違う  ${x.id}\n   正解: ${JSON.stringify(x.signature)}\n   今回: ${JSON.stringify(y && y.signature)}`);
  }
  for (const y of actual) {
    if (!expected.find(r => r.id === y.id)) { diff++; console.error(`正解の記録に無い場面  ${y.id}`); }
  }
  return diff;
}

async function main() {
  let passedFile = null, key = null;
  if (rev && !update) {
    passedFile = cacheFile(); key = cacheKey();
    if (fs.existsSync(passedFile) && fs.readFileSync(passedFile, 'utf8').trim() === key) {
      console.error(`[push前チェック] ${rev.slice(0, 7)} は確認済みなので省略`);
      return 0;
    }
  }
  const html = rev ? git('show', `${rev}:index.html`).toString('utf8') : fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mugen-prepush-'));
  try {
    console.error(`[push前チェック] 1/2 構文確認（${rev ? rev.slice(0, 7) : '作業フォルダ'} の index.html）`);
    if (!checkSyntax(html, tmp)) { console.error('[push前チェック] 失敗: index.html に構文エラーがある'); return 1; }
    console.error('[push前チェック] 1/2 構文確認 OK');

    console.error('[push前チェック] 2/2 回帰テスト（3〜4分かかる）');
    try { require.resolve('playwright', { paths: [__dirname] }); }
    catch (e) { console.error('[push前チェック] 失敗: playwright が入っていない。リポジトリ直下で npm install を実行する'); return 1; }
    const server = await startServer(html);
    const out = path.join(tmp, 'result.json');
    const r = await runRegression(`http://127.0.0.1:${server.address().port}/index.html`, out);
    server.close();
    if (r.code !== 0 || !fs.existsSync(out)) { console.error(r.err); console.error('[push前チェック] 失敗: 回帰テストを最後まで実行できなかった'); return 1; }
    const actual = JSON.parse(fs.readFileSync(out, 'utf8'));
    if (update) {
      fs.writeFileSync(EXPECTED, JSON.stringify(actual.map(x => ({ id: x.id, signature: x.signature })), null, 1) + '\n');
      console.error(`[push前チェック] 正解の記録を作り直した（${actual.length}件）: tests/nadapon_expected.json`);
      return 0;
    }
    if (!fs.existsSync(EXPECTED)) { console.error('[push前チェック] 失敗: tests/nadapon_expected.json が無い'); return 1; }
    const expected = JSON.parse(fs.readFileSync(EXPECTED, 'utf8'));
    const diff = compare(expected, actual);
    if (diff) { console.error(`[push前チェック] 失敗: 回帰テスト ${expected.length}件中 ${diff}件が正解と違う`); return 1; }
    console.error(`[push前チェック] 2/2 回帰テスト OK（${expected.length}件すべて一致）`);
    if (passedFile) fs.writeFileSync(passedFile, key + '\n');
    return 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().then(code => process.exit(code), e => { console.error(e); console.error('[push前チェック] 失敗: チェック自体が異常終了した'); process.exit(1); });

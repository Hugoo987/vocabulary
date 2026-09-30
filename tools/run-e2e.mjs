#!/usr/bin/env node
// 一次跑完所有端對端測試：自己開靜態伺服器與 Firebase 模擬伺服器，跑完再關掉。
//
//   npm test                 # 全部
//   npm test -- grammar      # 只跑名字含 grammar 的那幾套
//
// CI 和本機用同一條指令，避免「我本機有跑、CI 沒跑」。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.QUIZ_PORT || 8099);
const MOCK_PORT = 8100;
const only = process.argv.slice(2).filter(a => !a.startsWith('-'));

const MIME = { '.html':'text/html; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.ics':'text/calendar; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml' };

// 靜態伺服器：直接用 node 內建，不必依賴 http-server 有沒有裝
const serve = (req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
};

function run(cmd, args, env) {
  return new Promise(resolve => {
    const p = spawn(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
    p.on('close', code => resolve(code));
  });
}

const suites = fs.readdirSync(path.join(root, 'tools'))
  .filter(f => /^e2e.*\.mjs$/.test(f))
  .filter(f => !only.length || only.some(o => f.includes(o)))
  .sort();

if (!suites.length) { console.error('沒有符合的測試檔'); process.exit(1); }

// 這台機器上可能已經有人開著同樣的 port（我自己開發時常開著），有就直接用
const busy = async port => await new Promise(r => {
  const s = createServer(); s.once('error', () => r(true)); s.once('listening', () => s.close(() => r(false)));
  s.listen(port);
});
let web = null, mock = null;
if (await busy(PORT)) {
  console.log(`（port ${PORT} 已經有伺服器在跑，直接用它）`);
} else {
  web = createServer(serve);
  await new Promise(r => web.listen(PORT, r));
}
if (await busy(MOCK_PORT)) {
  console.log(`（port ${MOCK_PORT} 已經有模擬伺服器，直接用它）`);
} else {
  mock = spawn('node', [path.join(root, 'tools', 'mock-firebase.mjs')], { cwd: root, stdio: 'ignore' });
}
await new Promise(r => setTimeout(r, 400));

let failed = [];
for (const s of suites) {
  console.log(`\n━━━━━━ ${s} ━━━━━━`);
  const code = await run('node', [path.join('tools', s)],
    { QUIZ_URL: `http://127.0.0.1:${PORT}/index.html`, MOCK_DB: `http://127.0.0.1:${MOCK_PORT}` });
  if (code !== 0) failed.push(s);
}

if (mock) mock.kill();
if (web) web.close();

console.log('\n════════════════════════════════');
console.log(`跑了 ${suites.length} 套：${suites.length - failed.length} 過、${failed.length} 失敗`);
if (failed.length) { console.error('失敗：' + failed.join('、')); process.exit(1); }
console.log('✅ 全部通過');

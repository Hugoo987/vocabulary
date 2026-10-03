#!/usr/bin/env node
// 把所有題庫內容打包成一個帶內容雜湊的檔案：bank/bank.<hash>.json
//
//   node tools/build-bank.js     （或 npm run build）
//
// 為什麼要拆出來：題庫（總複習 1112 字＋例句＋文法＋文章）佔了 index.html 的
// 八成。以前改一行程式，學生就要把整包重新下載一次。拆開之後檔名帶雜湊，
// 內容沒變就吃瀏覽器快取；改程式只需要重新下載很小的 index.html。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const read = f => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));

const bank = {
  review: read('review-words.json'),
  alt: read('alt-sentences.json'),
  articles: read('articles.json'),
  grammar: read('grammar.json'),
  police: read('police.json')
};
const json = JSON.stringify(bank);
const hash = crypto.createHash('sha1').update(json).digest('hex').slice(0, 10);
const name = `bank.${hash}.json`;

const dir = path.join(root, 'bank');
fs.mkdirSync(dir, { recursive: true });
// 舊的打包檔清掉，部署時才不會愈積愈多
fs.readdirSync(dir).filter(f => /^bank\.[0-9a-f]+\.json$/.test(f) && f !== name)
  .forEach(f => fs.unlinkSync(path.join(dir, f)));
fs.writeFileSync(path.join(dir, name), json);

const htmlPath = path.join(root, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const re = /const BANK_FILE = '[^']*';/;
if (!re.test(html)) { console.error('✗ index.html 找不到 BANK_FILE'); process.exit(1); }
fs.writeFileSync(htmlPath, html.replace(re, `const BANK_FILE = 'bank/${name}';`));

const kb = n => (n / 1024).toFixed(0) + ' KB';
console.log(`✅ bank/${name}（${kb(json.length)}）`);
console.log(`   總複習 ${bank.review.length} 字、額外例句 ${Object.keys(bank.alt).length} 個字、`
  + `文章 ${bank.articles.length} 篇、文法 ${bank.grammar.grammar.length}＋片語 ${bank.grammar.phrases.length}、`
  + `警專 ${bank.police.units.reduce((n, u) => n + u.words.length, 0)} 字（${bank.police.units.length} 單元）`);
console.log(`   index.html 現在 ${kb(fs.statSync(htmlPath).size)}`);

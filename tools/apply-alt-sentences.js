#!/usr/bin/env node
// 把 data/alt-sentences.json 併進 index.html 的 ALT_SENTENCES。
// 每次新增例句後跑：node tools/apply-alt-sentences.js && node tools/validate.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'alt-sentences.json'), 'utf8'));

const q = JSON.stringify;
const body = Object.keys(data).sort().map(en =>
  '  ' + q(en) + ': [' + data[en].map(q).join(', ') + ']'
).join(',\n');
const block = 'const ALT_SENTENCES = {\n' + body + '\n};';

const html = fs.readFileSync(htmlPath, 'utf8');
// 支援目前的空物件寫法，以及先前產生的多行寫法
const re = /const ALT_SENTENCES = \{[\s\S]*?\n\};|const ALT_SENTENCES = \{\};/;
if (!re.test(html)) {
  console.error('✗ 找不到 ALT_SENTENCES，index.html 是否被改過？');
  process.exit(1);
}
fs.writeFileSync(htmlPath, html.replace(re, block));

const words = Object.keys(data).length;
const sents = Object.values(data).reduce((n, a) => n + a.length, 0);
console.log(`✅ 已寫入 ${words} 個單字、${sents} 句額外例句`);

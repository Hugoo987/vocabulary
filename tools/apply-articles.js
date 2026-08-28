#!/usr/bin/env node
// 把 data/articles.json 寫進 index.html 的 ARTICLES。
// 改完文章後跑：node tools/apply-articles.js && node tools/validate.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
const arts = JSON.parse(fs.readFileSync(path.join(root, 'data', 'articles.json'), 'utf8'));

const q = JSON.stringify;
const body = arts.map(a => '  {\n' +
  ['id','title','zh','topic','text'].map(k => '    ' + k + ': ' + q(a[k])).join(',\n') +
  '\n  }').join(',\n');
const block = 'const ARTICLES = [\n' + body + '\n];';

const html = fs.readFileSync(htmlPath, 'utf8');
const re = /const ARTICLES = \[[\s\S]*?\n\];|const ARTICLES = \[\];/;
if (!re.test(html)) { console.error('✗ 找不到 ARTICLES'); process.exit(1); }
fs.writeFileSync(htmlPath, html.replace(re, block));

const blanks = arts.reduce((n, a) => n + (a.text.match(/\[\[(.+?)\]\]/g) || []).length, 0);
console.log(`✅ 已寫入 ${arts.length} 篇文章、${blanks} 個空格`);

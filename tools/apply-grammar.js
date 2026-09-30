#!/usr/bin/env node
// 把 data/grammar.json 寫進 index.html 的 GRAMMAR_DATA。
// 改完文法／片語內容後跑：node tools/apply-grammar.js && node tools/validate.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'grammar.json'), 'utf8'));

const block = 'const GRAMMAR_DATA = ' + JSON.stringify(data, null, 2) + ';';
const html = fs.readFileSync(htmlPath, 'utf8');
const re = /const GRAMMAR_DATA = \{[\s\S]*?\n\};/;
if (!re.test(html)) { console.error('✗ 找不到 GRAMMAR_DATA'); process.exit(1); }
fs.writeFileSync(htmlPath, html.replace(re, block));

const qs = [...data.grammar, ...data.phrases].reduce((n, x) => n + x.questions.length, 0);
console.log(`✅ 已寫入 ${data.grammar.length} 個文法點、${data.phrases.length} 個片語、${qs} 題練習`);

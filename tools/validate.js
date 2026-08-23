#!/usr/bin/env node
// 驗證題庫：跑 `node tools/validate.js`（HANDOFF.md 第四節第 3 點要求每次更新都要跑）
// 檢查項目：JS 可 parse、英文單字不重複、中文意思不重複、每個例句都有 ___
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!scripts.length) fail('找不到 <script> 區塊');

let problems = 0;
function fail(msg) { console.error('  ✗ ' + msg); problems++; }
function ok(msg) { console.log('  ✓ ' + msg); }

// 1. JS 語法
const js = scripts.join('\n');
try {
  new vm.Script(js);
  ok('JS 語法可正常 parse');
} catch (e) {
  fail('JS 語法錯誤：' + e.message);
  process.exit(1);
}

// 2. 取出題庫
const grab = (name, open, close, optional) => {
  // 先試多行版本，再試單行版本（空物件 {} 會寫在同一行）
  const m = js.match(new RegExp('const ' + name + ' = \\' + open + '[\\s\\S]*?\\n\\' + close + ';'))
         || js.match(new RegExp('const ' + name + ' = \\' + open + '[^\\n]*?\\' + close + ';'));
  if (!m) { if (!optional) fail('找不到 ' + name); return null; }
  return vm.runInNewContext('(' + m[0].replace('const ' + name + ' = ', '').replace(/;$/, '') + ')');
};
const WORDS = grab('WORDS', '{', '}');
const REVIEW_WORDS = grab('REVIEW_WORDS', '[', ']');
if (!WORDS || !REVIEW_WORDS) process.exit(1);

// WORDS 是 { cat: [[en, zh, sentence], ...] }，REVIEW_WORDS 是 [{en, zh, sentence, cat}, ...]
const flatWords = Object.entries(WORDS).flatMap(([cat, arr]) =>
  arr.map(([en, zh, sentence]) => ({ en, zh, sentence, cat })));

// 拆出各個義項，並忽略語尾的「的／地／得」——「大」和「大的」算同一個意思。
// 完全相同的中文由 checkSet 抓；這裡抓的是「語意重疊」，例如
// America 美國；美洲 vs USA 美國，中翻英時兩個選項都對。
function sensesOf(zh) {
  return String(zh || '').split(/[；;、]/)
    .map(s => s.replace(/[的地得]$/, '').trim())
    .filter(Boolean);
}

function checkOverlap(label, list) {
  const hits = [];
  const seen = new Set();
  for (const a of list) {
    for (const b of list) {
      if (a.en === b.en || a.zh === b.zh) continue;   // 完全相同的另外抓
      if (!sensesOf(a.zh).some(s => sensesOf(b.zh).includes(s))) continue;
      const key = [a.en, b.en].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(`${a.en}「${a.zh}」↔ ${b.en}「${b.zh}」`);
    }
  }
  if (hits.length) {
    // 警告而非錯誤：出題時 pickDistractors 會避開語意重疊的選項，
    // 所以不會真的出現兩個都對。但新增單字時看到這裡，代表值得把中文分清楚。
    console.log(`  ⚠ ${label} 有 ${hits.length} 組語意重疊（出題已自動避開，但建議區分清楚）：`);
    hits.forEach(h => console.log('      ' + h));
  } else {
    ok(`${label} 沒有語意重疊的中文`);
  }
}

function checkSet(label, list) {
  console.log('\n' + label + '（' + list.length + ' 字）');
  const seen = { en: new Map(), zh: new Map() };
  const noBlank = [];
  for (const w of list) {
    const key = w.en.toLowerCase();
    seen.en.set(key, (seen.en.get(key) || 0) + 1);
    seen.zh.set(w.zh, (seen.zh.get(w.zh) || 0) + 1);
    if (!w.sentence.includes('___')) noBlank.push(w.en);
  }
  const dupEn = [...seen.en].filter(([, n]) => n > 1).map(([k]) => k);
  const dupZh = [...seen.zh].filter(([, n]) => n > 1).map(([k]) => k);
  dupEn.length ? fail('重複的英文單字：' + dupEn.join('、')) : ok('沒有重複的英文單字');
  // 中文意思重複最致命：會出現「兩個選項都對」
  dupZh.length ? fail('重複的中文意思：' + dupZh.join('、')) : ok('沒有重複的中文意思');
  noBlank.length ? fail('例句缺少 ___ 空格：' + noBlank.join('、')) : ok('每個例句都含有 ___ 空格');
  checkOverlap(label, list);
}

// 額外例句（ALT_SENTENCES）的品質檢查
const ALT = grab('ALT_SENTENCES', '{', '}', true) || {};

function checkAltSentences() {
  const all = new Map();                       // en -> 第一句
  flatWords.forEach(w => all.set(w.en, w.sentence));
  REVIEW_WORDS.forEach(w => { if (!all.has(w.en)) all.set(w.en, w.sentence); });

  console.log('\n額外例句 ALT_SENTENCES');
  const totalAlt = Object.values(ALT).reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0);
  const covered = Object.keys(ALT).filter(en => Array.isArray(ALT[en]) && ALT[en].length).length;
  console.log(`  共 ${totalAlt} 句，涵蓋 ${covered} / ${all.size} 個單字`);

  const noBlank = [], giveaway = [], sameAsFirst = [], unknown = [], tooShort = [], dupWithin = [];
  for (const [en, arr] of Object.entries(ALT)) {
    if (!all.has(en)) { unknown.push(en); continue; }
    if (!Array.isArray(arr)) { unknown.push(en); continue; }
    const first = all.get(en);
    const seen = new Set([first]);
    arr.forEach(s => {
      if (!s.includes('___')) noBlank.push(`${en}: ${s}`);
      // 句子裡若已出現答案本身就是送分題
      const bare = s.replace('___', ' ');
      if (new RegExp('\\b' + en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(bare))
        giveaway.push(`${en}: ${s}`);
      if (s === first) sameAsFirst.push(en);
      if (seen.has(s)) dupWithin.push(`${en}: ${s}`);
      seen.add(s);
      if (s.split(/\s+/).length < 5) tooShort.push(`${en}: ${s}`);
    });
  }
  const show = (list, label) => list.length
    ? fail(`${label}（${list.length}）：` + list.slice(0, 8).join(' ｜ ') + (list.length > 8 ? ' …' : ''))
    : ok(label.replace(/^有/, '沒有'));

  show(unknown,     '有不存在於題庫的單字');
  show(noBlank,     '有例句缺少 ___ 空格');
  show(giveaway,    '有例句直接出現答案（送分題）');
  show(sameAsFirst, '有例句與第一句重複');
  show(dupWithin,   '有同一個字的例句互相重複');
  show(tooShort,    '有例句過短（少於 5 個字，線索不足）');

  const missing = [...all.keys()].filter(en => !ALT[en] || !ALT[en].length);
  if (missing.length) {
    console.log(`  ⏳ 還有 ${missing.length} 個字只有 1 句：` + missing.slice(0, 10).join('、')
      + (missing.length > 10 ? ' …' : ''));
  } else {
    ok('每個單字都至少有 2 句例句');
  }
}

checkSet('本次考試範圍 WORDS', flatWords);
console.log('  單元組成：' + Object.entries(WORDS).map(([c, a]) => c + ' ' + a.length).join('、'));
checkSet('總複習題庫 REVIEW_WORDS', REVIEW_WORDS);
checkAltSentences();

// 3. 本次範圍必須已併入總複習題庫
const reviewEn = new Set(REVIEW_WORDS.map(w => w.en.toLowerCase()));
const missing = flatWords.filter(w => !reviewEn.has(w.en.toLowerCase())).map(w => w.en);
console.log('');
missing.length
  ? fail('這些字還沒併入 REVIEW_WORDS：' + missing.join('、'))
  : ok('本次範圍已全部併入 REVIEW_WORDS');

console.log('');
if (problems) {
  console.error('驗證失敗：' + problems + ' 個問題');
  process.exit(1);
}
console.log('驗證通過 ✅');

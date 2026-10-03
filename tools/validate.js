#!/usr/bin/env node
// 驗證題庫：跑 `node tools/validate.js`（HANDOFF.md 第四節第 3 點要求每次更新都要跑）
// 檢查項目：JS 可 parse、英文單字不重複、中文意思不重複、每個例句都有 ___
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

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
if (!WORDS) process.exit(1);

// 題庫本體從 data/ 讀（v20 起不再寫在 index.html 裡）
const dataDir = path.join(path.dirname(file), 'data');
const readData = f => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
let REVIEW_WORDS, ALT_RAW, ARTICLES_RAW, GRAMMAR_RAW, POLICE_RAW;
try {
  REVIEW_WORDS = readData('review-words.json');
  ALT_RAW = readData('alt-sentences.json');
  ARTICLES_RAW = readData('articles.json');
  GRAMMAR_RAW = readData('grammar.json');
  POLICE_RAW = readData('police.json');
} catch (e) {
  fail('讀不到 data/ 裡的題庫：' + e.message);
  process.exit(1);
}

// 打包出去的那一份要跟 data/ 一致，否則學生拿到的是舊題庫
function checkBankFresh() {
  console.log('\n題庫打包 bank/');
  const m = html.match(/const BANK_FILE = '([^']+)';/);
  if (!m) { fail('index.html 找不到 BANK_FILE'); return; }
  const want = crypto.createHash('sha1').update(JSON.stringify({
    review: REVIEW_WORDS, alt: ALT_RAW, articles: ARTICLES_RAW, grammar: GRAMMAR_RAW,
    police: POLICE_RAW
  })).digest('hex').slice(0, 10);
  const expected = `bank/bank.${want}.json`;
  const onDisk = path.join(path.dirname(file), m[1]);
  console.log(`  index.html 指向 ${m[1]}`);
  if (m[1] !== expected) {
    fail(`打包檔跟 data/ 對不起來（應該是 ${expected}）—— 請跑 npm run build`);
  } else if (!fs.existsSync(onDisk)) {
    fail(`${m[1]} 不存在 —— 請跑 npm run build`);
  } else {
    ok('打包檔是最新的，跟 data/ 一致');
    const extra = fs.readdirSync(path.dirname(onDisk))
      .filter(f => /^bank\.[0-9a-f]+\.json$/.test(f) && f !== path.basename(onDisk));
    extra.length ? fail('bank/ 還留著舊檔：' + extra.join('、')) : ok('沒有留下舊的打包檔');
  }
}

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

// 與 index.html 的 SYNONYM_GROUPS 相同：字串不同但學生眼中同義的中文。
const SYNONYM_GROUPS = [
  ['也許', '或許', '大概'],
  ['總是', '一直'],
  ['常常', '時常', '經常'],
  ['幾乎', '差不多'],
  ['相當', '十分', '頗'],
  ['確實', '實際上'],
  ['無論何處', '任何地方', '到處'],
  ['極好', '非常好', '了不起', '很棒'],
  ['相似', '相像', '類似'],
  ['特殊', '特別', '獨特'],
  ['主要', '首要', '重大'],
  ['私人', '個人'],
  ['客人', '訪客', '來賓', '顧客'],
  ['通常', '平凡', '普通', '一般'],
  ['安靜', '沉默', '沈默'],
  ['一對', '一雙', '一副'],
  // ↓ 其他動詞單元加進來時補的。兩邊的字義太近，出題時不可以同時出現，
  //   否則同一題會有兩個都說得通的選項。
  ['完成', '使完整', '做完'],
  ['舉起', '抬起'],
  ['關閉', '關上'],
  ['使擔心', '掛念', '擔憂'],
  ['發現', '發掘'],
  ['拒絕', '駁回', '否決'],
  ['建議', '勸告', '忠告'],
  ['增加', '添加', '增添'],
  ['供應', '提供', '給予'],
  ['辯論', '爭論', '討論'],
  ['存活', '存在'],
  ['獲得', '收到', '得到'],
  ['讚美', '欽佩', '尊敬', '敬佩', '仰慕'],
  ['使害怕', '害怕', '使驚慌', '使恐懼'],
  // ↓ 新動詞與舊題庫裡單字詞的對撞（選 vs 選舉、放 vs 放置…）
  ['感覺', '感覺到', '察覺'],
  ['選', '選舉', '選出', '挑選', '選擇'],
  ['放', '放置', '擺'],
  ['敲', '敲擊'],
  ['比', '比較'],
  ['投', '投票'],
  ['信', '信任', '相信'],
  ['從', '服從', '遵從'],
  ['住', '困住'],
  ['像', '想像', '幻想']
];
function synonymKey(sense) {
  for (let i = 0; i < SYNONYM_GROUPS.length; i++) {
    if (SYNONYM_GROUPS[i].includes(sense)) return 'syn' + i;
  }
  return sense;
}

function checkOverlap(label, list) {
  const hits = [];
  const seen = new Set();
  for (const a of list) {
    for (const b of list) {
      if (a.en === b.en || a.zh === b.zh) continue;   // 完全相同的另外抓
      const sb = sensesOf(b.zh).map(synonymKey);
      if (!sensesOf(a.zh).map(synonymKey).some(s => sb.includes(s))) continue;
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

// 文章專區的檢查
  const ARTICLES = ARTICLES_RAW;

function checkArticles() {
  console.log('\n文章專區 ARTICLES');
  if (!ARTICLES.length) { console.log('  （沒有文章）'); return; }
  const bank = new Map();
  flatWords.forEach(w => bank.set(w.en.toLowerCase(), w));
  REVIEW_WORDS.forEach(w => { if (!bank.has(w.en.toLowerCase())) bank.set(w.en.toLowerCase(), w); });

  const notInBank = [], noBlanks = [], dupId = [], tooFew = [];
  const ids = new Set();
  ARTICLES.forEach(a => {
    if (ids.has(a.id)) dupId.push(a.id);
    ids.add(a.id);
    const blanks = [...a.text.matchAll(/\[\[(.+?)\]\]/g)].map(m => m[1]);
    const words = a.text.replace(/\[\[|\]\]/g, '').split(/\s+/).filter(Boolean).length;
    if (!blanks.length) noBlanks.push(a.id);
    if (blanks.length < 8) tooFew.push(`${a.id}(${blanks.length})`);
    blanks.forEach(b => { if (!bank.has(b.toLowerCase())) notInBank.push(`${a.id}: ${b}`); });
    console.log(`  ${a.title} — ${words} 字、${blanks.length} 個空格`);
  });

  // 挖空的字一定要在題庫裡，否則干擾選項生不出來，也失去複習意義。
  // 文章其他地方出現超綱字沒關係（老師指定可以）。
  notInBank.length
    ? fail('挖空的單字不在題庫裡：' + notInBank.join('、'))
    : ok('所有挖空的單字都在題庫裡');
  noBlanks.length ? fail('沒有任何空格的文章：' + noBlanks.join('、')) : ok('每篇都有空格');
  tooFew.length ? fail('空格太少（少於 8 個）：' + tooFew.join('、')) : ok('每篇空格數量足夠');
  dupId.length ? fail('文章 id 重複：' + dupId.join('、')) : ok('文章 id 不重複');
}

// 額外例句（ALT_SENTENCES）的品質檢查
  const ALT = ALT_RAW;

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

  // 「兩種句型」的實質檢查：只換幾個字不算另一種句型。
  // 用詞彙重疊率（Jaccard）當代理指標，重疊太高代表句子幾乎一樣。
  const tokens = s => s.toLowerCase().replace(/___/g, ' ').replace(/[^a-z ]/g, ' ')
    .split(/\s+/).filter(w => w.length > 2);
  const overlap = (a, b) => {
    const A = new Set(tokens(a)), B = new Set(tokens(b));
    if (!A.size || !B.size) return 0;
    const shared = [...A].filter(w => B.has(w)).length;
    return shared / new Set([...A, ...B]).size;
  };
  const tooSimilar = [];
  for (const [en, arr] of Object.entries(ALT)) {
    if (!all.has(en) || !Array.isArray(arr)) continue;
    const pool = [all.get(en), ...arr];
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const r = overlap(pool[i], pool[j]);
        if (r >= 0.35) tooSimilar.push(`${en}(${r.toFixed(2)})`);
      }
    }
  }
  tooSimilar.length
    ? fail(`有例句與同字的另一句太相似，算不上第二種句型（${tooSimilar.length}）：`
        + tooSimilar.slice(0, 10).join('、') + (tooSimilar.length > 10 ? ' …' : ''))
    : ok('每個字的兩句例句結構夠不同');

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
// 警專專區：獨立題庫，所以「英文不重複／中文不重複／沒有送分題」要在
// 這一包自己成立。跟課本題庫重疊的字不算錯 —— 兩邊是分開出題的。
function checkPolice() {
  console.log('\n警專單字專區 data/police.json');
  const units = (POLICE_RAW && Array.isArray(POLICE_RAW.units)) ? POLICE_RAW.units : null;
  if (!units) { fail('找不到 units 陣列'); return; }

  const ids = new Set(), dupId = [];
  const flat = [];
  units.forEach(u => {
    if (!u.id || !/^pol-/.test(u.id)) fail(`單元 id 要以 pol- 開頭：${u.id}`);
    if (ids.has(u.id)) dupId.push(u.id);
    ids.add(u.id);
    if (!u.label) fail(`單元 ${u.id} 沒有名稱`);
    (u.words || []).forEach(w => {
      if (!Array.isArray(w) || w.length !== 3) { fail(`${u.id} 有一筆格式不對：${JSON.stringify(w)}`); return; }
      flat.push({ en: w[0], zh: w[1], sentence: w[2], cat: u.id });
    });
  });
  console.log(`  ${units.length} 個主題、共 ${flat.length} 個字`
    + `（${units.map(u => u.label + ' ' + (u.words || []).length).join('、')}）`);
  dupId.length ? fail('單元 id 重複：' + dupId.join('、')) : ok('單元 id 不重複');

  // 每個主題至少要有四個字，否則同一題湊不出四個選項
  const tooSmall = units.filter(u => (u.words || []).length < 4).map(u => u.id);
  tooSmall.length ? fail('主題不足四個字（湊不出四個選項）：' + tooSmall.join('、'))
                  : ok('每個主題都至少四個字（出題湊得出四個選項）');

  // 送分題：答案出現在自己的例句裡
  const giveaway = flat.filter(w => {
    const bare = String(w.sentence).replace(/_{2,}/g, ' ');
    return new RegExp('\\b' + w.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(bare);
  }).map(w => `${w.en}: ${w.sentence}`);
  giveaway.length ? fail('例句直接出現答案（送分題）：' + giveaway.join(' ｜ '))
                  : ok('沒有例句洩漏答案');

  const tooShort = flat.filter(w => String(w.sentence).split(/\s+/).length < 6)
    .map(w => `${w.en}(${String(w.sentence).split(/\s+/).length} 字)`);
  tooShort.length ? fail('例句過短（線索不足）：' + tooShort.join('、'))
                  : ok('每個例句都夠長（至少 6 個字）');

  // 英文／中文不重複 ＋ 語意重疊檢查（checkSet 會一併跑 checkOverlap）
  checkSet('  └ 警專題庫整體', flat);

  // 真正會害人的是「同一個主題裡兩個選項都對」：en2zh / zh2en 的干擾選項
  // 優先取自同一個主題。
  units.forEach(u => {
    const list = (u.words || []).map(w => ({ en: w[0], zh: w[1], sentence: w[2], cat: u.id }));
    const zh = new Map();
    list.forEach(w => zh.set(w.zh, (zh.get(w.zh) || 0) + 1));
    const dup = [...zh].filter(([, n]) => n > 1).map(([k]) => k);
    if (dup.length) fail(`主題 ${u.label} 裡中文意思重複：${dup.join('、')}`);
  });
  ok('每個主題內部沒有重複的中文意思');
}
checkPolice();

checkArticles();

// 2.4 文法・片語：內容與題目要能真的出得出來
function checkGrammar() {
  console.log('\n文法・片語 GRAMMAR_DATA');
  const G = GRAMMAR_RAW;
  if (!G || !Array.isArray(G.grammar) || !Array.isArray(G.phrases)) {
    fail('找不到 GRAMMAR_DATA'); return;
  }
  const items = [...G.grammar, ...G.phrases];
  const qs = items.reduce((n, x) => n + (x.questions || []).length, 0);
  console.log(`  ${G.grammar.length} 個文法點、${G.phrases.length} 個片語，共 ${qs} 題`);

  const ids = items.map(x => x.id);
  const dupId = ids.filter((x, i) => ids.indexOf(x) !== i);
  dupId.length ? fail('id 重複：' + dupId.join('、')) : ok('id 不重複');

  const noField = [], badQ = [];
  items.forEach(it => {
    const isPhrase = !!it.en;
    if (!it.id) noField.push('(缺 id)');
    if (isPhrase ? !it.zh : !it.point) noField.push(it.id + ': 缺中文/說明');
    if (!Array.isArray(it.examples) || !it.examples.length) noField.push(it.id + ': 沒有例句');
    (it.examples || []).forEach(ex => {
      if (!Array.isArray(ex) || ex.length !== 2 || !ex[0] || !ex[1]) noField.push(it.id + ': 例句要有英文與中文');
    });
    if (!Array.isArray(it.questions) || it.questions.length < 2) noField.push(it.id + ': 題目少於 2 題');
    (it.questions || []).forEach((q, i) => {
      const where = `${it.id} 第 ${i + 1} 題`;
      if (!q.why) badQ.push(where + ': 沒有解說');
      if (q.type === 'mc' || q.type === 'phrase') {
        if (!Array.isArray(q.options) || q.options.length !== 4) badQ.push(where + ': 選項不是四個');
        else if (new Set(q.options).size !== 4) badQ.push(where + ': 選項有重複');
        else if (!q.options.includes(q.answer)) badQ.push(where + ': 選項裡沒有正解');
        if (!q.stem) badQ.push(where + ': 沒有題目');
        if (q.type === 'mc' && !/_{2,}/.test(q.stem || '')) badQ.push(where + ': 填空題沒有 ___ 空格');
        // 選擇題的題目裡不可以直接出現答案
        if (q.type === 'mc' && q.answer &&
            new RegExp('\\b' + String(q.answer).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i')
              .test(String(q.stem).replace(/_{2,}/g, ' '))) badQ.push(where + ': 題目裡就有答案');
      } else if (q.type === 'order') {
        if (!Array.isArray(q.tokens) || q.tokens.length < 3) badQ.push(where + ': 重組的字太少');
        if (!q.zh) badQ.push(where + ': 沒有中文提示');
        // 排出來一定要剛好等於答案，否則學生永遠拼不對
        const sorted = a => a.slice().sort().join('|');
        if (Array.isArray(q.tokens) && sorted(q.tokens) !== sorted(String(q.answer).split(' ')))
          badQ.push(where + ': 給的字拼不出答案');
      } else if (q.type === 'error') {
        if (!Array.isArray(q.parts) || q.parts.length < 3) badQ.push(where + ': 句子切得太少塊');
        if (!(q.answerIndex >= 0 && q.answerIndex < (q.parts || []).length))
          badQ.push(where + ': answerIndex 超出範圍');
        if (!q.fix) badQ.push(where + ': 沒有寫正確說法');
      } else {
        badQ.push(where + ': 不認得的題型 ' + q.type);
      }
    });
  });
  noField.length ? fail('內容不完整：' + noField.slice(0, 6).join(' ｜ ')) : ok('每一項都有說明與例句');
  badQ.length ? fail('題目有問題：' + badQ.slice(0, 6).join(' ｜ ')) : ok('每一題都出得出來，也都有解說');
}
checkGrammar();
checkBankFresh();

// 2.5 每日提醒：網頁上提供的每個時間，都要有對應的 .ics 檔而且內容正確
function checkReminders() {
  console.log('\n每日提醒 reminders/*.ics');
  const m = html.match(/const REMIND_TIMES = \[([\s\S]*?)\];/);
  if (!m) { fail('index.html 找不到 REMIND_TIMES'); return; }
  const times = [...m[1].matchAll(/'(\d{4})'/g)].map(x => x[1]);
  const def = (html.match(/const REMIND_DEFAULT = '(\d{4})'/) || [])[1];
  const dir = path.join(path.dirname(file), 'reminders');
  const missingFiles = [], broken = [];
  times.forEach(t => {
    const f = path.join(dir, t + '.ics');
    if (!fs.existsSync(f)) { missingFiles.push(t); return; }
    const raw = fs.readFileSync(f, 'utf8');
    const need = ['BEGIN:VCALENDAR', 'RRULE:FREQ=DAILY', 'BEGIN:VALARM', 'TRIGGER:PT0S',
                  `DTSTART:`, `T${t}00`, 'END:VCALENDAR'];
    const miss = need.filter(x => !raw.includes(x));
    // RFC 5545 要求 CRLF 換行，而且一行不超過 75 個 octet
    const lines = raw.split('\r\n');
    const longLine = lines.find(l => Buffer.from(l, 'utf8').length > 75);
    if (miss.length) broken.push(`${t}: 缺 ${miss.join('、')}`);
    else if (raw.includes('\n') && !raw.includes('\r\n')) broken.push(`${t}: 沒有用 CRLF 換行`);
    else if (longLine) broken.push(`${t}: 有一行超過 75 bytes`);
  });
  console.log(`  共 ${times.length} 個時間選項（預設 ${def || '?'}）`);
  missingFiles.length ? fail('這些時間沒有對應的 .ics 檔（按鈕會 404）：' + missingFiles.join('、'))
                      : ok('每個時間都有對應的 .ics 檔');
  broken.length ? fail('這些 .ics 內容不對：' + broken.join(' ｜ ')) : ok('.ics 內容格式正確');
  if (def && !times.includes(def)) fail(`預設時間 ${def} 不在清單裡`);
}
checkReminders();

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

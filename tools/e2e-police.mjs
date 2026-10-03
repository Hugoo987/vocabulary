// 端對端測試：警專單字專區
//
//   node tools/run-e2e.mjs        （或 npm test）
//
// 這一套盯三件事：
//   1. 警專是獨立題庫 —— 題目不會混到課本的字，課本的範圍也不會多出警專的字
//   2. 每一題都湊得出四個相異選項，而且只有一個對
//   3. 答錯的字照樣進錯題本、熱力圖、老師報告，而且模式記成 police（不是 practice）
import { chromium } from 'playwright';
const URL = process.env.QUIZ_URL || 'http://127.0.0.1:8099/index.html';
let fails=0; const ok=m=>console.log('  ✓ '+m); const bad=m=>{console.log('  ✗ '+m);fails++;};
const check=(c,m)=>c?ok(m):bad(m);
const br = await chromium.launch();
const ctx = await br.newContext({ viewport:{width:390,height:840}, isMobile:true, hasTouch:true });
const page = await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.goto(URL); await page.waitForTimeout(300);
await page.waitForFunction(()=>window.__bankReady===true, null, {timeout:15000}).catch(()=>{});
await page.click('#roleStudent'); await page.waitForTimeout(200);

console.log('\n【入口】');
const bank = await page.evaluate(()=>({
  units: POLICE_UNITS.map(u=>({ id:u.id, label:u.label, n:u.words.length })),
  total: policeAllPool().length
}));
check(bank.total > 0, `題庫載到 ${bank.total} 個警專單字、${bank.units.length} 個主題`);
check(await page.isVisible('#modePolice'), '主頁看得到「警專單字」入口');
check(await page.textContent('#policeWordCount') === String(bank.total), '入口寫出正確的字數');
check(await page.textContent('#policeUnitCount') === String(bank.units.length), '入口寫出正確的主題數');

console.log('\n【設定頁】');
await page.click('#modePolice'); await page.waitForTimeout(250);
check(await page.isVisible('#policeSetupScreen'), '進得去設定頁');
const tabs = await page.locator('#policeCatGrid .cat-tab').count();
check(tabs === bank.units.length, `列出 ${tabs} 個主題可勾選`);
check((await page.textContent('#policePoolHint')).includes(String(bank.total)),
  `預設全選，提示寫出 ${bank.total} 個字`);
// 只留一個主題
const firstId = bank.units[0].id;
for(const u of bank.units.slice(1)) await page.click(`#policeCatGrid .cat-tab[data-cat="${u.id}"]`);
await page.waitForTimeout(150);
check((await page.textContent('#policePoolHint')).includes(String(bank.units[0].n)),
  `只勾「${bank.units[0].label}」時提示跟著變成 ${bank.units[0].n} 個字`);
// 全部取消 → 不能開始
await page.click(`#policeCatGrid .cat-tab[data-cat="${firstId}"]`); await page.waitForTimeout(150);
check(await page.locator('#policeStartBtn').isDisabled(), '一個主題都沒勾時不能開始');
for(const u of bank.units) await page.click(`#policeCatGrid .cat-tab[data-cat="${u.id}"]`);
await page.waitForTimeout(150);
check(!(await page.locator('#policeStartBtn').isDisabled()), '勾回來就能開始');

console.log('\n【出題：不會混到課本的字】');
const mix = await page.evaluate(()=>{
  const polEn = new Set(policeAllPool().map(w=>w.en));
  const polZh = new Set(policeAllPool().map(w=>w.zh));
  const polCats = new Set(POLICE_UNITS.map(u=>u.id));
  let outsideCat = 0, outsideOpt = 0, n = 0;
  for(let r=0;r<40;r++){
    const q = attachQuestions(policeAllPool(), new Set(ALL_TYPES), policeAllPool());
    q.forEach(x=>{
      n++;
      if(!polCats.has(x.cat)) outsideCat++;
      const set = x.type==='en2zh' ? polZh : polEn;
      x.options.forEach(o=>{ if(!set.has(o)) outsideOpt++; });
    });
  }
  return { n, outsideCat, outsideOpt };
});
check(mix.outsideCat === 0, `${mix.n} 題的單元都屬於警專主題（外來：${mix.outsideCat}）`);
check(mix.outsideOpt === 0, `選項也全部來自警專題庫，沒有課本的字混進來（外來：${mix.outsideOpt}）`);

// 12 個字同時出現在課本題庫與警專題庫，而且中文不一樣（fine 課本是「好的」、
// 警專考「罰款」）。retrainPool 是單一個 en→字 的對照表，給錯題重練、錯題考卷
// 與老師匯入查中文用；這種撞名的字必須留課本那一份，那才是現在在教的解釋。
const dualGloss = await page.evaluate(()=>{
  const pol = new Map(policeAllPool().map(w=>[w.en, w]));
  const book = new Map();
  REVIEW_WORDS.forEach(w=>book.set(w.en, w));
  fullPool().forEach(w=>book.set(w.en, w));
  const lookup = new Map(retrainPool().map(w=>[w.en, w]));
  const shared = [...pol.keys()].filter(en=>book.has(en));
  const differentZh = shared.filter(en=>book.get(en).zh !== pol.get(en).zh);
  const wrongWinner = differentZh.filter(en=>lookup.get(en).zh !== book.get(en).zh);
  return { shared: shared.length, differentZh: differentZh.length,
    wrongWinner, sample: differentZh.slice(0,3)
      .map(en=>`${en}：課本「${book.get(en).zh}」/ 警專「${pol.get(en).zh}」`) };
});
check(dualGloss.shared > 0,
  `有 ${dualGloss.shared} 個字課本與警專都收，其中 ${dualGloss.differentZh} 個中文不同`
  + (dualGloss.sample.length ? `（例：${dualGloss.sample.join('、')}）` : ''));
check(dualGloss.wrongWinner.length === 0,
  dualGloss.wrongWinner.length
    ? `撞名的字查中文時被警專蓋掉了：${dualGloss.wrongWinner.join('、')}`
    : '撞名的字查中文時留的是課本的解釋（警專不覆蓋現在在教的字）');
// 但警專獨有的字一定要查得到，否則老師匯入報告會看到「已不在目前題庫」
const polOnly = await page.evaluate(()=>{
  const lookup = new Map(retrainPool().map(w=>[w.en, w]));
  const book = new Set([...REVIEW_WORDS.map(w=>w.en), ...fullPool().map(w=>w.en)]);
  const only = policeAllPool().filter(w=>!book.has(w.en));
  return { n: only.length, missing: only.filter(w=>!lookup.has(w.en)).map(w=>w.en) };
});
check(polOnly.missing.length === 0,
  polOnly.missing.length ? `警專獨有的字查不到：${polOnly.missing.join('、')}`
                         : `警專獨有的 ${polOnly.n} 個字都查得到（老師端不會顯示「已不在目前題庫」）`);

console.log('\n【每題都要四個相異選項，且只有一個對】');
const opts = await page.evaluate(()=>{
  let notFour = 0, noCorrect = 0, n = 0;
  // 逐一只勾一個主題，這是選項最難湊的情況
  POLICE_UNITS.forEach(u=>{
    const pool = policePool(new Set([u.id]));
    for(let r=0;r<30;r++){
      attachQuestions(pool, new Set(ALL_TYPES), pool).forEach(q=>{
        n++;
        if(new Set(q.options).size !== 4) notFour++;
        if(!q.options.includes(q.correctText)) noCorrect++;
      });
    }
  });
  return { n, notFour, noCorrect };
});
check(opts.notFour === 0, `只勾單一主題也都是四個相異選項（${opts.n} 題中不足四個：${opts.notFour}）`);
check(opts.noCorrect === 0, '每題都含正解');

console.log('\n【作答與紀錄】');
await page.click('#policeCountRow .pill[data-count="10"]'); await page.waitForTimeout(120);
await page.click('#policeStartBtn'); await page.waitForTimeout(350);
check(await page.isVisible('#quizScreen'), '開始後進入作答畫面');
const tag = await page.textContent('#topicTag');
check(tag.includes('警專'), `單元標籤寫出警專主題（${tag}）`);
check(!(await page.isVisible('#hangmanBox')), '警專不是吊人模式，不顯示吊人圖');

// 全部故意答錯：挑一個不是正解的選項
for(let i=0;i<10;i++){
  const picked = await page.evaluate(()=>{
    const btns=[...document.querySelectorAll('#mcBox .opt')];
    const q = quiz[qIndex];
    const wrong = btns.find(b=>b.textContent !== q.correctText);
    if(wrong){ wrong.click(); return true; }
    return false;
  });
  if(!picked){ bad('找不到可按的錯誤選項'); break; }
  await page.waitForTimeout(140);
  if(await page.isVisible('#resultScreen')) break;
  if(await page.isVisible('#nextBtn')) { await page.click('#nextBtn'); await page.waitForTimeout(140); }
}
await page.waitForTimeout(400);
check(await page.isVisible('#resultScreen'), '10 題做完出現成績單');
check((await page.textContent('#resultTitle')).includes('警專'), '成績單標題講的是警專');

const rec = await page.evaluate(()=>{
  const p = JSON.parse(localStorage.getItem('vocabQuiz:v2')).profiles.student;
  const last = p.sessions[p.sessions.length-1];
  const polCats = new Set(POLICE_UNITS.map(u=>u.id));
  const ws = Object.values(p.words);
  return {
    mode: last.mode, total: last.total,
    nWords: ws.length,
    allPoliceCat: ws.every(w=>polCats.has(w.cat)),
    days: Object.values(p.days).reduce((a,b)=>a+b,0)
  };
});
check(rec.mode === 'police', `這一輪記成 mode=police（實際 ${rec.mode}）`);
check(rec.total === 10, `記下 10 題（實際 ${rec.total}）`);
check(rec.nWords === 10, `10 個答錯的字都進了錯題本（實際 ${rec.nWords}）`);
check(rec.allPoliceCat, '錯題的單元記的是警專主題，不是課本單元');
check(rec.days >= 1, '熱力圖今天 +1');

console.log('\n【模式代號：同步與回報碼不能把警專記成平常練習】');
const round = await page.evaluate(()=>{
  const code = MODE_CODE['police'];
  return { code, back: CODE_MODE[code],
    label: MODE_LABEL['police'],
    roundTrip: Object.keys(MODE_CODE).every(m => CODE_MODE[MODE_CODE[m]] === m) };
});
check(round.code && round.back === 'police', `police ↔ '${round.code}' 轉得回來`);
check(round.roundTrip, '所有模式代號都能來回轉換，沒有互相撞號');
check(!!round.label, `報告上顯示「${round.label}」`);

const xfer = await page.evaluate(()=>{
  const code = buildTransferCode();
  const prof = payloadToProfile(JSON.parse(atob(code.slice(4).replace(/-/g,'+').replace(/_/g,'/'))));
  const ws = Object.values(prof.words);
  return { len: code.length,
    modes: prof.sessions.map(s=>s.mode),
    unknown: ws.filter(w=>String(w.zh).includes('已不在目前題庫')).map(w=>w.en) };
});
check(xfer.modes.includes('police'), '回報碼帶得過去，老師看到的是警專');
check(xfer.unknown.length === 0,
  xfer.unknown.length ? `警專的字在老師端查不到中文：${xfer.unknown.join('、')}`
                      : '警專的字在老師端也查得到中文（不會顯示「已不在目前題庫」）');

console.log('\n【錯題重練與錯題考卷吃得到警專的字】');
const retry = await page.evaluate(()=>{
  const list = retrainable();
  const polEn = new Set(policeAllPool().map(w=>w.en));
  return { n: list.length, police: list.filter(w=>polEn.has(w.en)).length };
});
check(retry.police > 0, `錯題重練找得到警專的字（${retry.police} / ${retry.n}）`);

console.log('\n【單字表】');
await page.click('#resultBackLink'); await page.waitForTimeout(250);
await page.click('#modeWordList'); await page.waitForTimeout(250);
await page.click('#wlTabRow .pill[data-wl="police"]'); await page.waitForTimeout(250);
const wlN = await page.locator('.wl-item').count();
check(wlN === bank.total, `單字表的「警專單字」分頁列出全部 ${bank.total} 個字（實際 ${wlN}）`);

console.log('\n【老師端】');
await page.click('#wlBackBtn').catch(()=>{});
await page.waitForTimeout(200);
const teacher = await page.evaluate(()=>{
  setRole('teacher');
  showScreen(reportScreen);
  renderReport();
  const txt = document.getElementById('reportScreen').innerText;
  return { hasPolice: txt.includes('警專'), noQuizEntry: !document.querySelector('#studentModes:not(.hidden)') };
});
check(teacher.hasPolice, '老師報告看得到警專的單元／模式');

check(errs.length===0, errs.length ? '有 JS 例外：'+errs[0] : '沒有 JS 執行期錯誤');
await br.close();
console.log(fails? `\n❌ ${fails} 項未通過` : '\n✅ 全部通過');
process.exit(fails?1:0);

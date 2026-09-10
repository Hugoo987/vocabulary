// 端對端測試：手機上的版面（375×667，iPhone SE／8 這種小螢幕）
//
//   npx http-server -p 8099 -s .
//   node tools/e2e-mobile.mjs
//
// 這幾項都是實際量到的問題，別讓它們再回來：
//   · 答完題後「下一題」按鈕跑到畫面外，每一題都要捲動
//   · 最長的克漏字例句把選項擠到摺線下
//   · 作答時還在顯示頁首橫幅，佔掉 110px
import { chromium } from 'playwright';
const URL = process.env.QUIZ_URL || 'http://127.0.0.1:8099/index.html';
let fails=0; const ok=m=>console.log('  ✓ '+m); const bad=m=>{console.log('  ✗ '+m);fails++;};
const check=(c,m)=>c?ok(m):bad(m);
const br = await chromium.launch();
const ctx = await br.newContext({ viewport:{width:375,height:667}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
const page = await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.goto(URL); await page.waitForTimeout(300);
await page.click('#roleStudent'); await page.waitForTimeout(250);

console.log('\n【主頁：不要一路捲到天邊】');
await page.evaluate(()=>{
  fullPool().slice(0,5).forEach((w,i)=> historyData[w.en]=
    {en:w.en, zh:w.zh, cat:w.cat, count:i+1, types:{en2zh:1}, lastWrong:Date.now()});
  saveHistory(); renderHistory();
});
await page.waitForTimeout(200);
const home = await page.evaluate(()=>({
  page: document.documentElement.scrollHeight,
  cardH: Math.round(document.querySelector('#modeScreen .mode-card').getBoundingClientRect().height),
  titleLines: Math.round(document.querySelector('#modeScreen .mode-card h3').getBoundingClientRect().height),
  panelTop: Math.round(document.getElementById('historyPanel').getBoundingClientRect().top),
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
}));
check(home.cardH > 0 && home.cardH <= 110, `模式卡不再是整頁大海報（每張 ${home.cardH}px，原本 ~180px）`);
check(home.titleLines > 0 && home.titleLines <= 30, `卡片標題排成一行，不會一個字一行（標題高 ${home.titleLines}px）`);
check(home.panelTop < 1000, `錯題面板不用捲太久就看得到（y=${home.panelTop}）`);
check(home.overflow <= 0, '沒有左右橫向捲動');
const btnH = await page.evaluate(()=>
  Math.min(...[...document.querySelectorAll('.mini-btn')].filter(b=>b.offsetParent)
    .map(b=>Math.round(b.getBoundingClientRect().height))));
check(btnH >= 36, `小按鈕在手機上夠大好按（最小 ${btnH}px，原本 29px）`);

console.log('\n【作答：一屏之內看完並按得到】');
await page.click('#modePractice'); await page.click('#startBtn'); await page.waitForTimeout(300);
const banner = await page.evaluate(()=>{
  const b = document.querySelector('.top-banner');
  return { hidden: getComputedStyle(b).display === 'none',
           firstOptTop: Math.round(document.querySelector('#mcBox .opt').getBoundingClientRect().top) };
});
check(banner.hidden, '作答時收起頁首橫幅（把空間讓給選項）');
check(banner.firstOptTop < 380, `第一個選項不會被頂到半屏以下（y=${banner.firstOptTop}，原本 427）`);
const opts = await page.evaluate(()=>{
  const o=[...document.querySelectorAll('#mcBox .opt')];
  return { last: Math.round(o[o.length-1].getBoundingClientRect().bottom), vh: window.innerHeight };
});
check(opts.last <= opts.vh, `四個選項都在畫面內（最後一個底 ${opts.last} / 畫面 ${opts.vh}）`);

// 用題庫裡最長的例句試最壞情況
const longest = await page.evaluate(()=>{
  let best='';
  REVIEW_WORDS.forEach(w=> sentencesFor(w).forEach(s=>{ if(s.length>best.length) best=s; }));
  const q=quiz[qIndex]; q.type='cloze'; q.sentence=best; q.correctText=q.en;
  renderQuestion();
  return best.length;
});
await page.waitForTimeout(200);
const worst = await page.evaluate(()=>{
  const o=[...document.querySelectorAll('#mcBox .opt')];
  return { last: Math.round(o[o.length-1].getBoundingClientRect().bottom), vh: window.innerHeight };
});
check(worst.last <= worst.vh, `題庫最長的克漏字（${longest} 字元）也放得下（底 ${worst.last} / ${worst.vh}）`);

await page.evaluate(()=>{ document.querySelector('#mcBox .opt').click(); });
await page.waitForTimeout(250);
const next = await page.evaluate(()=>{
  const r = document.getElementById('nextBtn').getBoundingClientRect();
  return { top:Math.round(r.top), bottom:Math.round(r.bottom), vh:window.innerHeight,
           scrolled: Math.round(window.scrollY) };
});
check(next.bottom <= next.vh && next.top >= 0,
  `答完後「下一題」就在畫面裡，不用捲動（y=${next.top}–${next.bottom} / 畫面 ${next.vh}）`);
check(next.scrolled === 0, '而且不需要頁面自己亂捲');

console.log('\n【成績單：答錯的字跟例句是同一塊】');
await page.evaluate(()=>{
  results = quiz.slice(0,4).map((q,i)=>({ type:q.type, en:q.en, zh:q.zh,
    correctText:q.correctText, isCorrect:i%2===0, sentence:q.sentence || pickSentence(q) }));
  score = 2; mode = 'exam'; showResult();
});
await page.waitForTimeout(300);
const grouped = await page.evaluate(()=>{
  const wraps=[...document.querySelectorAll('.review-wrong')];
  return { n: wraps.length,
           withSentence: wraps.filter(w=>w.querySelector('.wl-sent')).length,
           correctPlain: document.querySelectorAll('#reviewList > .review-item').length };
});
check(grouped.n === 2 && grouped.withSentence === 2, '答錯的字和它的例句包在同一張卡裡');
check(grouped.correctPlain === 2, '答對的字維持一行，不會把成績單拉長');
check(await page.evaluate(()=>getComputedStyle(document.querySelector('.top-banner')).display==='none'),
  '成績單也用精簡頁首');

console.log('\n【練習設定：只有一個單元時不要假裝可以選】');
await page.click('#restartBtn'); await page.waitForTimeout(200);
await page.click('#modePractice'); await page.waitForTimeout(250);
const scope = await page.evaluate(()=>({
  single: ALL_CATS.length === 1,
  gridHidden: document.getElementById('catGrid').classList.contains('hidden'),
  note: (document.getElementById('catSingleNote').textContent || '').trim()
}));
if(scope.single){
  check(scope.gridHidden && /共 \d+ 個單字/.test(scope.note),
    `改成一行說明：「${scope.note}」`);
} else {
  check(!scope.gridHidden, '多個單元時仍然可以複選');
}

console.log('\n【文章清單的字數說明要跟著文章走】');
await page.click('#backHint'); await page.waitForTimeout(200);
await page.click('#modeArticle'); await page.waitForTimeout(250);
const intro = await page.textContent('#artIntro');
const real = await page.evaluate(()=>{
  const c = ARTICLES.map(a=>parseArticle(a.text).blanks.length);
  return { lo: Math.min(...c), hi: Math.max(...c) };
});
check(intro.includes(String(real.lo)) && intro.includes(String(real.hi)),
  `空格數是算出來的，不是寫死的（「${intro.trim()}」）`);

check(errs.length===0, '沒有 JS 例外' + (errs.length? '：'+errs[0] : ''));
await br.close();
console.log(fails ? `\n❌ ${fails} 項未通過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);

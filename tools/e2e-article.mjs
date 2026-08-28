// 端對端測試：文章專區
//
//   npx http-server -p 8099 -s .      # 另開一個終端機
//   node tools/e2e-article.mjs        # 需要 playwright
//
// 走完學生會走的流程：進文章清單、讀文章、填空、看成績單，
// 並確認答錯有進錯題紀錄、老師報告看得到「文章填空」題型。
import { chromium } from 'playwright';
const URL = process.env.QUIZ_URL || 'http://127.0.0.1:8099/index.html';
let fails=0; const ok=m=>console.log('  ✓ '+m); const bad=m=>{console.log('  ✗ '+m);fails++;};
const check=(c,m)=>c?ok(m):bad(m);
const br=await chromium.launch();
const p=await (await br.newContext()).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto(URL); await p.waitForTimeout(400);
await p.evaluate(()=>{ SYNC_CONFIG.enabled=false; });
await p.click('#roleStudent'); await p.waitForTimeout(200);
await p.evaluate(()=>{ SYNC_CONFIG.enabled=false; });

console.log('\n【1. 進入文章專區】');
check(await p.locator('#modeArticle').isVisible(), '主頁看得到「文章閱讀」');
await p.click('#modeArticle'); await p.waitForTimeout(300);
check(await p.locator('#articleListScreen').isVisible(), '進入文章清單');
const cards=await p.locator('#articleList .art-card').count();
check(cards===3, `列出 3 篇文章（實際 ${cards}）`);
console.log('    ' + (await p.locator('#articleList').innerText()).split('\n').filter(Boolean).join(' | '));

console.log('\n【2. 開始讀第一篇】');
await p.locator('#articleList .art-card').first().click(); await p.waitForTimeout(300);
check(await p.locator('#articleScreen').isVisible(), '進入閱讀畫面');
const info=await p.evaluate(()=>({
  title:document.getElementById('artTitle').textContent,
  blanks:artBlanks.length,
  optCount:artBlanks.map(b=>b.options.length),
  hasAnswer:artBlanks.every(b=>b.options.includes(b.en)),
  uniq:artBlanks.every(b=>new Set(b.options).size===b.options.length),
  shownBlanks:document.querySelectorAll('#artText .art-blank').length,
  paras:document.querySelectorAll('#artText p').length
}));
console.log('    ' + info.title + '：' + info.blanks + ' 個空格，' + info.paras + ' 段');
check(info.shownBlanks===info.blanks, '文章裡的空格數與題目數一致');
check(info.optCount.every(n=>n===4), '每格都是 4 個選項');
check(info.hasAnswer, '正解都在選項裡');
check(info.uniq, '選項沒有重複');
check(await p.locator('#artText .art-blank.current').count()===1, '目前這一格有標示');

console.log('\n【3. 全部答對】');
for(let i=0;i<info.blanks;i++){
  const correct=await p.evaluate(()=>artBlanks[artIndex].en);
  const opts=p.locator('#artOptions .opt'); const n=await opts.count();
  for(let k=0;k<n;k++) if((await opts.nth(k).innerText()).trim()===correct){ await opts.nth(k).click(); break; }
  await p.waitForTimeout(70);
  if(await p.locator('#artNextBtn').isVisible()) await p.locator('#artNextBtn').click();
  await p.waitForTimeout(70);
}
check(await p.locator('#artFinishBtn').isVisible(), '填完後出現「看結果」');
const filled=await p.evaluate(()=>({
  ok:document.querySelectorAll('#artText .art-blank.ok').length,
  text:document.getElementById('artText').innerText.slice(0,90)
}));
check(filled.ok===info.blanks, `文章裡 ${filled.ok} 個空格都填上正確的字`);
console.log('    填好的開頭：' + filled.text.replace(/\n/g,' ') + '…');

await p.click('#artFinishBtn'); await p.waitForTimeout(400);
check(await p.locator('#resultScreen').isVisible(), '進入成績單');
const res=await p.locator('#resultScreen').innerText();
check(res.includes('100%'), '成績單顯示 100%');
check(res.includes('詳細檢討'), '成績單有詳細檢討');
const rec=await p.evaluate(()=>{
  const s=JSON.parse(localStorage.getItem('vocabQuiz:v2'));
  const last=s.profiles.student.sessions.slice(-1)[0];
  return {mode:last.mode,total:last.total,correct:last.correct,
          words:Object.keys(s.profiles.student.words).length,
          done:s.profiles.student.articles};
});
check(rec.mode==='article', `作答紀錄 mode=article（${rec.mode}）`);
check(rec.total===info.blanks && rec.correct===info.blanks, `紀錄 ${rec.correct}/${rec.total}`);
check(rec.words===0, '全對，錯題紀錄仍為 0');
check(Array.isArray(rec.done)&&rec.done.length===1, '文章標記為讀過');

console.log('\n【4. 答錯要進錯題紀錄】');
await p.click('#restartBtn'); await p.waitForTimeout(200);
await p.click('#modeArticle'); await p.waitForTimeout(250);
check((await p.locator('#articleList').innerText()).includes('讀過了'), '清單顯示「讀過了」標記');
await p.locator('#articleList .art-card').nth(1).click(); await p.waitForTimeout(300);
// 前 3 格故意答錯
for(let i=0;i<3;i++){
  const correct=await p.evaluate(()=>artBlanks[artIndex].en);
  const opts=p.locator('#artOptions .opt'); const n=await opts.count();
  for(let k=0;k<n;k++) if((await opts.nth(k).innerText()).trim()!==correct){ await opts.nth(k).click(); break; }
  await p.waitForTimeout(70);
  if(await p.locator('#artNextBtn').isVisible()) await p.locator('#artNextBtn').click();
  await p.waitForTimeout(70);
}
const wrong=await p.evaluate(()=>({
  words:Object.values(historyData).map(w=>w.en+':'+(w.types.article||0)),
  noMark:document.querySelectorAll('#artText .art-blank.no').length
}));
check(wrong.words.length===3, `3 個錯字進入紀錄：${wrong.words.join(', ')}`);
check(wrong.words.every(w=>w.endsWith(':1')), '題型記成 article（文章填空）');
check(wrong.noMark===3, '文章裡答錯的格子標紅');

console.log('\n【5. 中途離開要按兩次】');
await p.click('#artQuitHint'); await p.waitForTimeout(150);
check((await p.locator('#artQuitHint').innerText()).includes('再按一次'), '第一次按只進入確認');
check(await p.locator('#articleScreen').isVisible(), '還沒離開');
await p.click('#artQuitHint'); await p.waitForTimeout(250);
check(await p.locator('#modeScreen').isVisible(), '第二次按才回主頁');

console.log('\n【6. 老師報告看得到文章填空】');
await p.click('#switchRoleBtn'); await p.waitForTimeout(150);
await p.click('#roleTeacher'); await p.waitForTimeout(200);
await p.evaluate(()=>{ SYNC_CONFIG.enabled=false; });
await p.click('#openReportBtn'); await p.waitForTimeout(500);
const body=await p.locator('#reportBody').innerText();
check(body.includes('文章填空'), '報告的題型分析出現「文章填空」');
check(body.includes('文章閱讀'), '歷次紀錄出現「文章閱讀」');

check(errs.length===0, errs.length?'JS 例外：'+errs.join(' | '):'沒有 JS 例外');
await br.close();
console.log(fails?`\n❌ ${fails} 項未通過`:'\n✅ 全部通過');
process.exit(fails?1:0);

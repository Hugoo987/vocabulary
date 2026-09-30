// 端對端測試：文法・片語區塊（教學卡＋四種練習題）
//
//   npx http-server -p 8099 -s .
//   node tools/e2e-grammar.mjs
import { chromium } from 'playwright';
const URL = process.env.QUIZ_URL || 'http://127.0.0.1:8099/index.html';
let fails=0; const ok=m=>console.log('  ✓ '+m); const bad=m=>{console.log('  ✗ '+m);fails++;};
const check=(c,m)=>c?ok(m):bad(m);
const br = await chromium.launch();
const page = await (await br.newContext({ viewport:{width:390,height:840}, isMobile:true, hasTouch:true })).newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.goto(URL); await page.waitForTimeout(300);
await page.waitForFunction(()=>window.__bankReady===true, null, {timeout:15000}).catch(()=>{});
await page.click('#roleStudent'); await page.waitForTimeout(200);

console.log('\n【清單】');
await page.click('#modeGrammar'); await page.waitForTimeout(300);
check(await page.isVisible('#grammarListScreen'), '從主頁進得去');
const nG = await page.locator('.gm-card').count();
const dataN = await page.evaluate(()=>({g:GRAMMAR_DATA.grammar.length, p:GRAMMAR_DATA.phrases.length}));
check(nG === dataN.g, `文法分頁列出 ${nG} 個文法點`);
await page.click('#gmTabRow .pill[data-gm="phrases"]'); await page.waitForTimeout(200);
check(await page.locator('.gm-card').count() === dataN.p, `片語分頁列出 ${dataN.p} 個片語`);
await page.click('#gmTabRow .pill[data-gm="grammar"]'); await page.waitForTimeout(200);

console.log('\n【教學卡】');
await page.locator('.gm-card').first().click(); await page.waitForTimeout(250);
check(await page.isVisible('#grammarCardScreen'), '點進去看得到教學卡');
check((await page.textContent('#gmCardPoint')).length > 20, '有規則說明');
const exs = await page.locator('.gm-ex').count();
check(exs >= 2, `有 ${exs} 句例句`);
check(await page.locator('.gm-ex .say-btn').count() === exs, '每句例句都可以點發音');
check(/開始練習（\d+ 題）/.test(await page.textContent('#gmStartBtn')), '按鈕寫出題數');

console.log('\n【四種題型都答得了】');
// 把四種題型各跑一次：從所有項目裡挑出含該題型的題目
const types = ['mc','phrase','order','error'];
for(const want of types){
  const found = await page.evaluate((want)=>{
    const all=[...GRAMMAR_DATA.grammar, ...GRAMMAR_DATA.phrases];
    for(const it of all){
      const q = it.questions.find(q=>q.type===want);
      if(q){
        gmItem = it;
        gmQuiz = [q]; gmIndex = 0; gmScore = 0; gmResults = [];
        mode='grammar'; quizIsReview=false;
        showScreen(grammarQuizScreen); renderGmQuestion();
        return { id: it.id, type: want };
      }
    }
    return null;
  }, want);
  if(!found){ bad(`找不到 ${want} 題型的題目`); continue; }
  const label = await page.textContent('#gmTypeTag');
  // 先故意答錯（挑錯題與重組題用錯的順序）
  const wrongDone = await page.evaluate((want)=>{
    const q = gmQuiz[0];
    if(want==='mc' || want==='phrase'){
      const b=[...document.querySelectorAll('#gmBox .opt')].find(b=>b.textContent!==q.answer);
      b.click(); return true;
    }
    if(want==='error'){
      const idx = q.answerIndex === 0 ? 1 : 0;
      document.querySelectorAll('#gmBox .part')[idx].click(); return true;
    }
    if(want==='order'){
      const toks=[...document.querySelectorAll('#gmBox .tok')];
      const right=q.answer.split(' ');
      if(toks[0].textContent === right[0]){ toks.reverse(); }
      toks.forEach(t=>t.click());
      return true;
    }
  }, want);
  await page.waitForTimeout(200);
  const fb = await page.textContent('#gmFeedback');
  check(wrongDone && /答錯/.test(fb), `${label}：答錯會說出正確答案（${fb.trim().slice(0,32)}）`);
  check(await page.isVisible('#gmWhy'), `${label}：答錯後看得到解說`);
  const rec = await page.evaluate((id)=>{
    const it=[...GRAMMAR_DATA.grammar, ...GRAMMAR_DATA.phrases].find(x=>x.id===id);
    const key = it.en || it.title;
    return { key, entry: historyData[key] || null };
  }, found.id);
  check(rec.entry && rec.entry.count > 0,
    `${label}：答錯進了錯題紀錄（${rec.key}）`);
  check(rec.entry && (rec.entry.cat === 'grammar' || rec.entry.cat === 'phrase'),
    `${label}：分類記成 ${rec.entry && rec.entry.cat}`);
}

console.log('\n【整輪練習：計分、紀錄、進度】');
await page.evaluate(()=>{ historyData = {}; currentProfile().words = {}; currentProfile().gm = {}; saveHistory(); });
const before = await page.evaluate(()=>currentProfile().sessions.length);
await page.evaluate(()=>{ showScreen(grammarListScreen); renderGmList(); });
await page.locator('.gm-card').first().click(); await page.waitForTimeout(200);
await page.click('#gmStartBtn'); await page.waitForTimeout(250);
const total = await page.evaluate(()=>gmQuiz.length);
for(let i=0;i<total;i++){
  await page.evaluate(()=>{
    const q=gmQuiz[gmIndex];
    if(q.type==='mc'||q.type==='phrase'){
      [...document.querySelectorAll('#gmBox .opt')].find(b=>b.textContent===q.answer).click();
    } else if(q.type==='order'){
      q.answer.split(' ').forEach(tk=>{
        [...document.querySelectorAll('#gmBox .tok')].find(x=>x.textContent===tk && !x.classList.contains('used')).click();
      });
    } else {
      document.querySelectorAll('#gmBox .part')[q.answerIndex].click();
    }
  });
  await page.waitForTimeout(150);
  await page.click('#gmNextBtn'); await page.waitForTimeout(180);
}
await page.waitForSelector('#resultScreen:not(.hidden)', { timeout: 5000 }).catch(()=>{});
check(await page.isVisible('#resultScreen'), '做完出現成績單');
check((await page.textContent('#finalScore')).trim() === `${total}/${total}`, `全對記成 ${total}/${total}`);
const sess = await page.evaluate(()=>{ const s=currentProfile().sessions; return s[s.length-1]; });
check(sess && sess.mode === 'grammar' && sess.total === total, '作答紀錄記成「文法・片語練習」');
check(await page.evaluate(()=>Object.keys(historyData).length) === 0, '全對就不會留下錯題');
const gm = await page.evaluate(()=>currentProfile().gm);
const first = Object.values(gm)[0];
check(first && first.best === total, `教學卡記下最佳成績 ${first && first.best}/${first && first.total}`);
const heat = await page.evaluate(()=>currentProfile().days[dayNum(new Date())]);
check(heat > 0, `熱力圖今天 +1（${heat} 次）`);
const modeBack = await page.evaluate(()=>{
  const p = currentProfile();
  p.sessions = [{date:Date.now(), mode:'grammar', total:3, correct:3, wrong:[]}];
  return payloadToProfile(buildPayload()).sessions[0].mode;
});
check(modeBack === 'grammar', '同步到老師端不會被認成別的模式');

console.log('\n【離開要按兩次】');
await page.evaluate(()=>{ showScreen(grammarListScreen); renderGmList(); });
await page.locator('.gm-card').first().click(); await page.waitForTimeout(150);
await page.click('#gmStartBtn'); await page.waitForTimeout(200);
await page.click('#gmQuitHint'); await page.waitForTimeout(150);
check(/確定離開/.test(await page.textContent('#gmQuitHint')), '第一次按只進入確認');
check(await page.isVisible('#grammarQuizScreen'), '還沒離開');
await page.click('#gmQuitHint'); await page.waitForTimeout(200);
check(await page.isVisible('#grammarListScreen'), '第二次按才回清單');

console.log('\n【老師端】');
await page.evaluate(()=>showScreen(roleScreen));
await page.click('#roleTeacher'); await page.waitForTimeout(200);
check(!(await page.evaluate(()=> !!document.getElementById('modeGrammar').offsetParent)),
  '老師看不到文法練習入口（跟其他測驗一樣收起來）');

check(errs.length===0, '沒有 JS 例外' + (errs.length? '：'+errs[0] : ''));
await br.close();
console.log(fails ? `\n❌ ${fails} 項未通過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);

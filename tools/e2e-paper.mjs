// 端對端測試：老師「產生錯題考卷」→ 列印／指派給學生 → 學生作答
//
//   node tools/mock-firebase.mjs      # 另開終端機
//   npx http-server -p 8099 -s .      # 再開一個
//   node tools/e2e-paper.mjs
import { chromium } from 'playwright';
const URL = process.env.QUIZ_URL || 'http://127.0.0.1:8099/index.html';
const DB  = process.env.MOCK_DB || 'http://127.0.0.1:8100';
const KEY = 'papertest' + Date.now();
const cfg = `(()=>{SYNC_CONFIG.enabled=true;SYNC_CONFIG.dbUrl=${JSON.stringify(DB)};SYNC_CONFIG.classKey=${JSON.stringify(KEY)};})()`;
let fails=0; const ok=m=>console.log('  ✓ '+m); const bad=m=>{console.log('  ✗ '+m);fails++;};
const check=(c,m)=>c?ok(m):bad(m);
const br = await chromium.launch();

console.log('\n【學生：先累積一些錯題並上傳】');
const stu = await (await br.newContext()).newPage();
const e1=[]; stu.on('pageerror',e=>e1.push(String(e)));
await stu.goto(URL); await stu.waitForTimeout(300); await stu.evaluate(cfg);
await stu.click('#roleStudent'); await stu.waitForTimeout(200); await stu.evaluate(cfg);
await stu.evaluate(()=>{
  const inScope = new Set(fullPool().map(w=>w.en));
  const rev = REVIEW_WORDS.filter(w=>!inScope.has(w.en)).slice(0,9);
  [...fullPool().slice(0,6), ...rev].forEach((w,i)=> historyData[w.en]=
    {en:w.en, zh:w.zh, cat:w.cat, count:(i%4)+1, types:{en2zh:1}, lastWrong:Date.now()-i*3600000});
  saveHistory();
});
const push = await stu.evaluate(()=>syncPush());
check(push.ok, '錯題已上傳（15 個字）');
check(await stu.isHidden('#assignCard'), '還沒指派時，學生看不到考卷卡片');

console.log('\n【老師：產生錯題考卷】');
const tea = await (await br.newContext()).newPage();
const e2=[]; tea.on('pageerror',e=>e2.push(String(e)));
await tea.goto(URL); await tea.waitForTimeout(300); await tea.evaluate(cfg);
await tea.click('#roleTeacher'); await tea.waitForTimeout(200); await tea.evaluate(cfg);
await tea.click('#openReportBtn'); await tea.waitForTimeout(700);
await tea.click('#paperCountRow .pill[data-count="10"]'); await tea.waitForTimeout(150);
await tea.click('#makePaperBtn'); await tea.waitForTimeout(300);
check(await tea.isVisible('#examPaper'), '考卷產生出來了');
check(await tea.locator('.paper-q').count() === 10, '題數照選的來（10 題）');
check(await tea.evaluate(()=>{
  const wrong = new Set(Object.keys(store.profiles.student.words));
  return paperQuestions.every(q=>wrong.has(q.en));
}), '每一題都是學生答錯過的字');
check(await tea.evaluate(()=>paperQuestions.every(q=>
  new Set(q.options).size===4 && q.options.includes(q.correctText))),
  '每題四個相異選項且含正解（不會兩個都對）');
check(await tea.evaluate(()=>new Set(paperQuestions.map(q=>q.type)).size===3),
  '三種題型輪流出現，不會整份都同一種');
const order = await tea.evaluate(()=>{
  // 同樣的排序規則：錯最多次的優先，同分再照字母
  const c = Object.values(store.profiles.student.words)
    .sort((a,b)=> b.count - a.count || a.en.localeCompare(b.en))[0];
  return { top:c.en, first:paperQuestions[0].en };
});
check(order.top === order.first, `錯最多次的排第一題（${order.top}）`);
const key = (await tea.textContent('.paper-key')).trim();
check(/^解答/.test(key) && key.split('　').length >= 10, `附解答（${key.slice(0,28)}…）`);
check(await tea.evaluate(()=>{
  const L=['A','B','C','D'];
  return paperQuestions.every((q,i)=>
    document.querySelector('.paper-key').textContent.includes((i+1)+'.'+L[q.options.indexOf(q.correctText)]));
}), '解答的字母和選項排列一致');

console.log('\n【列印】');
await tea.emulateMedia({ media:'print' });
await tea.waitForTimeout(200);
const vis = await tea.evaluate(()=>{
  const v = el => el ? getComputedStyle(el).visibility : 'none';
  return { paper:v(document.getElementById('examPaper')),
           masthead:v(document.querySelector('.masthead')),
           actions:v(document.querySelector('.paper-actions')) };
});
check(vis.paper === 'visible', '列印時看得到考卷');
check(vis.masthead === 'hidden' && vis.actions === 'hidden', '列印時不會印出網頁其他部分與按鈕');
await tea.emulateMedia({ media:'screen' });

console.log('\n【指派給學生】');
await tea.click('#assignPaperBtn'); await tea.waitForTimeout(700);
check(/已指派 10 題/.test(await tea.textContent('#assignNote')), '指派成功並回報');

await stu.reload(); await stu.waitForTimeout(300); await stu.evaluate(cfg);
await stu.evaluate(()=>checkAssignment()); await stu.waitForTimeout(600);
check(await stu.isVisible('#assignCard'), '學生打開網頁就看到「老師指派的考卷」');
check(/共 10 題/.test(await stu.textContent('#assignCard')), '卡片寫出題數');
const sameQs = await stu.evaluate(()=>({
  n: assignment.questions.length,
  ok: assignment.questions.every(q=>q.options.length===4 && q.options.includes(q.correctText))
}));
check(sameQs.n===10 && sameQs.ok, '學生收到的題目跟老師那份一樣完整');

console.log('\n【學生作答】');
await stu.click('#startAssignBtn'); await stu.waitForTimeout(300);
check(await stu.evaluate(()=>mode)==='assigned', '記為老師指派考卷');
check(await stu.isHidden('#hangmanBox'), '考卷模式不出現吊人遊戲（不是練習）');
const n = await stu.evaluate(()=>quiz.length);
for(let i=0;i<n;i++){
  await stu.evaluate(()=>{
    const btns=[...document.querySelectorAll('#mcBox .opt')];
    const q=quiz[qIndex];
    (btns.find(b=>b.textContent===q.correctText)||btns[0]).click();
  });
  await stu.waitForTimeout(110);
  if(await stu.isVisible('#nextBtn')){ await stu.click('#nextBtn'); await stu.waitForTimeout(110); }
}
await stu.waitForSelector('#resultScreen:not(.hidden)', { timeout: 5000 }).catch(()=>{});
check(await stu.isVisible('#resultScreen'), '作答完出現成績單');
check((await stu.textContent('#gradeRow')).includes('%'), '成績單有正確率與等第（跟正式考試一樣）');
const sess = await stu.evaluate(()=>{ const s=currentProfile().sessions; return s[s.length-1]; });
check(sess && sess.mode==='assigned' && sess.total===10 && sess.correct===10,
  `紀錄成 老師指派考卷 ${sess && sess.correct}/${sess && sess.total}`);
await stu.click('#restartBtn'); await stu.waitForTimeout(300);
check(/已完成/.test(await stu.textContent('#assignCard')), '做完後卡片標記為已完成');
check(/再考一次/.test(await stu.textContent('#startAssignBtn')), '仍然可以再考一次');
await stu.reload(); await stu.waitForTimeout(300); await stu.evaluate(cfg);
await stu.evaluate(()=>checkAssignment()); await stu.waitForTimeout(600);
check(/已完成/.test(await stu.textContent('#assignCard')), '重開網頁後仍記得已完成');

console.log('\n【老師端看得到結果】');
await tea.click('#syncRefreshBtn'); await tea.waitForTimeout(800);
check((await tea.textContent('#reportBody')).includes('老師指派考卷'), '報告的歷次紀錄出現「老師指派考卷」');

console.log('\n【沒有錯題 / 沒有同步時】');
const t2 = await (await br.newContext()).newPage();
const e3=[]; t2.on('pageerror',e=>e3.push(String(e)));
await t2.goto(URL); await t2.waitForTimeout(300);
await t2.evaluate(()=>{ SYNC_CONFIG.enabled=false; });
await t2.click('#roleTeacher'); await t2.waitForTimeout(200);
await t2.evaluate(()=>{ SYNC_CONFIG.enabled=false; });
await t2.click('#openReportBtn'); await t2.waitForTimeout(400);
await t2.click('#makePaperBtn'); await t2.waitForTimeout(300);
check(await t2.isHidden('#examPaper'), '學生沒有錯題時不會產生空考卷');
check(/沒有錯題/.test(await t2.textContent('#paperHint')), '並且說明原因');
await t2.evaluate(()=>{
  const w = REVIEW_WORDS.slice(0,4);
  w.forEach((x,i)=> store.profiles.student.words[x.en]={en:x.en,zh:x.zh,cat:x.cat,count:1,types:{},lastWrong:Date.now()});
  saveHistory();
});
await t2.click('#makePaperBtn'); await t2.waitForTimeout(300);
check(await t2.isVisible('#examPaper'), '沒開同步也能產生考卷（可以用印的）');
await t2.click('#assignPaperBtn'); await t2.waitForTimeout(300);
check(/沒有開啟自動同步/.test(await t2.textContent('#assignNote')), '沒開同步時按指派會說明只能列印');
check(e3.length===0, '沒有 JS 例外');

console.log('\n【每一種模式都要能傳到老師那邊】');
const modes = await tea.evaluate(()=>{
  const all = ['practice','exam','review','retry','article','assigned'];
  store.profiles.student.sessions = all.map((m,i)=>
    ({ date: Date.now()-i*60000, mode:m, total:10, correct:9, wrong:[] }));
  const back = payloadToProfile(buildPayload());
  return { sent: all, got: back.sessions.map(s=>s.mode) };
});
check(JSON.stringify(modes.sent) === JSON.stringify(modes.got),
  '六種模式同步後都不會被認錯（' + modes.got.join('/') + '）');

check(e1.length===0, '學生端沒有 JS 例外' + (e1.length? '：'+e1[0]:''));
check(e2.length===0, '老師端沒有 JS 例外' + (e2.length? '：'+e2[0]:''));
await br.close();
console.log(fails ? `\n❌ ${fails} 項未通過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);

// 端對端測試：回報碼跨裝置傳遞
//
//   npx http-server -p 8099 -s .      # 另開一個終端機
//   node tools/e2e-transfer.mjs       # 需要 playwright
//
// 用兩個完全獨立的瀏覽器 profile 模擬「學生的手機」與「老師的手機」，
// 驗證回報碼能把紀錄無損搬過去，且壞掉的代碼會給出可理解的錯誤。
import { chromium } from 'playwright';
const URL = process.env.QUIZ_URL || 'http://127.0.0.1:8099/index.html';
let fails=0; const ok=m=>console.log('  ✓ '+m); const bad=m=>{console.log('  ✗ '+m);fails++;};
const check=(c,m)=>c?ok(m):bad(m);
const br = await chromium.launch();

console.log('\n【學生的手機】');
const stu = await (await br.newContext()).newPage();
const e1=[]; stu.on('pageerror',e=>e1.push(String(e)));
await stu.goto(URL); await stu.waitForTimeout(300);
await stu.click('#roleStudent'); await stu.waitForTimeout(200);
await stu.evaluate(() => {
  const inScope=new Set(fullPool().map(w=>w.en));
  const rev=REVIEW_WORDS.filter(w=>!inScope.has(w.en)).slice(0,14);
  const sc=fullPool().slice(0,16);
  [...sc,...rev].forEach((w,i)=> historyData[w.en]={en:w.en,zh:w.zh,cat:w.cat,count:(i%4)+1,
    types:{en2zh:1,zh2en:i%2,cloze:i%3}, lastWrong:Date.now()-i*86400000});
  const p=currentProfile();
  p.sessions=[{date:Date.now()-4*86400000,mode:'exam',total:40,correct:26,wrong:[]},
              {date:Date.now()-86400000,mode:'review',total:20,correct:15,wrong:[]},
              {date:Date.now(),mode:'retry',total:10,correct:8,wrong:[]}];
  saveHistory(); renderHistory();
});
await stu.waitForTimeout(200);
await stu.click('#makeCodeBtn'); await stu.waitForTimeout(300);
const code = await stu.inputValue('#codeOut');
const expect = await stu.evaluate(()=>({
  words:Object.keys(store.profiles.student.words).length,
  sessions:store.profiles.student.sessions.length,
  sample:Object.values(store.profiles.student.words).slice(0,3).map(w=>`${w.en}:${w.count}:${w.zh}`)
}));
check(code.startsWith('VQ1.'), '產生回報碼，開頭為 VQ1.');
console.log(`    紀錄 ${expect.words} 個錯字 / ${expect.sessions} 筆成績 → 回報碼長度 ${code.length} 字元`);
await stu.click('#copyCodeBtn'); await stu.waitForTimeout(200);
console.log('    複製提示：' + await stu.locator('#copyNote').innerText());
check(e1.length===0, e1.length?'JS 例外：'+e1.join('|'):'學生端沒有 JS 例外');

console.log('\n【老師的手機 — 另一台裝置】');
const tea = await (await br.newContext()).newPage();
const e2=[]; tea.on('pageerror',e=>e2.push(String(e)));
await tea.goto(URL); await tea.waitForTimeout(300);
check(await tea.locator('#roleScreen').isVisible(), '全新裝置，重新詢問身分');
await tea.click('#roleTeacher'); await tea.waitForTimeout(200);
await tea.click('#openReportBtn'); await tea.waitForTimeout(250);
check((await tea.locator('#reportBody').innerText()).includes('還沒有留下任何紀錄'), '匯入前：老師看到空報告');

await tea.click('#importToggleBtn'); await tea.waitForTimeout(150);
await tea.fill('#codeIn','這不是回報碼'); await tea.click('#doImportBtn'); await tea.waitForTimeout(200);
let note = await tea.locator('#importNote').innerText();
check(note.includes('不像是回報碼'), '亂貼文字 → ' + note.replace('✕ ',''));
await tea.fill('#codeIn', code.slice(0, code.length-40)); await tea.click('#doImportBtn'); await tea.waitForTimeout(200);
note = await tea.locator('#importNote').innerText();
check(note.includes('不完整') || note.includes('格式'), '貼一半 → ' + note.replace('✕ ',''));

await tea.fill('#codeIn', code); await tea.click('#doImportBtn'); await tea.waitForTimeout(400);
console.log('    匯入結果：' + await tea.locator('#importNote').innerText());
const got = await tea.evaluate(()=>({
  words:Object.keys(store.profiles.student.words).length,
  sessions:store.profiles.student.sessions.length,
  sample:Object.values(store.profiles.student.words).slice(0,3).map(w=>`${w.en}:${w.count}:${w.zh}`),
  unknown:Object.values(store.profiles.student.words).filter(w=>w.zh.includes('已不在')).length
}));
check(got.words===expect.words, `錯字數一致（${got.words} / ${expect.words}）`);
check(got.sessions===expect.sessions, `成績筆數一致（${got.sessions} / ${expect.sessions}）`);
check(JSON.stringify(got.sample)===JSON.stringify(expect.sample), '單字、次數、中文完全一致：'+got.sample.join(' '));
check(got.unknown===0, '所有單字都查得到中文（含只在總複習的字）');
const body = await tea.locator('#reportBody').innerText();
check(body.includes('各單元弱點') && body.includes('哪種題型') && body.includes('歷次作答紀錄'), '報告完整呈現');
check(body.includes('正式考試'), '成績含正式考試');
check((await tea.evaluate(()=>Object.keys(store.profiles.teacher.words).length))===0, '匯入不影響老師自己的紀錄');
check(e2.length===0, e2.length?'JS 例外：'+e2.join('|'):'老師端沒有 JS 例外');

await tea.reload(); await tea.waitForTimeout(400);
check((await tea.evaluate(()=>Object.keys(store.profiles.student.words).length))===expect.words, '重新整理後匯入的紀錄仍在');

await br.close();
console.log(fails?`\n❌ ${fails} 項未通過`:'\n✅ 全部通過');
process.exit(fails?1:0);

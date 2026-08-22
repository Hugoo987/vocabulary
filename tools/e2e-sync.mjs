// 端對端測試：自動同步（Firebase Realtime Database）
//
//   node tools/mock-firebase.mjs      # 另開終端機，模擬 Firebase REST
//   npx http-server -p 8099 -s .      # 再開一個
//   node tools/e2e-sync.mjs           # 需要 playwright
//
// 用模擬伺服器測，因為真的 Firebase 需要帳號。Firebase 的 REST 介面就是
// 對一個 .json 網址做 GET / PUT，模擬伺服器實作的就是這個行為。
import { chromium } from 'playwright';
const URL = process.env.QUIZ_URL || 'http://127.0.0.1:8099/index.html';
const DB  = process.env.MOCK_DB || 'http://127.0.0.1:8100';
const KEY='testkey123';
let fails=0; const ok=m=>console.log('  ✓ '+m); const bad=m=>{console.log('  ✗ '+m);fails++;};
const check=(c,m)=>c?ok(m):bad(m);
const cfg = `(()=>{SYNC_CONFIG.enabled=true;SYNC_CONFIG.dbUrl=${JSON.stringify(DB)};SYNC_CONFIG.classKey=${JSON.stringify(KEY)};})()`;
const br = await chromium.launch();

// ============ 學生的裝置 ============
console.log('\n【學生的手機】做完一輪測驗，應自動上傳');
const stu = await (await br.newContext()).newPage();
const e1=[]; stu.on('pageerror',e=>e1.push(String(e)));
await stu.addInitScript(()=>{ window.__cfg = true; });
await stu.goto(URL); await stu.waitForTimeout(300);
await stu.evaluate(cfg);
await stu.click('#roleStudent'); await stu.waitForTimeout(200);
await stu.evaluate(cfg);   // 身分切換後再設一次，確保生效

// 種資料並跑完一輪（直接呼叫 showResult 的路徑太繞，改用真的作答）
await stu.evaluate(() => {
  const inScope=new Set(fullPool().map(w=>w.en));
  const rev=REVIEW_WORDS.filter(w=>!inScope.has(w.en)).slice(0,8);
  [...fullPool().slice(0,10), ...rev].forEach((w,i)=> historyData[w.en]=
    {en:w.en,zh:w.zh,cat:w.cat,count:(i%3)+1,types:{en2zh:1,cloze:i%2},lastWrong:Date.now()-i*86400000});
  currentProfile().sessions=[{date:Date.now(),mode:'exam',total:40,correct:31,wrong:[]}];
  saveHistory();
});
const push = await stu.evaluate(()=>syncPush());
check(push.ok, '上傳成功：' + JSON.stringify(push));
const expect = await stu.evaluate(()=>({
  words:Object.keys(store.profiles.student.words).length,
  sessions:store.profiles.student.sessions.length,
  sample:Object.values(store.profiles.student.words).slice(0,3).map(w=>`${w.en}=${w.zh}×${w.count}`)
}));
console.log('    學生端：' + expect.words + ' 錯字 / ' + expect.sessions + ' 成績');

// ============ 老師的裝置（另一個 profile，完全乾淨）============
console.log('\n【老師的手機】打開報告，應自動抓到最新');
const tea = await (await br.newContext()).newPage();
const e2=[]; tea.on('pageerror',e=>e2.push(String(e)));
await tea.goto(URL); await tea.waitForTimeout(300);
await tea.evaluate(cfg);
await tea.click('#roleTeacher'); await tea.waitForTimeout(200);
await tea.evaluate(cfg);
await tea.click('#openReportBtn'); await tea.waitForTimeout(900);
const status = await tea.locator('#syncStatus').innerText();
console.log('    同步狀態：' + status);
check(status.includes('已更新'), '報告頁自動抓取雲端紀錄');
const got = await tea.evaluate(()=>({
  words:Object.keys(store.profiles.student.words).length,
  sessions:store.profiles.student.sessions.length,
  sample:Object.values(store.profiles.student.words).slice(0,3).map(w=>`${w.en}=${w.zh}×${w.count}`)
}));
check(got.words===expect.words && got.sessions===expect.sessions,
      `資料一致（${got.words} 錯字 / ${got.sessions} 成績）`);
check(JSON.stringify(got.sample)===JSON.stringify(expect.sample), '單字/中文/次數一致：'+got.sample.join(' '));
check((await tea.locator('#reportBody').innerText()).includes('各單元弱點'), '報告正常呈現');

// ============ 學生再練一次，老師按重新整理 ============
console.log('\n【學生再答錯 3 個字，老師按「重新整理」】');
await stu.evaluate(() => {
  const w = REVIEW_WORDS.slice(200,203);
  w.forEach(x=> historyData[x.en]={en:x.en,zh:x.zh,cat:x.cat,count:5,types:{zh2en:5},lastWrong:Date.now()});
  saveHistory();
});
await stu.evaluate(()=>syncPush());
await tea.click('#syncRefreshBtn'); await tea.waitForTimeout(800);
const got2 = await tea.evaluate(()=>Object.keys(store.profiles.student.words).length);
check(got2===expect.words+3, `老師端更新為 ${got2} 個錯字（原 ${expect.words} + 3）`);

// ============ 例外情況 ============
console.log('\n【例外處理】');
await tea.evaluate(()=>{ SYNC_CONFIG.dbUrl='http://127.0.0.1:9999'; });
await tea.click('#syncRefreshBtn'); await tea.waitForTimeout(1200);
const errStatus = await tea.locator('#syncStatus').innerText();
check(errStatus.includes('取不到雲端紀錄'), '連不上時給出可理解的訊息：' + errStatus.slice(0,40)+'…');
check((await tea.locator('#reportBody').innerText()).includes('各單元弱點'), '連不上時仍顯示本機既有報告（不會變空白）');

await tea.evaluate(cfg);
await tea.evaluate(()=>{ SYNC_CONFIG.classKey='nonexistent-key'; });
await tea.click('#syncRefreshBtn'); await tea.waitForTimeout(800);
check((await tea.locator('#syncStatus').innerText()).includes('雲端目前沒有紀錄'), '雲端無資料時給出正確訊息');

// 未設定時應完全不影響
console.log('\n【未設定同步時（預設狀態）】');
const off = await (await br.newContext()).newPage();
const e3=[]; off.on('pageerror',e=>e3.push(String(e)));
await off.goto(URL); await off.waitForTimeout(300);
// 明確關閉，不依賴預設值（正式環境的預設值已經是開啟）
await off.evaluate(()=>{ SYNC_CONFIG.enabled=false; });
await off.click('#roleTeacher'); await off.waitForTimeout(200);
await off.evaluate(()=>{ SYNC_CONFIG.enabled=false; });
await off.click('#openReportBtn'); await off.waitForTimeout(500);
check(await off.locator('#syncStatus').isHidden(), '未設定時不顯示同步狀態列');
check(await off.locator('#importBody').count()===1, '回報碼匯入功能仍在（備援路徑）');
check(e3.length===0, e3.length?'JS 例外：'+e3.join('|'):'未設定時沒有 JS 例外');

check(e1.length===0, e1.length?'學生端 JS 例外：'+e1.join('|'):'學生端沒有 JS 例外');
check(e2.length===0, e2.length?'老師端 JS 例外：'+e2.join('|'):'老師端沒有 JS 例外');
await br.close();
console.log(fails?`\n❌ ${fails} 項未通過`:'\n✅ 全部通過');
process.exit(fails?1:0);

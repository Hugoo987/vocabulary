// 端對端測試：單字表（含發音按鈕）與成績單的例句
//
//   npx http-server -p 8099 -s .
//   node tools/e2e-study.mjs
import { chromium } from 'playwright';
const URL = process.env.QUIZ_URL || 'http://127.0.0.1:8099/index.html';
let fails=0; const ok=m=>console.log('  ✓ '+m); const bad=m=>{console.log('  ✗ '+m);fails++;};
const check=(c,m)=>c?ok(m):bad(m);
const br = await chromium.launch();
const page = await (await br.newContext()).newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.goto(URL); await page.waitForTimeout(300);
await page.click('#roleStudent'); await page.waitForTimeout(200);

console.log('\n【單字表：本次範圍】');
await page.click('#modeWordList'); await page.waitForTimeout(300);
check(await page.isVisible('#wordListScreen'), '進得去單字表');
const scopeN = await page.evaluate(()=>fullPool().length);
check(await page.locator('.wl-item').count() === scopeN, `列出本次範圍全部 ${scopeN} 個字`);
const first = await page.locator('.wl-item').first().innerText();
check(/總是/.test(first), '有中文意思');
check((first.match(/\n/g)||[]).length >= 2, '每個字都有兩句例句');
check(!/_{2,}/.test(await page.locator('#wlList').innerText()), '例句的空格已經填回單字（不是 ___）');
check(!/\s,/.test(await page.locator('#wlList').innerText()), '填回後沒有「字 ，」這種多餘空格');
check(await page.locator('.wl-item').first().locator('.say-btn').count() >= 3, '單字與兩句例句都有發音鈕');
const said = await page.evaluate(()=>{
  const calls=[];
  window.speechSynthesis.speak = u => calls.push(u.text);
  document.querySelector('.wl-item .say-btn').click();
  return calls;
});
check(said.length===1 && /^[A-Za-z]/.test(said[0]), `點發音鈕會唸出英文（唸了「${said[0]}」）`);

console.log('\n【單字表：搜尋與分頁】');
await page.fill('#wlSearch','終於'); await page.waitForTimeout(150);
check(await page.locator('.wl-item').count() === 1, '用中文搜尋找得到（終於 → finally）');
await page.click('#wlTabRow .pill[data-wl="all"]');
await page.fill('#wlSearch','watermelon'); await page.waitForTimeout(150);
check((await page.locator('.wl-item').first().innerText()).includes('西瓜'), '查得到以前教過的字（watermelon）');
await page.fill('#wlSearch',''); await page.waitForTimeout(200);
const hint = await page.textContent('#wlHint');
check(/前 60 個/.test(hint), `一千多字時只列前 60 筆，不會卡住（${hint.trim()}）`);
await page.fill('#wlSearch','zzzzz'); await page.waitForTimeout(150);
check(/找不到/.test(await page.textContent('#wlHint')), '查無結果會說明');

console.log('\n【單字表：我的錯題】');
await page.evaluate(()=>{
  fullPool().slice(0,3).forEach((w,i)=> historyData[w.en]={en:w.en,zh:w.zh,cat:w.cat,count:i+1,types:{en2zh:1},lastWrong:Date.now()});
  saveHistory();
});
await page.click('#wlTabRow .pill[data-wl="wrong"]');
await page.fill('#wlSearch',''); await page.waitForTimeout(200);
check(await page.locator('.wl-item').count() === 3, '只列出自己答錯過的字');
check((await page.locator('#wlList').innerText()).includes('錯 3 次'), '看得到錯了幾次');

console.log('\n【成績單：答錯的字要看得到例句】');
await page.click('#wlBackHint'); await page.waitForTimeout(200);
await page.click('#modePractice'); await page.waitForTimeout(200);
await page.click('#startBtn'); await page.waitForTimeout(300);
for(let i=0;i<5;i++){
  await page.evaluate(()=>{
    const q=quiz[qIndex];
    const btns=[...document.querySelectorAll('#mcBox .opt')];
    (btns.find(b=>b.textContent!==q.correctText)||btns[0]).click();
  });
  await page.waitForTimeout(120);
  if(await page.isVisible('#nextBtn')) { await page.click('#nextBtn'); await page.waitForTimeout(150); }
}
// 第 5 題答錯後是 setTimeout(900ms) 才跳成績單，等它出現再檢查
await page.waitForSelector('#resultScreen:not(.hidden)', { timeout: 5000 }).catch(()=>{});
check(await page.isVisible('#resultScreen'), '答錯 5 題結束，出現成績單');
const senCount = await page.locator('#reviewList .wl-sent').count();
check(senCount === 5, `五個答錯的字都附上例句（${senCount} 筆）`);
const senText = await page.locator('#reviewList .wl-sent').first().innerText();
check(!/_{2,}/.test(senText), `例句是完整句子，不是挖空（「${senText.trim()}」）`);
check(await page.locator('#reviewList .say-btn').count() >= 5, '答錯的字可以點發音');

console.log('\n【瀏覽器不支援發音時不能壞掉】');
const p2 = await (await br.newContext()).newPage();
const errs2=[]; p2.on('pageerror',e=>errs2.push(String(e)));
await p2.addInitScript(()=>{ try{ delete window.speechSynthesis; }catch(e){} });
await p2.goto(URL); await p2.waitForTimeout(300);
await p2.click('#roleStudent'); await p2.waitForTimeout(200);
await p2.click('#modeWordList'); await p2.waitForTimeout(300);
check(await p2.locator('.wl-item').count() > 0, '單字表照常顯示');
check(await p2.locator('.say-btn').count() === 0, '沒有語音支援時不顯示發音鈕（不會給假按鈕）');
check(errs2.length===0, '沒有 JS 例外');

check(errs.length===0, '主流程沒有 JS 例外' + (errs.length? '：'+errs[0] : ''));
await br.close();
console.log(fails ? `\n❌ ${fails} 項未通過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);

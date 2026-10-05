// 端對端測試：警專單字卡（翻牌學習）
//
//   node tools/run-e2e.mjs flashcard
//
// 單字卡是「學習用」，跟測驗分開：
//   1. 主頁的警專專區有兩個入口：單字卡、測驗，各走各的設定頁
//   2. 翻牌、換卡、發音、標記「我會了／還不熟」都能用（手機用滑的、電腦用鍵盤）
//   3. 翻牌不計分：錯題紀錄、測驗紀錄、熱力圖一筆都不能多
import { chromium } from 'playwright';
const URL = process.env.QUIZ_URL || 'http://127.0.0.1:8099/index.html';
let fails=0; const ok=m=>console.log('  ✓ '+m); const bad=m=>{console.log('  ✗ '+m);fails++;};
const check=(c,m)=>c?ok(m):bad(m);
const br = await chromium.launch();
const ctx = await br.newContext({ viewport:{width:375,height:740}, isMobile:true, hasTouch:true });
const page = await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e)));
await page.goto(URL); await page.waitForTimeout(300);
await page.waitForFunction(()=>window.__bankReady===true, null, {timeout:15000}).catch(()=>{});
await page.evaluate(()=>{ try{ localStorage.removeItem('vocabQuiz:policeCards'); }catch(e){} });
await page.click('#roleStudent'); await page.waitForTimeout(200);

const snap = () => page.evaluate(()=>JSON.stringify({ h: historyData, s: (store && store.profiles) || null }));
const before = await snap();

console.log('\n【入口：學習跟測驗分開】');
check(await page.isVisible('#modePoliceStudy'), '警專專區看得到「警專單字卡」');
check(await page.isVisible('#modePolice'), '警專專區看得到「警專測驗」');
await page.click('#modePoliceStudy'); await page.waitForTimeout(200);
check(await page.isVisible('#policeStudySetupScreen'), '單字卡有自己的設定頁');
check(!(await page.isVisible('#policeSetupScreen')), '不是測驗的設定頁');
const units = await page.evaluate(()=>POLICE_UNITS.map(u=>({id:u.id, label:u.label, n:u.words.length})));
check(await page.locator('#studyCatGrid .cat-tab').count() === units.length, `列出 ${units.length} 組可以背`);
check(await page.locator('#studyCatGrid .cat-tab.off').count() === units.length, '預設一組都沒勾（不會一次翻兩千多張）');
check(await page.isDisabled('#studyStartBtn'), '沒選組別時不能開始');

const u0 = units.find(u=>u.id==='pol-law') || units[0];
await page.click(`#studyCatGrid .cat-tab[data-cat="${u0.id}"]`);
check((await page.textContent('#studyPoolHint')).includes(String(u0.n)), `勾「${u0.label}」後提示寫出 ${u0.n} 個字`);
check(!(await page.isDisabled('#studyStartBtn')), '勾了就能開始');

console.log('\n【翻牌】');
await page.click('#studyStartBtn'); await page.waitForTimeout(250);
check(await page.isVisible('#flashScreen'), '進入翻牌畫面');
check((await page.textContent('#flashProgress')).trim() === `1 / ${u0.n}`, `進度寫 1 / ${u0.n}`);
const cur = () => page.evaluate(()=>flash.deck[flash.i]);
let w = await cur();
check(w.cat === u0.id, '牌組只有選的那一組');
check((await page.textContent('#flashFront')).includes(w.en), '正面是英文');
check(!(await page.textContent('#flashFront')).includes(w.zh), '正面看不到中文');
check(await page.isDisabled('#flashPrev'), '第一張不能按「上一張」');
await page.click('#flashFront'); await page.waitForTimeout(500);
check(await page.evaluate(()=>document.getElementById('flashCard').classList.contains('flipped')), '點卡片會翻面');
const back = await page.textContent('#flashBack');
check(back.includes(w.zh), '背面有中文');
check(await page.locator('#flashBack mark').count() === 1 && (await page.textContent('#flashBack mark')) === w.en,
  '背面有例句，空格填回這個字並標亮');
const backBox = await page.locator('#flashBack').boundingBox();
check(backBox && backBox.y + backBox.height <= 740 + 400, '卡片在畫面內');

await page.click('#flashNext'); await page.waitForTimeout(200);
check((await page.textContent('#flashProgress')).trim() === `2 / ${u0.n}`, '「下一張」換到第 2 張');
check(!(await page.evaluate(()=>document.getElementById('flashCard').classList.contains('flipped'))), '換卡後回到正面');
await page.click('#flashPrev'); await page.waitForTimeout(150);
check((await page.textContent('#flashProgress')).trim() === `1 / ${u0.n}`, '「上一張」回到第 1 張');

// 手機左滑換下一張
const box = await page.locator('#flashCard').boundingBox();
await page.evaluate(({x,y})=>{
  const el = document.getElementById('flashCard');
  const t = (cx)=> new Touch({ identifier:1, target:el, clientX:cx, clientY:y });
  el.dispatchEvent(new TouchEvent('touchstart', { changedTouches:[t(x+120)], bubbles:true }));
  el.dispatchEvent(new TouchEvent('touchend', { changedTouches:[t(x-40)], bubbles:true, cancelable:true }));
}, { x: box.x + box.width/2, y: box.y + box.height/2 });
await page.waitForTimeout(150);
check((await page.textContent('#flashProgress')).trim() === `2 / ${u0.n}`, '在卡片上往左滑換下一張');
await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(100);
check((await page.textContent('#flashProgress')).trim() === `1 / ${u0.n}`, '鍵盤 ← 回上一張');
await page.keyboard.press(' '); await page.waitForTimeout(100);
check(await page.evaluate(()=>document.getElementById('flashCard').classList.contains('flipped')), '鍵盤空白鍵翻面');

console.log('\n【我會了／還不熟】');
w = await cur();
await page.click('#flashYes'); await page.waitForTimeout(150);
check((await page.textContent('#flashProgress')).trim() === `2 / ${u0.n}`, '按「我會了」自動換下一張');
const w2 = await cur();
await page.click('#flashNo'); await page.waitForTimeout(150);
const saved = await page.evaluate(()=>JSON.parse(localStorage.getItem('vocabQuiz:policeCards')||'{}'));
check(Array.isArray(saved.known) && saved.known.includes(w.en), '「我會了」記在這台裝置');
check(!saved.known.includes(w2.en), '「還不熟」的不會被記成會了');

// 縮成三張牌，走到結束畫面
await page.evaluate(()=> startFlash(flash.deck.slice(0,3)));
await page.waitForTimeout(150);
await page.click('#flashYes'); await page.click('#flashNo'); await page.click('#flashNo');
await page.waitForTimeout(200);
check(await page.isVisible('#flashDone'), '最後一張之後出現結果');
const done = await page.textContent('#flashDone');
check(/會了\s*1/.test(done) && /還不熟\s*2/.test(done), '結果寫出會了 1、還不熟 2');
await page.click('#flashAgainNo'); await page.waitForTimeout(150);
check((await page.textContent('#flashProgress')).trim() === '1 / 2', '「再翻一次還不熟的」只翻那 2 張');

console.log('\n【中文當正面、跳過已經會的】');
await page.click('#flashExit'); await page.waitForTimeout(150);
check(await page.isVisible('#policeStudySetupScreen'), '「結束」回到單字卡設定頁');
check((await page.textContent('#studyPoolHint')).includes('跳過已經會的'), '提示寫出會跳過已經會的字');
await page.click('#studyFrontRow .pill[data-front="zh"]');
await page.click('#studyStartBtn'); await page.waitForTimeout(200);
w = await cur();
check((await page.textContent('#flashFront')).includes(w.zh) && !(await page.textContent('#flashFront')).includes(w.en),
  '選「中文」時正面是中文、看不到英文');
const deckEn = await page.evaluate(()=>flash.deck.map(x=>x.en));
check(!deckEn.includes(saved.known[0]), '標成「我會了」的字這一輪被跳過');

console.log('\n【學習不計分】');
const after = await snap();
check(after === before, '錯題紀錄與測驗紀錄完全沒變');
const sw = await page.evaluate(()=>document.documentElement.scrollWidth);
check(sw <= 375, `手機沒有橫向捲動（${sw}px）`);

console.log('\n【測驗那邊不受影響】');
await page.click('#flashExit'); await page.click('#backHintStudy'); await page.waitForTimeout(150);
await page.click('#modePolice'); await page.waitForTimeout(200);
check(await page.isVisible('#policeSetupScreen'), '「警專測驗」進的是測驗設定頁');
check(await page.locator('#policeCatGrid .cat-tab.off').count() === 0, '測驗的組別照舊預設全選（跟單字卡各記各的）');
check(errs.length === 0, '沒有 JS 執行期錯誤' + (errs.length ? '：' + errs.join(' | ') : ''));

await br.close();
console.log(fails ? `\n❌ ${fails} 項未通過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);

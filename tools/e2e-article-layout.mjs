// 端對端測試：文章閱讀的版面
//
//   npx http-server -p 8099 -s .      # 另開一個終端機
//   node tools/e2e-article-layout.mjs # 需要 playwright
//
// 手機（390px）：選項固定在畫面底部、2×2 排列，回饋與按鈕都要點得到，
// 「返回主頁」不能被固定面板蓋住（這點曾經真的壞過）。
// 桌機（1200px）：文章在左、選項在右。
import { chromium } from 'playwright';
let fails=0; const check=(c,m)=>c?console.log('  ✓ '+m):(console.log('  ✗ '+m),fails++);
const URL = process.env.QUIZ_URL || 'http://127.0.0.1:8099/index.html';
const br=await chromium.launch();
const p=await (await br.newContext({viewport:{width:390,height:780},isMobile:true,hasTouch:true})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto(URL); await p.waitForTimeout(400);
await p.evaluate(()=>{ SYNC_CONFIG.enabled=false; });
await p.click('#roleStudent'); await p.waitForTimeout(200);
await p.click('#modeArticle'); await p.waitForTimeout(250);
await p.locator('#articleList .art-card').first().click(); await p.waitForTimeout(300);

console.log('\n【手機：選項面板】');
const vp=780;
const side=await p.locator('.art-side').boundingBox();
check(side.y+side.height<=vp+2, `選項面板在視窗內（底部 y=${Math.round(side.y+side.height)} ≤ ${vp}）`);
const opts=await p.locator('#artOptions .opt').count();
check(opts===4, '4 個選項');
const b1=await p.locator('#artOptions .opt').nth(0).boundingBox();
const b2=await p.locator('#artOptions .opt').nth(1).boundingBox();
check(Math.abs(b1.y-b2.y)<5, '前兩個選項並排（2×2 格）');

console.log('\n【答題後：回饋與下一格要看得到】');
await p.locator('#artOptions .opt').nth(0).click(); await p.waitForTimeout(200);
const fb=await p.locator('#artFeedback').boundingBox();
const nx=await p.locator('#artNextBtn').boundingBox();
check(fb && fb.y+fb.height<=vp+2, '回饋文字在視窗內');
check(nx && nx.y+nx.height<=vp+2, `「下一格」按鈕在視窗內（底部 y=${Math.round(nx.y+nx.height)}）`);
await p.locator('#artNextBtn').click(); await p.waitForTimeout(200);
check(await p.evaluate(()=>artIndex)===1, '可以前進到下一格');

console.log('\n【捲到底：文章結尾不會被面板永久遮住】');
await p.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
await p.waitForTimeout(300);
const lastPara = await p.evaluate(()=>{
  const ps=document.querySelectorAll('#artText p');
  const r=ps[ps.length-1].getBoundingClientRect();
  const s=document.querySelector('.art-side').getBoundingClientRect();
  return { bottom:Math.round(r.bottom), sideTop:Math.round(s.top), vh:window.innerHeight };
});
check(lastPara.bottom<=lastPara.sideTop+2, `最後一段（底 ${lastPara.bottom}）在面板上方（頂 ${lastPara.sideTop}），沒被遮住`);

console.log('\n【回到其他畫面要恢復窄版】');
await p.evaluate(()=>window.scrollTo(0,0));
await p.click('#artQuitHint'); await p.waitForTimeout(150);
await p.click('#artQuitHint'); await p.waitForTimeout(250);
check(!(await p.evaluate(()=>document.querySelector('.binder').classList.contains('wide'))), '離開後 .wide 已移除');
check(errs.length===0, errs.length?'JS 例外：'+errs.join('|'):'沒有 JS 例外');
await p.close();

// ---- 桌機版面：左右並排 ----
console.log('\n【桌機（1200px）：左右並排】');
const d=await (await br.newContext({viewport:{width:1200,height:900}})).newPage();
await d.goto(URL); await d.waitForTimeout(400);
await d.evaluate(()=>{ SYNC_CONFIG.enabled=false; });
await d.click('#roleStudent'); await d.waitForTimeout(200);
await d.click('#modeArticle'); await d.waitForTimeout(250);
await d.locator('#articleList .art-card').first().click(); await d.waitForTimeout(300);
const dt=await d.locator('#artText').boundingBox();
const ds=await d.locator('.art-side').boundingBox();
check(ds.x >= dt.x+dt.width-5, `選項在文章右側（文章右緣 ${Math.round(dt.x+dt.width)}，選項左緣 ${Math.round(ds.x)}）`);
check(Math.abs(ds.y-dt.y)<60, '兩欄頂端對齊');
check(await d.evaluate(()=>document.querySelector('.binder').classList.contains('wide')), '閱讀畫面套用寬版面');
await d.close();

await br.close();
console.log(fails?`\n❌ ${fails} 項未通過`:'\n✅ 全部通過');
process.exit(fails?1:0);

// 端對端測試：學生手機＋老師 iPad 輪流做題，錯題一個都不能少
//
// 兩個獨立的瀏覽器 context = 兩台裝置（各自有自己的 localStorage），
// 共用同一個模擬雲端。這一套就是老師實際的使用方式：
//   - 學生在自己手機上做題
//   - 也會在老師的 iPad 上切成「學生」做題
//   - 老師在 iPad 上切回「老師」看報告
import { chromium } from 'playwright';
const URL  = process.env.QUIZ_URL || 'http://127.0.0.1:8099/index.html';
const MOCK = process.env.MOCK_DB  || 'http://127.0.0.1:8100';
let fails=0; const ok=m=>console.log('  ✓ '+m); const bad=m=>{console.log('  ✗ '+m);fails++;};
const check=(c,m)=>c?ok(m):bad(m);
const br = await chromium.launch();
const errs = [];
// 每一輪用自己的雲端位置。模擬雲端會保留資料，重跑時若共用位置，
// 這一輪的錯題會疊在上一輪留下的資料上。
const RUN = Date.now().toString(36);

async function device(key){
  const ctx = await br.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e=>errs.push(String(e)));
  await open(page, key);
  return { ctx, page };
}
// 打開（或重新打開）網頁：等題庫好了，把雲端指到模擬伺服器，然後做「打開時的同步」
async function open(page, key){
  await page.goto(URL);
  await page.waitForFunction(()=>window.__bankReady===true,null,{timeout:20000});
  return page.evaluate(async ({mock, key})=>{
    SYNC_CONFIG.dbUrl = mock; SYNC_CONFIG.classKey = key;
    if(!role) setRole('student');
    const r = await syncNow(); afterBackgroundSync(r); return r;
  }, {mock: MOCK, key});
}
// 在這台裝置上做一次題：wrong 是答錯的字，cleared 是錯題重練答對的字
async function quiz(page, wrong, cleared=[]){
  return page.evaluate(async ({wrong, cleared})=>{
    setRole('student');
    wrong.forEach(en=> recordWrong(en, '', 'en2zh', ''));
    cleared.forEach(en=>{
      if(historyData[en]){ historyData[en].count -= 1; if(historyData[en].count <= 0) delete historyData[en]; }
    });
    recordSession({ date: Date.now(), mode: cleared.length ? 'retry' : 'practice',
                    total: 10, correct: 10 - wrong.length, wrong });
    saveHistory();
    return syncNow();                // 跟 showResult() 做完時一樣
  }, {wrong, cleared});
}
const words = page => page.evaluate(()=>{
  const o = {}; Object.values(store.profiles.student.words).forEach(w=>o[w.en]=w.count); return o;
});
const cloud = (page) => page.evaluate(async ()=>{
  const d = await (await fetch(syncUrl(), {cache:'no-store'})).json();
  const o = {}; ((d && Array.isArray(d.w)) ? d.w : []).forEach(r=>o[r[0]]=r[1]); return o;
});
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const show = o => Object.entries(o).sort().map(([k,v])=>`${k}×${v}`).join(' ') || '（空）';

// ──────────────────────────────────────────────
console.log('\n【1. 手機做一次、iPad 做一次，錯題全部累加】');
{
  const KEY = 'dev1-' + RUN;
  const phone = await device(KEY), ipad = await device(KEY);
  await quiz(phone.page, ['absent', 'blank']);
  await quiz(ipad.page,  ['blank', 'alive']);
  await open(phone.page, KEY);                         // 學生之後再打開手機
  const p = await words(phone.page), i = await words(ipad.page), c = await cloud(phone.page);
  const want = { absent:1, blank:2, alive:1 };
  check(same(p, want), `手機：${show(p)}`);
  check(same(c, want), `雲端：${show(c)}`);
  check(same(i, want), `iPad：${show(i)}`);
  // 老師在 iPad 切回老師看報告
  const t = await ipad.page.evaluate(async ()=>{
    setRole('teacher'); showScreen(reportScreen); await refreshReport();
    const o = {}; Object.values(store.profiles.student.words).forEach(w=>o[w.en]=w.count); return o;
  });
  check(same(t, want), `老師報告：${show(t)}`);
  await phone.ctx.close(); await ipad.ctx.close();
}

console.log('\n【2. 手機沒網路時做的題，連上之後補上去，不會被 iPad 蓋掉】');
{
  const KEY = 'dev2-' + RUN;
  const phone = await device(KEY), ipad = await device(KEY);
  await phone.ctx.setOffline(true);
  const off = await quiz(phone.page, ['usual']);
  check(!off.ok, '手機離線：這次同步失敗（預期中）');
  check((await words(phone.page)).usual === 1, '但錯題已經記在手機上');
  await quiz(ipad.page, ['whole']);                    // 這時 iPad 有網路
  await phone.ctx.setOffline(false);
  await open(phone.page, KEY);
  const p = await words(phone.page), c = await cloud(phone.page);
  check(p.usual === 1 && p.whole === 1, `手機連上後兩題都在：${show(p)}`);
  check(c.usual === 1 && c.whole === 1, `雲端也兩題都在：${show(c)}`);
  await phone.ctx.close(); await ipad.ctx.close();
}

console.log('\n【3. 在 iPad 上錯題重練練掉的字，手機那邊也會消失】');
{
  const KEY = 'dev3-' + RUN;
  const phone = await device(KEY), ipad = await device(KEY);
  await quiz(phone.page, ['absent', 'blank']);
  await open(ipad.page, KEY);
  await quiz(ipad.page, [], ['blank']);                // iPad 上練掉 blank
  await open(phone.page, KEY);
  const p = await words(phone.page);
  check(!('blank' in p), `手機上 blank 也消失了：${show(p)}`);
  check(p.absent === 1, '沒練的 absent 還在');
  await phone.ctx.close(); await ipad.ctx.close();
}

console.log('\n【4. 同步很多次也不會重複加】');
{
  const KEY = 'dev4-' + RUN;
  const phone = await device(KEY), ipad = await device(KEY);
  await quiz(phone.page, ['absent']);
  for(let n=0;n<4;n++){ await open(phone.page, KEY); await open(ipad.page, KEY); }
  const c = await cloud(phone.page), i = await words(ipad.page);
  check(c.absent === 1, `兩台各打開 4 次後，雲端 absent 還是 1（實際 ${c.absent}）`);
  check(i.absent === 1, `iPad 上也是 1（實際 ${i.absent}）`);
  await phone.ctx.close(); await ipad.ctx.close();
}

console.log('\n【5. 手機的資料被清掉（換手機、瀏覽器清除），打開就全部回來】');
{
  const KEY = 'dev5-' + RUN;
  const phone = await device(KEY), ipad = await device(KEY);
  await quiz(phone.page, ['absent', 'blank', 'alive']);
  await quiz(ipad.page,  ['usual']);
  await phone.page.evaluate(()=>localStorage.clear());
  await open(phone.page, KEY);
  const p = await words(phone.page);
  check(same(p, {absent:1, blank:1, alive:1, usual:1}), `手機全部回來：${show(p)}`);
  const panel = await phone.page.evaluate(()=>!document.getElementById('historyPanel').classList.contains('hidden'));
  check(panel, '錯題面板直接顯示，不用先做一次測驗');
  await phone.ctx.close(); await ipad.ctx.close();
}

console.log('\n【6. 兩台同一天各做一次，熱力圖算 2 次；作答紀錄 2 筆】');
{
  const KEY = 'dev6-' + RUN;
  const phone = await device(KEY), ipad = await device(KEY);
  await quiz(phone.page, ['absent']);
  await quiz(ipad.page,  ['blank']);
  await open(phone.page, KEY);
  const r = await phone.page.evaluate(()=>({
    today: store.profiles.student.days[dayNum(new Date())], sessions: store.profiles.student.sessions.length }));
  check(r.today === 2, `今天的格子是 2（實際 ${r.today}）`);
  check(r.sessions === 2, `作答紀錄 2 筆（實際 ${r.sessions}）`);
  await phone.ctx.close(); await ipad.ctx.close();
}

console.log('\n【7. 升級到這一版的第一次：兩台都有舊紀錄，取聯集，不重複計算】');
{
  const KEY = 'dev7-' + RUN;
  const phone = await device(KEY), ipad = await device(KEY);
  // 模擬上一版留下的狀態：雲端是 v2、兩台都有紀錄、但都還沒有對齊點
  await phone.page.evaluate(async ()=>{
    await fetch(syncUrl(), { method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ v:2, t:Date.now(), w:[['absent',3,'e3',20000],['blank',1,'e1',20000]], s:[], d:[[20261003,2]] }) });
  });
  for(const [pg, ws] of [[phone.page, {absent:3, blank:1, usual:2}], [ipad.page, {absent:3, alive:1}]]){
    await pg.evaluate((ws)=>{
      setRole('student');
      store.profiles.student = blankProfile();
      Object.entries(ws).forEach(([en,c])=>{ store.profiles.student.words[en] = { en, zh:'x', cat:'adjectives3', count:c, types:{}, lastWrong:1 }; });
      store.syncBase = null; syncHistoryView(); saveHistory(true);
    }, ws);
  }
  await phone.page.evaluate(()=>syncNow()); await ipad.page.evaluate(()=>syncNow());
  await phone.page.evaluate(()=>syncNow()); await ipad.page.evaluate(()=>syncNow());
  const c = await cloud(phone.page);
  check(same(c, {absent:3, blank:1, usual:2, alive:1}),
    `聯集且重疊的不相加（absent 三邊都是 3 → 3）：${show(c)}`);
  await phone.ctx.close(); await ipad.ctx.close();
}

console.log('\n【8. 舊版雲端可能混過測試資料：以學生手機為準】');
{
  const KEY = 'dev8-' + RUN;
  const phone = await device(KEY);
  await phone.page.evaluate(async ()=>{
    await fetch(syncUrl(), { method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ v:1, t:Date.now(), w:[['crime',1,'e1',20000]], s:[], d:[] }) });
    store.profiles.student = blankProfile();
    store.profiles.student.words.absent = { en:'absent', zh:'缺席的', cat:'adjectives3', count:2, types:{}, lastWrong:1 };
    store.syncBase = null; syncHistoryView(); saveHistory(true);
    await syncNow();
  });
  const p = await words(phone.page), c = await cloud(phone.page);
  check(!('crime' in p) && !('crime' in c), `測試留下的字沒被吸進來：手機 ${show(p)}／雲端 ${show(c)}`);
  await phone.ctx.close();
}

console.log('\n【9. 錯題全部練掉：雲端寫得進去、讀得回來】');
{
  const KEY = 'dev9-' + RUN;
  const phone = await device(KEY), ipad = await device(KEY);
  await quiz(phone.page, ['absent']);
  const r = await quiz(phone.page, [], ['absent']);
  check(r.ok, '全部練掉時同步成功');
  const back = await open(ipad.page, KEY);
  check(back.ok && Object.keys(await words(ipad.page)).length === 0, 'iPad 讀回來是空的錯題本，沒有壞掉');
  await phone.ctx.close(); await ipad.ctx.close();
}

console.log('\n【10. 老師按「清除學生紀錄」：每台裝置都會清掉】');
{
  const KEY = 'dev10-' + RUN;
  const phone = await device(KEY), ipad = await device(KEY);
  await quiz(phone.page, ['absent', 'blank']);
  await ipad.page.evaluate(async ()=>{ setRole('teacher'); await syncNow(); clearStudentRecord();
    await new Promise(r=>setTimeout(r,300)); });
  await open(phone.page, KEY);
  const p = await words(phone.page), c = await cloud(phone.page);
  check(Object.keys(c).length === 0, `雲端清空（${show(c)}）`);
  check(Object.keys(p).length === 0, `手機下次打開也清空（${show(p)}）`);
  // 清完之後再做題，照常累加
  await quiz(phone.page, ['alive']);
  check((await cloud(phone.page)).alive === 1, '清完之後再做題，照常記錄');
  await phone.ctx.close(); await ipad.ctx.close();
}

console.log('\n【11. 文法練習的紀錄不上雲端，同步後要留在本機】');
{
  const KEY = 'dev11-' + RUN;
  const phone = await device(KEY);
  const r = await phone.page.evaluate(async ()=>{
    store.profiles.student.gm = { 'g-test': { n:3, best:5, total:5 } };
    recordWrong('absent','','en2zh',''); saveHistory();
    await syncNow();
    return store.profiles.student.gm['g-test'];
  });
  check(r && r.n === 3, '文法練習紀錄還在');
  await phone.ctx.close();
}

console.log('\n【12. 上傳送到雲端了，但手機沒收到回應就被關掉：下次打開不可以重複加】');
{
  const KEY = 'dev12-' + RUN;
  const phone = await device(KEY);
  // 攔下這一次 PUT：照樣轉給雲端（雲端真的收到），但對頁面回報連線中斷
  await phone.page.route('**/*.json', async route=>{
    if(route.request().method() === 'PUT'){ await route.fetch(); await route.abort('connectionreset'); }
    else await route.continue();
  });
  const r = await quiz(phone.page, ['absent', 'blank']);
  check(!r.ok, '頁面以為這次失敗了（模擬做完馬上關 App）');
  await phone.page.unroute('**/*.json');
  check((await cloud(phone.page)).absent === 1, '但雲端其實收到了');
  await open(phone.page, KEY);           // 下次打開
  await open(phone.page, KEY);           // 再打開一次
  const c = await cloud(phone.page), p = await words(phone.page);
  check(c.absent === 1 && c.blank === 1, `雲端沒有重複加：${show(c)}`);
  check(p.absent === 1 && p.blank === 1, `手機也沒有：${show(p)}`);
  await phone.ctx.close();
}

console.log('\n【13. 上傳根本沒送到：下次打開要補上去（一次）】');
{
  const KEY = 'dev13-' + RUN;
  const phone = await device(KEY);
  await phone.page.route('**/*.json', async route=>{
    if(route.request().method() === 'PUT') await route.abort('connectionreset');
    else await route.continue();
  });
  await quiz(phone.page, ['alive']);
  await phone.page.unroute('**/*.json');
  check(!('alive' in await cloud(phone.page)), '雲端還沒有');
  await open(phone.page, KEY);
  await open(phone.page, KEY);
  const c = await cloud(phone.page);
  check(c.alive === 1, `下次打開補上去了，而且只算一次（${show(c)}）`);
  await phone.ctx.close();
}

check(errs.length === 0, errs.length ? 'JS 例外：' + errs[0] : '沒有 JS 例外');
await br.close();
console.log(fails ? `\n❌ ${fails} 項未通過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);

// 端對端測試：儲存空間與資料保全
//
// 這一套盯的是「學生的紀錄不見了」那一類事故：
//   1. 寫不進去（空間滿）不可以連帶讓既有紀錄讀不出來
//   2. 空間不足時先犧牲題庫快取，不要犧牲學生的紀錄
//   3. 空的紀錄不可以把雲端上唯一的備份蓋掉
import { chromium } from 'playwright';
const URL = process.env.QUIZ_URL || 'http://127.0.0.1:8099/index.html';
const MOCK = process.env.MOCK_DB || 'http://127.0.0.1:8100';
let fails=0; const ok=m=>console.log('  ✓ '+m); const bad=m=>{console.log('  ✗ '+m);fails++;};
const check=(c,m)=>c?ok(m):bad(m);
const br = await chromium.launch();

const SEED = `(function(){
  var words={};
  ['absent','blank','alive','usual','whole'].forEach(function(en,i){
    words[en]={en:en,zh:'x',cat:'adjectives3',count:i+1,types:{en2zh:1},lastWrong:Date.now()};
  });
  localStorage.setItem('vocabQuiz:v2', JSON.stringify({
    version:2, role:'student', assignDone:null,
    profiles:{ student:{ words:words,
      sessions:[{date:Date.now(), mode:'exam', total:40, correct:31, wrong:['absent']}],
      days:{20261001:2}, gm:{} },
      teacher:{ words:{}, sessions:[], days:{}, gm:{} } }
  }));
})()`;

console.log('\n【1. 空間滿了，既有紀錄還要讀得出來】');
{
  const ctx = await br.newContext();
  const p = await ctx.newPage();
  await p.goto(URL); await p.evaluate(SEED);
  // 下次載入時所有寫入都失敗，但讀取正常 —— 這就是空間滿的樣子
  await p.addInitScript(()=>{
    Storage.prototype.setItem = function(){ const e=new Error('QuotaExceededError');
      e.name='QuotaExceededError'; throw e; };
  });
  await p.goto(URL);
  await p.waitForFunction(()=>window.__bankReady===true,null,{timeout:20000}).catch(()=>{});
  await p.waitForTimeout(400);
  const r = await p.evaluate(()=>({
    words: Object.keys(historyData).length,
    role: String(role),
    onRole: !document.getElementById('roleScreen').classList.contains('hidden'),
    panelHidden: document.getElementById('historyPanel').classList.contains('hidden'),
    note: document.getElementById('storageNote').textContent,
    raw: !!localStorage.getItem('vocabQuiz:v2')
  }));
  check(r.raw, '資料本來就還在 localStorage 裡');
  check(r.words === 5, `五個錯字照樣讀得出來（實際 ${r.words}）`);
  check(r.role === 'student', `身分照樣記得（實際 ${r.role}）`);
  check(!r.onRole, '不會被丟回身分選擇頁');
  check(!r.panelHidden, '錯題面板照常顯示');
  check(r.note.includes('空間滿'), `提示說的是空間滿，不是無痕視窗（${r.note.slice(0,24)}…）`);
  await ctx.close();
}

console.log('\n【2. 空間不足時先讓出題庫快取，保住學生的紀錄】');
{
  const ctx = await br.newContext();
  const p = await ctx.newPage();
  await p.goto(URL); await p.evaluate(SEED);
  await p.addInitScript(()=>{
    // 模擬「只差一點點」：題庫快取還在的時候寫不下，移掉之後就寫得下
    const realSet = Storage.prototype.setItem;
    const realRemove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function(k,v){
      if(k === 'vocabQuiz:v2' && this.getItem('vocabQuiz:bank')){
        const e=new Error('QuotaExceededError'); e.name='QuotaExceededError'; throw e;
      }
      return realSet.call(this,k,v);
    };
  });
  await p.goto(URL);
  await p.waitForFunction(()=>window.__bankReady===true,null,{timeout:20000}).catch(()=>{});
  await p.waitForTimeout(300);
  const r = await p.evaluate(()=>{
    historyData['newword'] = { en:'newword', zh:'新', cat:'adjectives3', count:1, types:{}, lastWrong:Date.now() };
    saveHistory();
    const raw = localStorage.getItem('vocabQuiz:v2');
    return { saved: !!raw && raw.includes('newword'),
             bankGone: !localStorage.getItem('vocabQuiz:bank'),
             storageOK };
  });
  check(r.saved, '新的錯題存得進去');
  check(r.bankGone, '做法是把題庫快取讓出來（下次連網會重抓）');
  check(r.storageOK === true, '存成功後不再顯示「存不下來」');
  await ctx.close();
}

console.log('\n【3. 空的紀錄不可以蓋掉雲端的備份】');
{
  const ctx = await br.newContext();
  const p = await ctx.newPage();
  await p.goto(URL);
  await p.waitForFunction(()=>window.__bankReady===true,null,{timeout:20000}).catch(()=>{});
  // 雲端先有一份有資料的紀錄
  const seeded = await p.evaluate(async (mock)=>{
    SYNC_CONFIG.dbUrl = mock; SYNC_CONFIG.classKey = 'storage-test';
    const body = { v:1, t:Date.now(),
      w:[['absent',3,'e3',20000],['blank',2,'e2',20000]],
      s:[[20000,'e',40,30]], d:[[20261001,2]] };
    const r = await fetch(syncUrl(), { method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(body) });
    return r.ok;
  }, MOCK);
  check(seeded, '雲端先放一份有 2 個錯字、1 筆成績的紀錄');

  const r = await p.evaluate(async ()=>{
    setRole('student');
    store.profiles.student = blankProfile();   // 這台裝置的紀錄是空的
    syncHistoryView();
    const push = await syncPush();             // 做完測驗時會走到這裡
    const after = await (await fetch(syncUrl(), { cache:'no-store' })).json();
    return { refused: !!push.refused, ok: push.ok,
             cloudW: (after.w||[]).length, cloudS: (after.s||[]).length };
  });
  check(r.refused && !r.ok, '空紀錄的上傳被擋下來');
  check(r.cloudW === 2 && r.cloudS === 1,
    `雲端的紀錄原封不動（錯字 ${r.cloudW}、成績 ${r.cloudS}）`);

  // 學生自己按「清除紀錄」是明確的意思，要清得掉
  const forced = await p.evaluate(async ()=>{
    const push = await syncPush(true);
    const after = await (await fetch(syncUrl(), { cache:'no-store' })).json();
    return { ok: push.ok, cloudW: ((after||{}).w||[]).length };
  });
  check(forced.ok && forced.cloudW === 0, '學生自己按「清除紀錄」時仍然清得掉雲端');
  await ctx.close();
}

await br.close();
console.log(fails? `\n❌ ${fails} 項未通過` : '\n✅ 全部通過');
process.exit(fails?1:0);

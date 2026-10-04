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

console.log('\n【4. 本機存檔：空的不准蓋掉既有的】');
{
  const ctx = await br.newContext();
  const p = await ctx.newPage();
  await p.goto(URL); await p.evaluate(SEED);
  await p.goto(URL);
  await p.waitForFunction(()=>window.__bankReady===true,null,{timeout:20000}).catch(()=>{});
  const r = await p.evaluate(()=>{
    store.profiles.student = blankProfile();   // 模擬「載入失敗變成空的」
    syncHistoryView();
    saveHistory();                              // 這一寫不可以把硬碟上的洗掉
    const disk = JSON.parse(localStorage.getItem('vocabQuiz:v2'));
    const kept = Object.keys(disk.profiles.student.words).length;
    // 但本人按「清除紀錄」要清得掉
    saveHistory(true);
    const after = JSON.parse(localStorage.getItem('vocabQuiz:v2'));
    return { kept, cleared: Object.keys(after.profiles.student.words).length };
  });
  check(r.kept === 5, `記憶體變空時，硬碟上的 5 個錯字留著（實際 ${r.kept}）`);
  check(r.cleared === 0, '本人明確清除時仍然清得掉');
  await ctx.close();
}

console.log('\n【5. 合併而不是覆蓋】');
{
  const ctx = await br.newContext();
  const p = await ctx.newPage();
  await p.goto(URL);
  await p.waitForFunction(()=>window.__bankReady===true,null,{timeout:20000}).catch(()=>{});
  const r = await p.evaluate(()=>{
    const mk = (words, days, sess) => {
      const prof = blankProfile();
      Object.entries(words).forEach(([en,c])=>{
        prof.words[en] = { en, zh:'x', cat:'adjectives3', count:c, types:{en2zh:c}, lastWrong:1 };
      });
      Object.assign(prof.days, days);
      prof.sessions = sess;
      return prof;
    };
    const mine = mk({absent:5, blank:2}, {20261001:3}, [{date:1e12, mode:'exam', total:40, correct:30}]);
    const theirs = mk({absent:1, alive:7}, {20261001:1, 20261002:4}, [{date:2e12, mode:'practice', total:20, correct:18}]);
    const m = mergeProfiles(mine, theirs);
    return {
      words: Object.keys(m.words).sort(),
      absent: m.words.absent.count,
      alive: m.words.alive.count,
      day1: m.days[20261001], day2: m.days[20261002],
      sessions: m.sessions.length
    };
  });
  check(JSON.stringify(r.words) === JSON.stringify(['absent','alive','blank']),
    `兩邊的字都留著（${r.words.join('、')}）`);
  check(r.absent === 5, `同一個字的次數取大的，不是相加也不是覆蓋（absent 5 vs 1 → ${r.absent}）`);
  check(r.alive === 7, '只有對方有的字也帶進來');
  check(r.day1 === 3 && r.day2 === 4, `熱力圖每天取大的（${r.day1} / ${r.day2}）`);
  check(r.sessions === 2, `作答紀錄取聯集（${r.sessions} 筆）`);
  await ctx.close();
}

console.log('\n【6. 雲端變少時，老師端不會被洗掉】');
{
  const ctx = await br.newContext();
  const p = await ctx.newPage();
  await p.goto(URL);
  await p.waitForFunction(()=>window.__bankReady===true,null,{timeout:20000}).catch(()=>{});
  const r = await p.evaluate(async (mock)=>{
    SYNC_CONFIG.dbUrl = mock; SYNC_CONFIG.classKey = 'shrink-test';
    // 雲端只剩兩個字（被空紀錄覆蓋過的樣子）
    await fetch(syncUrl(), { method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ v:1, t:Date.now(), w:[['absent',1,'e1',20000]], s:[], d:[] }) });
    // 老師這台本來有完整的 5 個字
    setRole('teacher');
    store.profiles.student = blankProfile();
    ['absent','blank','alive','usual','whole'].forEach((en,i)=>{
      store.profiles.student.words[en] = { en, zh:'x', cat:'adjectives3', count:i+2, types:{}, lastWrong:1 };
    });
    const before = Object.keys(store.profiles.student.words).length;
    const pull = await syncPull();
    return { before, after: Object.keys(store.profiles.student.words).length,
             pulledWords: pull.pulledWords, absent: store.profiles.student.words.absent.count };
  }, MOCK);
  check(r.before === 5, '老師端原本有 5 個錯字');
  check(r.pulledWords === 1, '雲端只剩 1 個錯字');
  check(r.after === 5, `拉取之後老師端還是 5 個，沒有被洗成 1 個（實際 ${r.after}）`);
  check(r.absent === 2, `重疊的字取次數大的那個（實際 ${r.absent}）`);
  await ctx.close();
}

console.log('\n【7. 測試機器不可以碰到正式環境的資料庫】');
{
  const ctx = await br.newContext();
  const p = await ctx.newPage();
  await p.goto(URL);
  await p.waitForFunction(()=>window.__bankReady===true,null,{timeout:20000}).catch(()=>{});
  const r = await p.evaluate(()=>({
    host: location.hostname,
    prodUrl: PROD_DB_URL,
    enabled: SYNC_CONFIG.enabled,
    ready: syncReady(),
    blocked: syncBlockedHere()
  }));
  check(r.enabled === true, '設定檔裡同步本來是開著的（正式站要用）');
  check(r.blocked === true, `在 ${r.host} 上判定為「不可同步」`);
  check(r.ready === false,
    'syncReady() 回傳 false —— 測試不會把資料寫進正式的 Firebase');

  // 真的試一次：以學生身分做完測驗，不可以送出任何請求到正式網址
  const hits = [];
  p.on('request', req=>{ if(req.url().startsWith(r.prodUrl)) hits.push(req.method()+' '+req.url()); });
  const pushed = await p.evaluate(async ()=>{
    setRole('student');
    historyData['absent'] = { en:'absent', zh:'x', cat:'adjectives3', count:1, types:{}, lastWrong:Date.now() };
    return await syncPush();
  });
  await p.waitForTimeout(300);
  check(pushed.skipped === true, '上傳被跳過（skipped）');
  check(hits.length === 0,
    hits.length ? `竟然連到了正式網址：${hits[0]}` : '完全沒有對正式網址發出任何請求');

  // 把 dbUrl 指到模擬伺服器時要恢復正常，否則同步測不了
  const viaMock = await p.evaluate(async (mock)=>{
    SYNC_CONFIG.dbUrl = mock; SYNC_CONFIG.classKey = 'guard-test';
    return { ready: syncReady(), blocked: syncBlockedHere(), push: (await syncPush()).ok };
  }, MOCK);
  check(viaMock.ready && !viaMock.blocked && viaMock.push,
    '改指到模擬伺服器之後同步恢復正常（同步測試不受影響）');
  await ctx.close();
}

await br.close();
console.log(fails? `\n❌ ${fails} 項未通過` : '\n✅ 全部通過');
process.exit(fails?1:0);

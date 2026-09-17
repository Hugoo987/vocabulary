// 端對端測試：身分區分與紀錄系統
//
//   npx http-server -p 8099 -s .      # 另開一個終端機
//   node tools/e2e.mjs                # 需要 playwright
//
// 測的是「使用者實際會做的事」：選身分、作答、關掉再打開、切換身分、
// 看報告、清紀錄，並確認老師作答不會污染學生的統計。
import { chromium } from 'playwright';

const URL = process.env.QUIZ_URL || 'http://127.0.0.1:8099/index.html';
let fails = 0;
const ok  = m => console.log('  ✓ ' + m);
const bad = m => { console.error('  ✗ ' + m); fails++; };
const check = (c, m) => c ? ok(m) : bad(m);

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
// The sandbox blocks fonts.googleapis.com; that is an environment limit, not a page bug.
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (t.includes('Failed to load resource')) return;
  errs.push('console: ' + t);
});

const visible = id => page.locator('#' + id).isVisible();

// Deliberately pick a wrong option, using the page's own current question.
async function playAllWrong() {
  for (let i = 0; i < 60; i++) {
    if (await page.locator('#resultScreen').isVisible()) return;
    // wait for a fresh, enabled set of options
    try {
      await page.waitForFunction(() => {
        const b = document.querySelectorAll('#mcBox .opt');
        return b.length > 0 && !b[0].disabled;
      }, { timeout: 3000 });
    } catch { return; }

    const correct = await page.evaluate(() => quiz[qIndex].correctText);
    const opts = page.locator('#mcBox .opt');
    const n = await opts.count();
    let clicked = false;
    for (let k = 0; k < n; k++) {
      if ((await opts.nth(k).innerText()).trim() !== correct) {
        await opts.nth(k).click(); clicked = true; break;
      }
    }
    if (!clicked) await opts.nth(0).click();

    // either the round ended, or the next button appeared
    try {
      await page.waitForFunction(() => {
        const res = document.getElementById('resultScreen');
        const nx = document.getElementById('nextBtn');
        return !res.classList.contains('hidden') || !nx.classList.contains('hidden');
      }, { timeout: 3000 });
    } catch { return; }

    if (await page.locator('#resultScreen').isVisible()) return;
    if (await page.locator('#nextBtn').isVisible()) await page.locator('#nextBtn').click();
  }
}

console.log('\n1. 第一次進來');
await page.goto(URL);
await page.waitForTimeout(300);
check(await visible('roleScreen'), '一開始顯示身分選擇畫面');
check(!(await visible('modeScreen')), '尚未顯示模式畫面');

console.log('\n2. 選「我是學生」');
await page.click('#roleStudent');
await page.waitForTimeout(200);
check(await visible('modeScreen'), '進入模式選擇');
check((await page.locator('#whoamiTag').innerText()).includes('學生'), '身分標示為學生');
check(!(await page.locator('#teacherEntry').isVisible()), '學生看不到老師報告入口');

console.log('\n3. 學生做一輪練習（全部答錯）');
await page.click('#modePractice');
await page.waitForTimeout(150);
await page.click('#startBtn');
await page.waitForTimeout(200);
check(await visible('quizScreen'), '進入作答畫面');
await playAllWrong();
await page.waitForTimeout(400);
check(await visible('resultScreen'), '答錯滿 5 題後出現結果畫面');

const stu = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('vocabQuiz:v2'));
  return { role: s.role,
           words: Object.keys(s.profiles.student.words).length,
           sessions: s.profiles.student.sessions.length,
           teacherWords: Object.keys(s.profiles.teacher.words).length };
});
check(stu.role === 'student', 'localStorage 記住身分 = student');
check(stu.words > 0, `學生錯題已寫入 localStorage（${stu.words} 字）`);
check(stu.sessions === 1, `作答紀錄寫入 1 筆（實際 ${stu.sessions}）`);
check(stu.teacherWords === 0, '老師的紀錄仍是空的（沒被學生作答污染）');

console.log('\n4. 重新整理 → 紀錄要留著、直接進模式畫面');
await page.reload();
await page.waitForTimeout(400);
check(await visible('modeScreen'), '記住身分，跳過身分選擇');
check(await page.locator('#historyPanel').isVisible(), '錯題紀錄面板還在');
const after = await page.evaluate(() => Object.keys(
  JSON.parse(localStorage.getItem('vocabQuiz:v2')).profiles.student.words).length);
check(after === stu.words, `重新整理後錯題數不變（${after}）`);

console.log('\n5. 切換成老師');
await page.click('#switchRoleBtn');
await page.waitForTimeout(150);
check(await visible('roleScreen'), '回到身分選擇');
await page.click('#roleTeacher');
await page.waitForTimeout(200);
check((await page.locator('#whoamiTag').innerText()).includes('老師'), '身分標示為老師');
check(await page.locator('#teacherEntry').isVisible(), '老師看得到報告入口');
check(await page.locator('#openPaperBtn').isVisible(), '老師看得到「產生錯題考卷」入口');
// 老師的介面不放測驗，只有報告與數據
const teacherUI = await page.evaluate(()=>({
  modes: !document.getElementById('studentModes').classList.contains('hidden'),
  practice: !!document.getElementById('modePractice').offsetParent,
  exam: !!document.getElementById('modeExam').offsetParent,
  review: !!document.getElementById('modeReview').offsetParent,
  article: !!document.getElementById('modeArticle').offsetParent,
  wordlist: !!document.getElementById('modeWordList').offsetParent,
  myWrong: !!document.getElementById('historyPanel').offsetParent,
}));
check(!teacherUI.modes && !teacherUI.practice && !teacherUI.exam && !teacherUI.review
      && !teacherUI.article && !teacherUI.wordlist,
  '老師看不到任何測驗入口（練習／考試／總複習／文章／單字表）');
check(!teacherUI.myWrong, '老師也不會看到「我的錯題紀錄」');

console.log('\n6. 打開學生學習報告');
await page.click('#openReportBtn');
await page.waitForTimeout(250);
check(await visible('reportScreen'), '進入報告畫面');
const rep = await page.locator('#reportBody').innerText();
check(rep.includes('常錯單字'), '報告有「常錯單字」區塊');
check(rep.includes('各單元弱點'), '報告有「各單元弱點」區塊');
check(rep.includes('哪種題型最容易錯'), '報告有題型分析');
check(rep.includes('歷次作答紀錄'), '報告有歷次成績');
check(rep.includes('平常練習'), '成績列出模式名稱');

console.log('\n7. 紀錄分離：即使在老師身分下作答，也不會污染學生紀錄');
await page.click('#reportBackBtn');
await page.waitForTimeout(150);
// 介面上老師已經沒有測驗入口了，所以直接叫起來跑一輪，確認底層的分離仍然成立
await page.evaluate(()=>{
  mode = 'practice';
  quizIsReview = false;
  quiz = buildQuiz(new Set(ALL_CATS), new Set(ALL_TYPES), 6);
  beginQuiz();
});
await page.waitForTimeout(200);
await playAllWrong();
await page.waitForTimeout(400);
const sep = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('vocabQuiz:v2'));
  return { stu: Object.keys(s.profiles.student.words).length,
           stuSess: s.profiles.student.sessions.length,
           tea: Object.keys(s.profiles.teacher.words).length,
           teaSess: s.profiles.teacher.sessions.length };
});
check(sep.stu === stu.words, `學生錯題數沒被動到（仍為 ${sep.stu}）`);
check(sep.stuSess === 1, '學生作答紀錄沒被加一筆');
check(sep.tea > 0, `老師自己的錯題記在老師名下（${sep.tea} 字）`);
check(sep.teaSess === 1, '老師的作答紀錄記在老師名下');

console.log('\n8. 清除學生紀錄（需按兩次）');
await page.click('#resultBackLink');
await page.waitForTimeout(200);
await page.click('#openReportBtn');
await page.waitForTimeout(200);
await page.click('#clearStudentBtn');
await page.waitForTimeout(150);
const armed = await page.locator('#clearStudentBtn').innerText();
check(armed.includes('再按一次'), '第一次按只進入確認狀態');
const stillThere = await page.evaluate(() => Object.keys(
  JSON.parse(localStorage.getItem('vocabQuiz:v2')).profiles.student.words).length);
check(stillThere > 0, '按一次不會刪除資料');
await page.click('#clearStudentBtn');
await page.waitForTimeout(250);
const cleared = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('vocabQuiz:v2'));
  return { stu: Object.keys(s.profiles.student.words).length,
           tea: Object.keys(s.profiles.teacher.words).length };
});
check(cleared.stu === 0, '按第二次才真的清除學生紀錄');
check(cleared.tea > 0, '老師自己的紀錄沒被一起清掉');

const examN = await page.evaluate(() => Math.min(EXAM_QUESTION_COUNT, ALL_CATS.reduce((n,c)=>n+WORDS[c].length,0)));
console.log(`\n10. 正式考試會記成 exam（${examN} 題）`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(300);
await page.click('#roleStudent');
await page.waitForTimeout(150);
await page.click('#modeExam');
await page.waitForTimeout(150);
await page.click('#examStartBtn');
await page.waitForTimeout(250);
// answer every question correctly so the exam runs to its full 30 questions
for (let i = 0; i < 45; i++) {
  if (await page.locator('#resultScreen').isVisible()) break;
  try {
    await page.waitForFunction(() => {
      const b = document.querySelectorAll('#mcBox .opt');
      return b.length > 0 && !b[0].disabled;
    }, { timeout: 3000 });
  } catch { break; }
  const correct = await page.evaluate(() => quiz[qIndex].correctText);
  const opts = page.locator('#mcBox .opt');
  const n = await opts.count();
  for (let k = 0; k < n; k++) {
    if ((await opts.nth(k).innerText()).trim() === correct) { await opts.nth(k).click(); break; }
  }
  await page.waitForTimeout(70);
  if (await page.locator('#nextBtn').isVisible()) await page.locator('#nextBtn').click();
}
await page.waitForTimeout(400);
const ex = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('vocabQuiz:v2'));
  return s.profiles.student.sessions.slice(-1)[0];
});
check(ex && ex.mode === 'exam', `正式考試記成 mode=exam（實際 ${ex && ex.mode}）`);
check(ex && ex.total === examN, `正式考試記錄 ${examN} 題（實際 ${ex && ex.total}）`);
check(ex && ex.correct === examN, `全對記成 ${examN} 分（實際 ${ex && ex.correct}）`);

console.log('\n11. 瀏覽器禁止儲存時不能整頁壞掉');
const ctx2 = await browser.newContext();
const p2 = await ctx2.newPage();
const errs2 = [];
p2.on('pageerror', e => errs2.push(String(e)));
await p2.addInitScript(() => {
  // simulate a private window / blocked site data: every access throws
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('blocked', 'SecurityError'); }
  });
});
await p2.goto(URL);
await p2.waitForTimeout(400);
check(await p2.locator('#roleScreen').isVisible(), '仍然顯示身分選擇畫面');
await p2.click('#roleStudent');
await p2.waitForTimeout(200);
check(await p2.locator('#modeScreen').isVisible(), '仍然可以進入模式選擇');
const note = await p2.locator('#storageNote').innerText();
check(note.includes('不允許儲存'), '有提示無法儲存紀錄');
check(errs2.length === 0, errs2.length ? 'JS 爆掉：' + errs2.join(' | ') : '沒有 JS 例外');
await p2.close();

console.log('\n14. 每天提醒（加到手機行事曆）');
await page.click('#restartBtn').catch(()=>{});
await page.evaluate(()=> showScreen(modeScreen));
await page.waitForTimeout(150);
check(await page.locator('#remindBody').isHidden(), '一開始是收起來的，不佔版面');
await page.click('#remindToggleBtn');
await page.waitForTimeout(150);
check(await page.locator('#remindBody').isVisible(), '按下去展開時間選項');
const times = await page.locator('#remindTimeRow .pill').count();
check(times === 13, `提供 ${times} 個時間（16:00–22:00，每半小時）`);
const def = await page.evaluate(()=>({
  href: document.getElementById('remindAddBtn').getAttribute('href'),
  text: document.getElementById('remindAddBtn').textContent.trim(),
  active: document.querySelector('#remindTimeRow .pill.active').dataset.t
}));
check(def.active === '2000' && def.href === 'reminders/2000.ics' && def.text.includes('20:00'),
  `預設 20:00，連到 ${def.href}`);
await page.click('#remindTimeRow .pill[data-t="1930"]');
await page.waitForTimeout(120);
const picked = await page.evaluate(()=>({
  href: document.getElementById('remindAddBtn').getAttribute('href'),
  text: document.getElementById('remindAddBtn').textContent.trim()
}));
check(picked.href === 'reminders/1930.ics' && picked.text.includes('19:30'),
  `改選 19:30 後按鈕跟著換（${picked.text}）`);

// 真的把檔案抓下來看內容：連結壞掉或格式錯，學生按了只會得到一個打不開的檔
const ics = await page.evaluate(async ()=>{
  const res = await fetch('reminders/1930.ics', { cache:'no-store' });
  return { ok: res.ok, type: res.headers.get('content-type') || '', body: await res.text() };
});
check(ics.ok, '檔案抓得到（不是 404）');
check(/BEGIN:VCALENDAR/.test(ics.body) && /END:VCALENDAR/.test(ics.body), '是一份完整的行事曆檔');
check(/RRULE:FREQ=DAILY/.test(ics.body), '設定成每天重複');
check(/DTSTART:\d{8}T193000/.test(ics.body), '時間就是選的 19:30');
check(/BEGIN:VALARM[\s\S]*TRIGGER:PT0S[\s\S]*END:VALARM/.test(ics.body), '時間到會跳提醒（VALARM）');
check(ics.body.includes('\r\n'), '用 CRLF 換行（行事曆 App 才吃得下）');
check(!(await page.evaluate(()=> {
  const el = document.getElementById('remindToggleBtn');
  return !!el.offsetParent && store.role === 'teacher';
})), '老師端不會看到這個設定（在學生模式區塊裡）');

console.log('\n13. 練習熱力圖');
// 做完任一測驗都要在「那一天」記上一筆，而且要能撐得比 sessions（只留 60 筆）久
const heat = await page.evaluate(() => {
  const today = dayNum(new Date());
  const before = (currentProfile().days || {})[today] || 0;
  recordSession({ date: Date.now(), mode: 'practice', total: 5, correct: 4, wrong: [] });
  recordSession({ date: Date.now(), mode: 'article', total: 9, correct: 9, wrong: [] });
  saveHistory();
  return { today, before, after: currentProfile().days[today] };
});
check(heat.after === heat.before + 2, `做兩次測驗，今天的格子從 ${heat.before} 變成 ${heat.after}`);

const heatKeep = await page.evaluate(() => {
  const p = currentProfile();
  // 塞 80 筆作答紀錄：sessions 會被砍到剩 60 筆，days 不該跟著不見
  for(let i = 0; i < 80; i++) recordSession({ date: Date.now(), mode: 'practice', total: 1, correct: 1, wrong: [] });
  saveHistory();
  return { sessions: p.sessions.length, today: p.days[dayNum(new Date())] };
});
check(heatKeep.sessions === 60 && heatKeep.today >= 82,
  `sessions 上限 60 筆，但熱力圖仍記得今天的 ${heatKeep.today} 次`);

const heatCalc = await page.evaluate(() => {
  const DAYMS = 86400000;
  const days = {};
  const mk = back => { const d = new Date(Date.now() - back * DAYMS); return dayNum(d); };
  days[mk(0)] = 1; days[mk(1)] = 3; days[mk(2)] = 6; days[mk(9)] = 1;   // 連續 3 天
  const cells = heatCells(days, HEAT_WEEKS);
  const st = heatStats(cells);
  return { n: cells.length, weeks: HEAT_WEEKS, levels: [0,1,3,6].map(heatLevel), st,
           future: cells.filter(c => c.future).length };
});
check(heatCalc.n === heatCalc.weeks * 7, `畫半年份的格子（${heatCalc.n} 格＝${heatCalc.weeks} 週）`);
check(JSON.stringify(heatCalc.levels) === JSON.stringify([0,1,3,4]),
  '做越多次顏色越深（0→無色、1→淺、3→中、6→最深）');
check(heatCalc.st.total === 11 && heatCalc.st.activeDays === 4,
  `統計正確：共 ${heatCalc.st.total} 次、${heatCalc.st.activeDays} 天有練習`);
check(heatCalc.st.now === 3, `目前連續 ${heatCalc.st.now} 天`);
check(heatCalc.future > 0, '本週未來的日子留白，不會畫成「沒練習」');

// 學生一筆紀錄都沒有時，報告仍要畫出（空的）熱力圖，不然老師會以為功能不見了
const emptyHeat = await page.evaluate(() => {
  const keep = store.profiles.student;
  store.profiles.student = blankProfile();
  renderReport();
  const body = document.getElementById('reportBody');
  const out = { cells: body.querySelectorAll('.hm-cell').length,
                stats: (body.querySelector('.hm-stats') || {}).textContent || '',
                note: /還沒有留下任何紀錄/.test(body.textContent) };
  store.profiles.student = keep;
  renderReport();
  return out;
});
check(emptyHeat.cells > 180 && emptyHeat.note,
  `學生沒有紀錄時照樣畫熱力圖（${emptyHeat.cells} 格）並說明原因`);
check(/共做了0次/.test(emptyHeat.stats.replace(/\s+/g,'')),
  `空的熱力圖寫「0 次」（${emptyHeat.stats.replace(/\s+/g,' ').trim()}）`);

const heatRound = await page.evaluate(() => {
  const back = payloadToProfile(buildPayload());
  const today = dayNum(new Date());
  return { sent: store.profiles.student.days[today], got: back.days[today] };
});
check(heatRound.sent === heatRound.got && heatRound.got > 0,
  `同步／回報碼會把熱力圖帶過去（今天 ${heatRound.got} 次）`);

console.log('\n12. 每一題都要有四個選項（含只勾一個很小的單元）');
// 單元只有兩個字時，干擾選項湊不出四個 —— 曾經真的出過兩個選項的題目。
const optCheck = await page.evaluate(() => {
  const result = {};
  const run = (label, cats, rounds) => {
    let q = 0, short = 0, missing = 0;
    for (let i = 0; i < rounds; i++) {
      buildQuiz(new Set(cats), new Set(ALL_TYPES), 9999).forEach(x => {
        q++;
        if (new Set(x.options).size !== 4) short++;
        if (!x.options.includes(x.correctText)) missing++;
      });
    }
    result[label] = { q, short, missing };
  };
  const smallest = ALL_CATS.slice().sort((a, b) => WORDS[a].length - WORDS[b].length)[0];
  run('smallest', [smallest], 200);
  run('all', ALL_CATS, 100);
  result.smallestName = smallest;
  result.smallestSize = WORDS[smallest].length;
  return result;
});
check(optCheck.smallest.short === 0,
  `只勾最小的單元（${optCheck.smallestName}，${optCheck.smallestSize} 字）也有四個相異選項`
  + `（${optCheck.smallest.q} 題中不足四個：${optCheck.smallest.short}）`);
check(optCheck.smallest.missing === 0, '而且每題都含正解');
check(optCheck.all.short === 0 && optCheck.all.missing === 0,
  `全單元出題也都是四個相異選項（${optCheck.all.q} 題）`);

console.log('\n9. JS 執行期錯誤');
check(errs.length === 0, errs.length ? 'JS 錯誤：\n    ' + errs.join('\n    ') : '沒有 JS 執行期錯誤');

await browser.close();
console.log(fails ? `\n❌ ${fails} 項未通過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);

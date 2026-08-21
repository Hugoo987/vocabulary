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
check(!(await page.locator('#historyPanel').isVisible()), '老師自己的錯題紀錄是空的（面板隱藏）');

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

console.log('\n7. 老師自己做題目，不能污染學生紀錄');
await page.click('#reportBackBtn');
await page.waitForTimeout(150);
await page.click('#modePractice');
await page.waitForTimeout(150);
await page.click('#startBtn');
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
await page.click('#restartBtn');
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

console.log('\n10. 正式考試會記成 exam');
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
for (let i = 0; i < 35; i++) {
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
check(ex && ex.total === 30, `正式考試記錄 30 題（實際 ${ex && ex.total}）`);
check(ex && ex.correct === 30, `全對記成 30 分（實際 ${ex && ex.correct}）`);

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

console.log('\n9. JS 執行期錯誤');
check(errs.length === 0, errs.length ? 'JS 錯誤：\n    ' + errs.join('\n    ') : '沒有 JS 執行期錯誤');

await browser.close();
console.log(fails ? `\n❌ ${fails} 項未通過` : '\n✅ 全部通過');
process.exit(fails ? 1 : 0);

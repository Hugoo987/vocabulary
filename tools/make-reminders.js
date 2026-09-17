#!/usr/bin/env node
// 產生「每天提醒」的行事曆檔（reminders/HHMM.ics）。
//
//   node tools/make-reminders.js && node tools/validate.js
//
// 為什麼是靜態檔案而不是網頁當場產生：手機上點一個真的 .ics 連結，
// iPhone 會直接跳出「加入行事曆」，Android 會問要加到哪個行事曆。
// 用 JS 產生 Blob 再下載，在 iOS Safari 上會先掉進「檔案」App，多兩個步驟。
const fs = require('fs');
const path = require('path');

const SITE = 'https://hugoo987.github.io/vocabulary/';
// 事件用「浮動時間」（不帶時區）：學生手機是幾點就幾點，不必塞 VTIMEZONE。
// 起始日固定，檔案內容才不會每次產生都不一樣（git diff 乾淨）。
const START_DATE = '20260101';
const DURATION = 'PT15M';

// 要提供哪些時間。改這裡就好，index.html 的按鈕與驗證器都會對照這份清單。
const TIMES = [];
for (let h = 16; h <= 22; h++) {
  TIMES.push(`${String(h).padStart(2, '0')}00`);
  if (h < 22) TIMES.push(`${String(h).padStart(2, '0')}30`);
}

// RFC 5545：一行最多 75 個 octet，超過要折行，續行開頭放一個空格。
// 中文是多位元組，所以要照 byte 數算，不能用字數。
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 74) return line;
  const out = [];
  let start = 0;
  while (start < bytes.length) {
    const limit = out.length === 0 ? 74 : 73;   // 續行多一個空格
    let end = Math.min(start + limit, bytes.length);
    // 不要切在多位元組字元中間
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push((out.length ? ' ' : '') + bytes.slice(start, end).toString('utf8'));
    start = end;
  }
  return out.join('\r\n');
}

function ics(hhmm) {
  const label = hhmm.slice(0, 2) + ':' + hhmm.slice(2);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//vocab-quiz//daily-reminder//ZH-TW',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:vocab-quiz-reminder-${hhmm}@hugoo987.github.io`,
    `DTSTAMP:${START_DATE}T000000Z`,
    `DTSTART:${START_DATE}T${hhmm}00`,
    `DURATION:${DURATION}`,
    'RRULE:FREQ=DAILY',
    `SUMMARY:單字大挑戰：${label} 練習時間`,
    `DESCRIPTION:打開網頁做一輪測驗，大約 5 分鐘。\\n${SITE}`,
    `URL:${SITE}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:PT0S',
    `DESCRIPTION:單字大挑戰：${label} 練習時間`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

const dir = path.join(__dirname, '..', 'reminders');
fs.mkdirSync(dir, { recursive: true });
// 先清掉舊的，時間清單縮短時不會留下孤兒檔
fs.readdirSync(dir).filter(f => f.endsWith('.ics')).forEach(f => fs.unlinkSync(path.join(dir, f)));
TIMES.forEach(t => fs.writeFileSync(path.join(dir, t + '.ics'), ics(t), 'utf8'));
console.log(`✅ 已產生 ${TIMES.length} 個提醒檔：${TIMES[0]} … ${TIMES[TIMES.length - 1]}（reminders/）`);

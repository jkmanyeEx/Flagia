const mysql = require('mysql2/promise');

function mapPmPosToPlainIndex(text, pmPos) {
  let newlines = 0;
  for (let idx = 0; idx <= text.length; idx++) {
    const expectedPmPos = idx + 1 + newlines; // Formula 1
    if (expectedPmPos >= pmPos) {
      console.log(`idx=${idx}, newlines=${newlines}, expectedPmPos=${expectedPmPos}, pmPos=${pmPos}`);
      return idx;
    }
    if (text[idx] === '\n') {
      newlines++;
    }
  }
  return text.length;
}

async function main() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'devmeko',
    password: 'Qqqq1111!',
    database: 'flagia'
  });

  const sessId = '46e0977c-dc82-4ed3-9816-7132cbbd647e';
  const [sessRows] = await connection.execute(
    'SELECT events_blob, submission_id FROM sessions WHERE id = ?',
    [sessId]
  );
  const events = JSON.parse(sessRows[0].events_blob);

  const [subRows] = await connection.execute(
    `SELECT s.final_markdown, a.template_text FROM submissions s 
     JOIN assignments a ON s.assignment_id = a.id 
     WHERE s.id = ?`,
    [sessRows[0].submission_id]
  );
  const { final_markdown, template_text } = subRows[0];

  let committed = (template_text || '')
    .replace(/<\/p><p>/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  // Let's run the replay up to step 93
  const CHO_LIST  = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  const JUNG_LIST = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','요','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
  const JONG_LIST = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  const composeSyllable = (cho, jung, jong) => {
    const ci = CHO_LIST.indexOf(cho), ji = JUNG_LIST.indexOf(jung), gi = JONG_LIST.indexOf(jong);
    return String.fromCharCode(0xAC00 + (ci * 21 + ji) * 28 + gi);
  };
  
  let cho = '', jung = '', jong = '';
  let compStartPos = committed.length;

  for (let i = 0; i < 93; i++) {
    const e = events[i];
    if (e.type === 'keydown') {
      const key = e.meta?.key;
      if (e.meta?.mod || (key && new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape']).has(key))) continue;
      
      let pos = committed.length;
      if (e.meta && typeof e.meta.cursorPosition === 'number') {
        pos = mapPmPosToPlainIndex(committed, e.meta.cursorPosition);
      }
      
      if (key === 'Backspace') {
        // ... (simplified backspace)
        if (pos > 0) committed = committed.slice(0, pos-1) + committed.slice(pos);
      } else if (key === 'Enter') {
        committed = committed.slice(0, pos) + '\n' + committed.slice(pos);
      } else if (key && key.length === 1) {
        committed = committed.slice(0, pos) + key + committed.slice(pos);
      }
    }
  }

  console.log('committed length:', committed.length);
  console.log('committed representation:', JSON.stringify(committed));
  console.log('Now mapping pmPos = 101:');
  mapPmPosToPlainIndex(committed, 101);

  await connection.end();
}

main().catch(console.error);

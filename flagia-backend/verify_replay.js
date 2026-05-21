const mysql = require('mysql2/promise');

const CHO_LIST  = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const JUNG_LIST = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','요','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const JONG_LIST = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const COMPOUND_JUNG = { 'ㅗㅏ':'ㅘ','ㅗㅐ':'ㅙ','ㅗㅣ':'ㅚ','ㅜㅓ':'ㅝ','ㅜㅔ':'ㅞ','ㅜㅣ':'ㅟ','ㅡㅣ':'ㅢ' };
const DECOMPOSE_JUNG = { 'ㅘ':['ㅗ','ㅏ'],'ㅙ':['ㅗ','ㅐ'],'ㅚ':['ㅗ','ㅣ'],'ㅝ':['ㅜ','ㅓ'],'ㅞ':['ㅜ','ㅔ'],'ㅟ':['ㅜ','ㅣ'],'ㅢ':['ㅡ','ㅣ'] };
const COMPOUND_JONG = { 'ㄱㅅ':'ㄳ','ㄴㅈ':'ㄵ','ㄴㅎ':'ㄶ','ㄹㄱ':'ㄺ','ㄹㅁ':'ㄻ','ㄹㅂ':'ㄼ','ㄹㅅ':'ㄽ','ㄹㅌ':'ㄾ','ㄹㅍ':'ㄿ','ㄹㅎ':'ㅀ','ㅂㅅ':'ㅄ' };
const DECOMPOSE_JONG = { 'ㄳ':['ㄱ','ㅅ'],'ㄵ':['ㄴ','ㅈ'],'ㄶ':['ㄴ','ㅎ'],'ㄺ':['ㄹ','ㄱ'],'ㄻ':['ㄹ','ㅁ'],'ㄼ':['ㄹ','ㅂ'],'ㄽ':['ㄹ','ㅅ'],'ㄾ':['ㄹ','ㅌ'],'ㄿ':['ㄹ','ㅍ'],'ㅀ':['ㄹ','ㅎ'],'ㅄ':['ㅂ','ㅅ'] };
const NON_CONTENT_KEYS = new Set([
  'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete',
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
  'ContextMenu', 'Pause', 'ScrollLock', 'NumLock', 'PrintScreen',
  'Process', 'Unidentified', 'Dead',
]);

function isJamo(k) { return /^[ㄱ-ㆎ]$/.test(k); }
function isJung(k) { return JUNG_LIST.includes(k); }

function composeSyllable(cho, jung, jong) {
  const ci = CHO_LIST.indexOf(cho), ji = JUNG_LIST.indexOf(jung), gi = JONG_LIST.indexOf(jong);
  if (ci < 0 || ji < 0 || gi < 0) return (cho || '') + (jung || '') + (jong || '');
  return String.fromCharCode(0xAC00 + (ci * 21 + ji) * 28 + gi);
}

function runReplay(events, templateText, hasValidCursorData) {
  // Let's strip HTML from template
  let committed = templateText
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  let cho = '', jung = '', jong = '';
  let compStartPos = committed.length;
  
  const hasBuf = () => !!(cho || jung || jong);
  const renderBuf = () => hasBuf() ? composeSyllable(cho, jung, jong) : '';
  const flushBuf = () => {
    if (hasBuf()) {
      const bufText = renderBuf();
      committed = committed.slice(0, compStartPos) + bufText + committed.slice(compStartPos);
      compStartPos += bufText.length;
    }
    cho = ''; jung = ''; jong = '';
  };

  for (const e of events) {
    const cursorPosition = hasValidCursorData && e.meta && typeof e.meta.cursorPosition === 'number'
      ? e.meta.cursorPosition
      : undefined;

    const selectionLength = hasValidCursorData && e.meta && typeof e.meta.selectionLength === 'number'
      ? e.meta.selectionLength
      : 0;

    // Simulate the new logic: subtract 1 from cursorPosition if it's > 0
    let pos = committed.length;
    if (typeof cursorPosition === 'number') {
      pos = Math.max(0, cursorPosition - 1);
    }

    if (e.type === 'keydown') {
      const key = e.meta?.key;

      if (e.meta?.mod || (key && NON_CONTENT_KEYS.has(key))) {
        continue;
      }

      if (hasBuf() && pos !== compStartPos && pos !== compStartPos + 1) {
        flushBuf();
      }

      if (selectionLength > 0) {
        flushBuf();
        committed = committed.slice(0, pos) + committed.slice(pos + selectionLength);
      }

      if (key === 'Backspace') {
        if (selectionLength === 0) {
          if (jong) {
            const d = DECOMPOSE_JONG[jong];
            jong = d ? d[0] : '';
          } else if (jung) {
            const d = DECOMPOSE_JUNG[jung];
            jung = d ? d[0] : '';
          } else if (cho) {
            cho = '';
          } else {
            if (pos > 0) {
              committed = committed.slice(0, pos - 1) + committed.slice(pos);
            }
          }
        }
      } else if (key === 'Enter') {
        flushBuf();
        committed = committed.slice(0, pos) + '\n' + committed.slice(pos);
      } else if (key && isJamo(key)) {
        if (!hasBuf()) {
          compStartPos = pos;
        }
        if (isJung(key)) {
          if (!cho) {
            flushBuf();
            committed = committed.slice(0, compStartPos) + key + committed.slice(compStartPos);
            compStartPos += 1;
          } else if (!jung) {
            jung = key;
          } else if (!jong) {
            const cj = COMPOUND_JUNG[jung + key];
            if (cj) {
              jung = cj;
            } else {
              flushBuf();
              compStartPos = pos;
              committed = committed.slice(0, compStartPos) + key + committed.slice(compStartPos);
              compStartPos += 1;
            }
          } else {
            const dj = DECOMPOSE_JONG[jong];
            let newCho;
            if (dj) {
              jong = dj[0];
              newCho = dj[1];
            } else {
              newCho = jong;
              jong = '';
            }
            flushBuf();
            cho = newCho;
            jung = key;
          }
        } else {
          if (!cho) {
            cho = key;
          } else if (!jung) {
            flushBuf();
            cho = key;
          } else if (!jong) {
            if (JONG_LIST.includes(key)) {
              jong = key;
            } else {
              flushBuf();
              cho = key;
            }
          } else {
            const cjong = COMPOUND_JONG[jong + key];
            if (cjong) {
              jong = cjong;
            } else {
              flushBuf();
              cho = key;
            }
          }
        }
      } else if (key && key.length === 1) {
        flushBuf();
        committed = committed.slice(0, pos) + key + committed.slice(pos);
      }
    } else if (e.type === 'paste') {
      flushBuf();
      const pastedText = e.meta?.pasteContent || '';
      if (selectionLength > 0) {
        committed = committed.slice(0, pos) + committed.slice(pos + selectionLength);
      }
      committed = committed.slice(0, pos) + pastedText + committed.slice(pos);
    } else if (e.type === 'blur') {
      flushBuf();
    }
  }

  return committed.slice(0, compStartPos) + renderBuf() + committed.slice(compStartPos);
}

async function main() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'devmeko',
    password: 'Qqqq1111!',
    database: 'flagia'
  });

  const sessionIds = ['5684b3bd-1d38-4372-a4a4-f600a7191a53', '46e0977c-dc82-4ed3-9816-7132cbbd647e'];

  for (const sessId of sessionIds) {
    const [sessRows] = await connection.execute(
      'SELECT events_blob, submission_id FROM sessions WHERE id = ?',
      [sessId]
    );

    if (sessRows.length === 0) continue;

    const { events_blob, submission_id } = sessRows[0];
    const events = JSON.parse(events_blob);

    const [subRows] = await connection.execute(
      `SELECT s.final_markdown, a.template_text FROM submissions s 
       JOIN assignments a ON s.assignment_id = a.id 
       WHERE s.id = ?`,
      [submission_id]
    );

    if (subRows.length === 0) continue;

    const { final_markdown, template_text } = subRows[0];

    const hasValidCursorData = events.some(e => e.type === 'keydown' && e.meta && typeof e.meta.cursorPosition === 'number' && e.meta.cursorPosition > 0);

    const reconstructed = runReplay(events, template_text || '', hasValidCursorData);
    
    // Strip HTML from final_markdown to compare plain text
    const expectedPlain = final_markdown
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

    console.log(`\n================ SESSION ${sessId} ================`);
    console.log(`Reconstructed length: ${reconstructed.length}`);
    console.log(`Expected plain length: ${expectedPlain.length}`);
    
    if (reconstructed === expectedPlain) {
      console.log('SUCCESS: Reconstructed text matches exactly!');
    } else {
      console.log('FAILURE: Mismatch!');
      console.log('--- RECONSTRUCTED ---');
      console.log(JSON.stringify(reconstructed));
      console.log('--- EXPECTED PLAIN ---');
      console.log(JSON.stringify(expectedPlain));
      
      // Let's find the first mismatch
      let minLen = Math.min(reconstructed.length, expectedPlain.length);
      for (let i = 0; i < minLen; i++) {
        if (reconstructed[i] !== expectedPlain[i]) {
          console.log(`First mismatch at index ${i}:`);
          console.log(`Reconstructed char code: ${reconstructed.charCodeAt(i)} ('${reconstructed[i]}')`);
          console.log(`Expected char code: ${expectedPlain.charCodeAt(i)} ('${expectedPlain[i]}')`);
          console.log(`Context Reconstructed: ...${reconstructed.slice(Math.max(0, i-20), i)}[${reconstructed[i]}]${reconstructed.slice(i+1, i+20)}...`);
          console.log(`Context Expected:      ...${expectedPlain.slice(Math.max(0, i-20), i)}[${expectedPlain[i]}]${expectedPlain.slice(i+1, i+20)}...`);
          break;
        }
      }
    }
  }

  await connection.end();
}

main().catch(console.error);

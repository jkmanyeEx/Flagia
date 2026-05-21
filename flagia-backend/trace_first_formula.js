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

function mapPmPosToPlainIndex(text, pmPos) {
  let newlines = 0;
  for (let idx = 0; idx <= text.length; idx++) {
    const expectedPmPos = idx + 1 + newlines * 2;
    if (expectedPmPos >= pmPos) {
      return idx;
    }
    if (text[idx] === '\n') {
      newlines++;
    }
  }
  return text.length;
}

function runReplayTrace(events, templateText) {
  let committed = templateText
    .replace(/<\/p><p>/g, '\n')
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

  const getFullText = () => committed.slice(0, compStartPos) + renderBuf() + committed.slice(compStartPos);

  console.log(`Initial state: length = ${committed.length}, text = "${committed}"`);

  for (let i = 0; i < events.length; i++) {
    if (i >= 55) break;
    const e = events[i];
    const cursorPosition = e.meta && typeof e.meta.cursorPosition === 'number'
      ? e.meta.cursorPosition
      : undefined;

    const selectionLength = e.meta && typeof e.meta.selectionLength === 'number'
      ? e.meta.selectionLength
      : 0;

    let pos = committed.length;
    let selLen = 0;

    if (typeof cursorPosition === 'number') {
      pos = mapPmPosToPlainIndex(committed, cursorPosition);
      if (selectionLength > 0) {
        const endPos = mapPmPosToPlainIndex(committed, cursorPosition + selectionLength);
        selLen = endPos - pos;
      }
    }

    let actionStr = '';

    if (e.type === 'keydown') {
      const key = e.meta?.key;
      actionStr = `keydown key='${key}' rawPos=${cursorPosition} mappedPos=${pos} sel=${selectionLength}`;

      if (e.meta?.mod || (key && NON_CONTENT_KEYS.has(key))) {
        console.log(`Step ${i}: ${actionStr} => [SKIPPED]`);
        continue;
      }

      if (hasBuf() && pos !== compStartPos && pos !== compStartPos + 1) {
        flushBuf();
        actionStr += ` [FLUSHED on cursor jump]`;
      }

      if (selLen > 0) {
        flushBuf();
        committed = committed.slice(0, pos) + committed.slice(pos + selLen);
        actionStr += ` [DELETED selection]`;
      }

      if (key === 'Backspace') {
        if (selLen === 0) {
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
              if (committed[pos] === '\n') {
                committed = committed.slice(0, pos) + committed.slice(pos + 1);
                actionStr += ` [BACKSPACE deleted newline at ${pos}]`;
              } else {
                committed = committed.slice(0, pos - 1) + committed.slice(pos);
                actionStr += ` [BACKSPACE deleted at ${pos-1}]`;
              }
            }
          }
        }
      } else if (key === 'Enter') {
        flushBuf();
        committed = committed.slice(0, pos) + '\n' + committed.slice(pos);
        actionStr += ` [ENTER inserted at ${pos}]`;
      } else if (key && isJamo(key)) {
        if (!hasBuf()) {
          compStartPos = pos;
        }
        // Composition logic (omitted as not used in English)
      } else if (key && key.length === 1) {
        flushBuf();
        committed = committed.slice(0, pos) + key + committed.slice(pos);
        actionStr += ` [CHAR '${key}' inserted at ${pos}]`;
      }
    } else if (e.type === 'paste') {
      flushBuf();
      const pastedText = e.meta?.pasteContent || '';
      actionStr = `paste content='${pastedText}' rawPos=${cursorPosition} mappedPos=${pos}`;
      if (selLen > 0) {
        committed = committed.slice(0, pos) + committed.slice(pos + selLen);
      }
      committed = committed.slice(0, pos) + pastedText + committed.slice(pos);
    } else if (e.type === 'blur') {
      flushBuf();
      actionStr = `blur`;
    }

    if (actionStr) {
      console.log(`Step ${i}: ${actionStr} => "${getFullText()}" (len=${getFullText().length})`);
    }
  }
}

async function main() {
  const connection = await mysql.createConnection({
    host: 'localhost',
    user: 'devmeko',
    password: 'Qqqq1111!',
    database: 'flagia'
  });

  const sessId = '5684b3bd-1d38-4372-a4a4-f600a7191a53';
  const [sessRows] = await connection.execute(
    'SELECT events_blob, submission_id FROM sessions WHERE id = ?',
    [sessId]
  );

  const { events_blob, submission_id } = sessRows[0];
  const events = JSON.parse(events_blob);

  const [subRows] = await connection.execute(
    `SELECT s.final_markdown, a.template_text FROM submissions s 
     JOIN assignments a ON s.assignment_id = a.id 
     WHERE s.id = ?`,
     [submission_id]
  );
  const { final_markdown, template_text } = subRows[0];

  runReplayTrace(events, template_text || '');

  await connection.end();
}

main().catch(console.error);

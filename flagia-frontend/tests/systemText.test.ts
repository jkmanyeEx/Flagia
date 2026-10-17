import assert from 'node:assert/strict'
import { systemText } from '../src/utils/systemText.ts'
import { createDocumentFrame, applyDocumentFrame } from '../src/utils/replayFrames.ts'

assert.equal(systemText('⚠️ 검토 필요. 👁️ 화면 이탈을 확인하세요.'), '검토 필요. 화면 이탈을 확인하세요.')
assert.equal(systemText('🟢 Safe'), 'Safe')
assert.equal(systemText('👨‍🏫 Review required'), 'Review required')
assert.equal(systemText('0.5% / 70–100점'), '0.5% / 70–100점')
assert.equal(systemText(null), '')
assert.equal(systemText(undefined), '')

// Rendering product prose must not normalize the original document or replay.
const document = '학생이 쓴 글 👨‍🏫 📋 [붙여넣기: 5자]'
const report = { verdict: '⚠️ 검토 필요', document }
const displayed = { ...report, verdict: systemText(report.verdict) }
assert.equal(displayed.verdict, '검토 필요')
assert.equal(displayed.document, document)
assert.equal(report.verdict, '⚠️ 검토 필요')
const frame = createDocumentFrame('', document, document.length, 0, true)
const replay = applyDocumentFrame('', frame)
assert.equal(replay.valid, true)
assert.equal(replay.text, document)

console.log('System text presentation and user-content preservation checks passed')

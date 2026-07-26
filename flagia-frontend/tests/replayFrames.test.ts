import assert from 'node:assert/strict'
import {
  applyDocumentFrame,
  createDocumentFrame,
  replayDocumentFrames,
  type DocumentFrameMeta,
} from '../src/utils/replayFrames.ts'

interface ReplayStep {
  text: string
  cursor?: number
  selectionLength?: number
}

function roundTrip(steps: ReplayStep[]): DocumentFrameMeta[] {
  let recordedText = ''
  const frames = steps.map((step, index) => {
    const frame = createDocumentFrame(
      recordedText,
      step.text,
      step.cursor ?? step.text.length,
      step.selectionLength ?? 0,
      index === 0,
    )
    recordedText = step.text
    return frame
  })

  let replayedText = ''
  frames.forEach((frame, index) => {
    const result = applyDocumentFrame(replayedText, frame)
    assert.equal(result.valid, true, `frame ${index} should be valid`)
    assert.equal(result.text, steps[index].text, `frame ${index} text`)
    assert.equal(result.cursorPosition, steps[index].cursor ?? steps[index].text.length)
    assert.equal(result.selectionLength, steps[index].selectionLength ?? 0)
    replayedText = result.text
  })
  return frames
}

roundTrip([
  { text: 'ㅇ' },
  { text: '아' },
  { text: '안' },
  { text: '안ㄴ' },
  { text: '안녀' },
  { text: '안녕' },
  { text: '안녕ㅎ' },
  { text: '안녕하' },
  { text: '안녕합' },
  { text: '안녕합ㄴ' },
  { text: '안녕합니' },
  { text: '안녕합니다' },
])

roundTrip([
  { text: 'ㄱ' },
  { text: '고' },
  { text: '과' },
  { text: '괘' },
  { text: '괜' },
  { text: '괜ㅊ' },
  { text: '괜차' },
  { text: '괜찮' },
  { text: '괜찮습니다' },
])

roundTrip([
  { text: '한' },
  { text: '하' },
  { text: 'ㅎ' },
  { text: '' },
  { text: '글' },
])

roundTrip([
  { text: '오늘 날씨' },
  { text: '오늘 좋은 날씨', cursor: 5 },
  { text: '오늘 맑은 날씨', cursor: 5 },
  { text: '오늘 맑은 날씨', cursor: 3, selectionLength: 2 },
  { text: '오늘 좋은 날씨', cursor: 5 },
])

roundTrip([
  { text: '한글 English' },
  { text: '한글\nEnglish 😊' },
  { text: '한글\nEnglish 👩‍💻' },
  { text: '한글\n붙여넣기 👩‍💻' },
])

const recovery = createDocumentFrame('복구 기준', '복구 기준점', 6, 0, true)
const recovered = applyDocumentFrame('손상된 이전 상태', recovery)
assert.equal(recovered.valid, true)
assert.equal(recovered.text, '복구 기준점')

const malformed = applyDocumentFrame('안전', {
  ...createDocumentFrame('안전', '안전함', 3, 0),
  to: 999,
})
assert.equal(malformed.valid, false)
assert.equal(malformed.text, '안전')

const timedFrames = roundTrip([
  { text: 'ㅎ' },
  { text: '하' },
  { text: '한' },
])
const timedEvents = timedFrames.map((meta, index) => ({
  seq: index + 1,
  timestamp: 1_000 + index * 100,
  type: 'document_frame',
  meta,
}))
assert.equal(replayDocumentFrames(timedEvents, 1_000)?.text, 'ㅎ')
assert.equal(replayDocumentFrames(timedEvents, 1_100)?.text, '하')
assert.equal(replayDocumentFrames(timedEvents, 1_200)?.text, '한')

const recoveredTimeline = replayDocumentFrames([
  {
    seq: 1,
    timestamp: 1_000,
    type: 'document_frame',
    meta: createDocumentFrame('', '안', 1, 0, true),
  },
  {
    seq: 2,
    timestamp: 1_100,
    type: 'snapshot',
    meta: { text: '안녕' },
  },
  {
    seq: 3,
    timestamp: 1_200,
    type: 'document_frame',
    meta: createDocumentFrame('안녕', '안녕하세요', 5, 0),
  },
], 1_200)
assert.equal(recoveredTimeline?.valid, true)
assert.equal(recoveredTimeline?.text, '안녕하세요')

assert.equal(replayDocumentFrames([
  { timestamp: 1_000, type: 'snapshot', meta: { text: 'legacy' } },
], 1_000), null)

console.log('Korean/IME replay frame tests passed')

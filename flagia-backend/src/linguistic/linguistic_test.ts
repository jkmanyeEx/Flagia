import assert from 'node:assert/strict';
import { runFlagiaAnalysis } from '../engine/flagiaEngine';
import { applyLinguisticResult, studentAnalysis, sourceFingerprint } from './pipeline';
import { deductionFor, type WorkerResult } from './types';
import { earlyScopeReason, revisionStates, submissionPlainText } from './text';

const evaluated = (a: number, b: number): WorkerResult => ({
  status: 'evaluated', modelVersion: 'test', validation: 'provisional', featureScore: a, contextScore: b,
  thresholds: { aReview: .7, aStrong: .9, bReview: .7 },
});
for (const [a, b, deduction] of [[.7, 1, 0], [.8, .7, 15], [.8, .8, 35], [.9, .8, 35], [.91, .8, 65], [1, 0, 15]]) {
  assert.equal(deductionFor(evaluated(a, b)).deduction, deduction);
}
for (const invalid of [NaN, Infinity, -1, 1.1]) assert.throws(() => deductionFor(evaluated(invalid, .8)));
assert.throws(() => deductionFor({ ...evaluated(.8, .8), thresholds: { aReview: .9, aStrong: .7, bReview: .7 } }));
assert.equal(deductionFor({ status: 'unevaluated', reason: 'timeout', modelVersion: 'test' }).deduction, 0);

function baseline(score: number) {
  return { ...runFlagiaAnalysis([], '', '', 'STANDARD'),
    flagiaScore: score, baseScore: 100, scoreAdjustments: [{ label: 'existing', points: score - 100 }] };
}
for (const [a, b, expected, flag] of [[.1, .8, 90, 'GREEN'], [.8, .1, 75, 'GREEN'], [.8, .8, 55, 'AMBER'], [1, 1, 25, 'RED']] as const) {
  const result = applyLinguisticResult(baseline(90), evaluated(a, b), 'STANDARD');
  assert.equal(result.flagiaScore, expected); assert.equal(result.flagStatus, flag);
  assert.equal(result.baseScore! + result.scoreAdjustments!.reduce((n, v) => n + v.points, 0), expected);
  assert.throws(() => applyLinguisticResult(result, evaluated(a, b), 'STANDARD'), /already_applied/);
  const student = JSON.stringify(studentAnalysis(result));
  for (const secret of ['featureScore', 'contextScore', 'thresholds', 'deduction', 'revisions', 'evidence']) {
    assert.ok(!student.includes(`"${secret}"`), `student must not receive ${secret}`);
  }
}
const floor = applyLinguisticResult(baseline(10), evaluated(1, 1), 'STANDARD');
assert.equal(floor.flagiaScore, 0); assert.equal(floor.linguistic!.deduction, 65);
assert.equal(floor.linguistic!.appliedDeduction, 10);
const failure = applyLinguisticResult(baseline(90), { status: 'unevaluated', reason: 'timeout', modelVersion: 'test' }, 'STANDARD');
assert.equal(failure.flagiaScore, 90); assert.equal(failure.linguistic!.status, 'unevaluated');
assert.equal(applyLinguisticResult(baseline(95), evaluated(1, 1), 'CREATIVE').flagStatus, 'AMBER');

assert.equal(submissionPlainText('<p>한글 &amp; &#x1F600;</p>'), '한글 & 😀');
assert.equal(earlyScopeReason('한국어', 'STANDARD'), 'too_short');
assert.equal(earlyScopeReason('english '.repeat(100), 'STANDARD'), 'unsupported_language');
assert.equal(earlyScopeReason('한국어 문장입니다. '.repeat(40), 'CREATIVE'), 'unsupported_genre');
assert.notEqual(sourceFingerprint({ markdown: 'a', template: '', mode: 'STANDARD' }),
  sourceFingerprint({ markdown: 'b', template: '', mode: 'STANDARD' }));

function frame(timestamp: number, meta: any) { return { type: 'document_frame', timestamp, meta: { v: 3, ...meta } }; }
const states = revisionStates([
  frame(1000, { baseText: '가😀나', from: 1, to: 3, insertedText: '우리', textLength: 4 }),
  frame(4000, { from: 1, to: 3, insertedText: '나라', textLength: 4 }),
]);
assert.deepEqual(states.map(s => s.text), ['가우리나', '가나라나']);
assert.deepEqual(revisionStates([frame(1000, { baseText: '가😀나', from: 2, to: 3, insertedText: '', textLength: 3 })]), []);
assert.deepEqual(revisionStates([frame(1000, { from: 0, to: 0, insertedText: '글', textLength: 1 })]), []);
const sampled = revisionStates(Array.from({ length: 750 }, (_, i) => ({ type: 'snapshot', timestamp: 1000 + i * 2000, meta: { text: '문장' } })));
assert.equal(sampled.length, 96);
for (let i = 0; i < sampled.length; i += 2) {
  assert.equal(sampled[i].segment, sampled[i + 1].segment);
  assert.equal(sampled[i + 1].timestamp - sampled[i].timestamp, 2000);
}
console.log('Linguistic score, scope, privacy and UTF-16 history tests passed.');

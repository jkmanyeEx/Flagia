"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const flagiaEngine_1 = require("../engine/flagiaEngine");
const pipeline_1 = require("./pipeline");
const types_1 = require("./types");
const text_1 = require("./text");
const evaluated = (a, b) => ({
    status: 'evaluated', modelVersion: 'test', validation: 'provisional', featureScore: a, contextScore: b,
    thresholds: { aReview: .7, aStrong: .9, bReview: .7 },
});
for (const [a, b, deduction] of [[.7, 1, 0], [.8, .7, 15], [.8, .8, 35], [.9, .8, 35], [.91, .8, 65], [1, 0, 15]]) {
    strict_1.default.equal((0, types_1.deductionFor)(evaluated(a, b)).deduction, deduction);
}
for (const invalid of [NaN, Infinity, -1, 1.1])
    strict_1.default.throws(() => (0, types_1.deductionFor)(evaluated(invalid, .8)));
strict_1.default.throws(() => (0, types_1.deductionFor)({ ...evaluated(.8, .8), thresholds: { aReview: .9, aStrong: .7, bReview: .7 } }));
strict_1.default.equal((0, types_1.deductionFor)({ status: 'unevaluated', reason: 'timeout', modelVersion: 'test' }).deduction, 0);
function baseline(score) {
    return { ...(0, flagiaEngine_1.runFlagiaAnalysis)([], '', '', 'STANDARD'),
        flagiaScore: score, baseScore: 100, scoreAdjustments: [{ label: 'existing', points: score - 100 }] };
}
for (const [a, b, expected, flag] of [[.1, .8, 90, 'GREEN'], [.8, .1, 75, 'GREEN'], [.8, .8, 55, 'AMBER'], [1, 1, 25, 'RED']]) {
    const result = (0, pipeline_1.applyLinguisticResult)(baseline(90), evaluated(a, b), 'STANDARD');
    strict_1.default.equal(result.flagiaScore, expected);
    strict_1.default.equal(result.flagStatus, flag);
    strict_1.default.equal(result.baseScore + result.scoreAdjustments.reduce((n, v) => n + v.points, 0), expected);
    strict_1.default.throws(() => (0, pipeline_1.applyLinguisticResult)(result, evaluated(a, b), 'STANDARD'), /already_applied/);
    const student = JSON.stringify((0, pipeline_1.studentAnalysis)(result));
    for (const secret of ['featureScore', 'contextScore', 'thresholds', 'deduction', 'revisions', 'evidence']) {
        strict_1.default.ok(!student.includes(`"${secret}"`), `student must not receive ${secret}`);
    }
}
const floor = (0, pipeline_1.applyLinguisticResult)(baseline(10), evaluated(1, 1), 'STANDARD');
strict_1.default.equal(floor.flagiaScore, 0);
strict_1.default.equal(floor.linguistic.deduction, 65);
strict_1.default.equal(floor.linguistic.appliedDeduction, 10);
const failure = (0, pipeline_1.applyLinguisticResult)(baseline(90), { status: 'unevaluated', reason: 'timeout', modelVersion: 'test' }, 'STANDARD');
strict_1.default.equal(failure.flagiaScore, 90);
strict_1.default.equal(failure.linguistic.status, 'unevaluated');
strict_1.default.equal((0, pipeline_1.applyLinguisticResult)(baseline(95), evaluated(1, 1), 'CREATIVE').flagStatus, 'AMBER');
strict_1.default.equal((0, text_1.submissionPlainText)('<p>한글 &amp; &#x1F600;</p>'), '한글 & 😀');
strict_1.default.equal((0, text_1.earlyScopeReason)('한국어', 'STANDARD'), 'too_short');
strict_1.default.equal((0, text_1.earlyScopeReason)('english '.repeat(100), 'STANDARD'), 'unsupported_language');
strict_1.default.equal((0, text_1.earlyScopeReason)('한국어 문장입니다. '.repeat(40), 'CREATIVE'), 'unsupported_genre');
strict_1.default.notEqual((0, pipeline_1.sourceFingerprint)({ markdown: 'a', template: '', mode: 'STANDARD' }), (0, pipeline_1.sourceFingerprint)({ markdown: 'b', template: '', mode: 'STANDARD' }));
function frame(timestamp, meta) { return { type: 'document_frame', timestamp, meta: { v: 3, ...meta } }; }
const states = (0, text_1.revisionStates)([
    frame(1000, { baseText: '가😀나', from: 1, to: 3, insertedText: '우리', textLength: 4 }),
    frame(4000, { from: 1, to: 3, insertedText: '나라', textLength: 4 }),
]);
strict_1.default.deepEqual(states.map(s => s.text), ['가우리나', '가나라나']);
strict_1.default.deepEqual((0, text_1.revisionStates)([frame(1000, { baseText: '가😀나', from: 2, to: 3, insertedText: '', textLength: 3 })]), []);
strict_1.default.deepEqual((0, text_1.revisionStates)([frame(1000, { from: 0, to: 0, insertedText: '글', textLength: 1 })]), []);
const sampled = (0, text_1.revisionStates)(Array.from({ length: 750 }, (_, i) => ({ type: 'snapshot', timestamp: 1000 + i * 2000, meta: { text: '문장' } })));
strict_1.default.equal(sampled.length, 96);
for (let i = 0; i < sampled.length; i += 2) {
    strict_1.default.equal(sampled[i].segment, sampled[i + 1].segment);
    strict_1.default.equal(sampled[i + 1].timestamp - sampled[i].timestamp, 2000);
}
console.log('Linguistic score, scope, privacy and UTF-16 history tests passed.');
//# sourceMappingURL=linguistic_test.js.map
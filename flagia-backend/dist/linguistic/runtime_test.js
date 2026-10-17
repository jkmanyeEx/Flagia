"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const pipeline_1 = require("./pipeline");
const runtime_1 = require("./runtime");
const runtime_2 = require("./runtime");
async function main() {
    strict_1.default.notEqual((0, runtime_1.linguisticModelVersion)(), 'unavailable', 'train/install a local model before this integration test');
    const text = '학교에서 휴대전화를 사용하는 문제는 단순히 금지와 허용으로 나눌 수 없다. 학생은 필요한 자료를 찾아 학습에 활용할 수 있지만 수업에 집중하지 못하는 상황도 생긴다. 따라서 학교는 학생과 교사가 함께 사용할 시간과 장소를 정해야 한다. 모든 학생에게 같은 규칙을 적용하되 학습에 필요한 예외는 충분히 설명할 필요가 있다. 이러한 규칙은 실제 경험을 바탕으로 정기적으로 다시 검토해야 한다.';
    const events = Array.from({ length: 1500 }, (_, i) => ({
        seq: i, type: 'keydown', timestamp: 1000 + i * 180 + (i % 7) * 20, iki: 140 + (i % 7) * 20,
        meta: { key: 'Process' }, currentHash: '',
    }));
    const input = { events, markdown: text, template: '', mode: 'STANDARD', sessionCount: 1 };
    strict_1.default.equal((0, pipeline_1.initialAnalysis)(input).linguistic.status, 'pending');
    const stages = [];
    const started = Date.now();
    try {
        const result = await (0, pipeline_1.completeAnalysis)(input, stage => stages.push(stage));
        strict_1.default.equal(result.linguistic.status, 'evaluated');
        strict_1.default.equal(result.linguistic.modelVersion, (0, runtime_1.linguisticModelVersion)());
        strict_1.default.deepEqual(stages.slice(-3), ['features', 'context', 'revisions']);
        strict_1.default.ok(Number.isFinite(result.linguistic.featureScore));
        strict_1.default.ok(Number.isFinite(result.linguistic.contextScore));
        strict_1.default.equal(result.flagiaScore, Math.max(0, result.linguistic.previousScore - result.linguistic.deduction));
        const coldMs = Date.now() - started;
        const warmStarted = Date.now();
        const warm = await (0, pipeline_1.completeAnalysis)(input, () => { });
        strict_1.default.equal(warm.flagiaScore, result.flagiaScore, 'repeat inference must not double-apply deductions');
        console.log(JSON.stringify({ status: 'passed', model: (0, runtime_1.linguisticModelVersion)(), coldMs,
            warmMs: Date.now() - warmStarted, finalScore: result.flagiaScore, stages }));
    }
    finally {
        runtime_1.linguisticRuntime.close();
    }
    // Cancellation resolves every queued promise instead of hanging the server.
    const cancelled = new runtime_2.LinguisticRuntime();
    const work = Array.from({ length: 66 }, () => cancelled.run({ text, mode: 'STANDARD', states: [] }));
    cancelled.close();
    const cancelledResults = await Promise.all(work);
    for (const r of cancelledResults)
        strict_1.default.equal(r.status, 'unevaluated');
    strict_1.default.equal(cancelledResults.filter(r => r.reason === 'busy').length, 2, 'queue overflow must be explicit and bounded');
}
main().catch(error => { runtime_1.linguisticRuntime.close(); console.error(error); process.exitCode = 1; });
//# sourceMappingURL=runtime_test.js.map
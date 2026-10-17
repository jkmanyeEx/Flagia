import assert from 'node:assert/strict';
import { initialAnalysis, completeAnalysis, type AnalysisInput } from './pipeline';
import { linguisticModelVersion, linguisticRuntime } from './runtime';
import { LinguisticRuntime } from './runtime';

async function main() {
  assert.notEqual(linguisticModelVersion(), 'unavailable', 'train/install a local model before this integration test');
  const text = '학교에서 휴대전화를 사용하는 문제는 단순히 금지와 허용으로 나눌 수 없다. 학생은 필요한 자료를 찾아 학습에 활용할 수 있지만 수업에 집중하지 못하는 상황도 생긴다. 따라서 학교는 학생과 교사가 함께 사용할 시간과 장소를 정해야 한다. 모든 학생에게 같은 규칙을 적용하되 학습에 필요한 예외는 충분히 설명할 필요가 있다. 이러한 규칙은 실제 경험을 바탕으로 정기적으로 다시 검토해야 한다.';
  const events: any[] = Array.from({ length: 1500 }, (_, i) => ({
    seq: i, type: 'keydown', timestamp: 1000 + i * 180 + (i % 7) * 20, iki: 140 + (i % 7) * 20,
    meta: { key: 'Process' }, currentHash: '',
  }));
  const input: AnalysisInput = { events, markdown: text, template: '', mode: 'STANDARD', sessionCount: 1 };
  assert.equal(initialAnalysis(input).linguistic!.status, 'pending');
  const stages: string[] = [];
  const started = Date.now();
  try {
    const result = await completeAnalysis(input, stage => stages.push(stage));
    assert.equal(result.linguistic!.status, 'evaluated');
    assert.equal(result.linguistic!.modelVersion, linguisticModelVersion());
    assert.deepEqual(stages.slice(-3), ['features', 'context', 'revisions']);
    assert.ok(Number.isFinite(result.linguistic!.featureScore));
    assert.ok(Number.isFinite(result.linguistic!.contextScore));
    assert.equal(result.flagiaScore, Math.max(0, result.linguistic!.previousScore - result.linguistic!.deduction));
    const coldMs = Date.now() - started;
    const warmStarted = Date.now();
    const warm = await completeAnalysis(input, () => {});
    assert.equal(warm.flagiaScore, result.flagiaScore, 'repeat inference must not double-apply deductions');
    console.log(JSON.stringify({ status: 'passed', model: linguisticModelVersion(), coldMs,
      warmMs: Date.now() - warmStarted, finalScore: result.flagiaScore, stages }));
  } finally { linguisticRuntime.close(); }

  // Cancellation resolves every queued promise instead of hanging the server.
  const cancelled = new LinguisticRuntime();
  const work = Array.from({ length: 66 }, () => cancelled.run({ text, mode: 'STANDARD', states: [] }));
  cancelled.close();
  const cancelledResults = await Promise.all(work);
  for (const r of cancelledResults) assert.equal(r.status, 'unevaluated');
  assert.equal(cancelledResults.filter(r => r.reason === 'busy').length, 2, 'queue overflow must be explicit and bounded');
}
main().catch(error => { linguisticRuntime.close(); console.error(error); process.exitCode = 1; });

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sourceFingerprint = sourceFingerprint;
exports.isCurrentAnalysis = isCurrentAnalysis;
exports.initialAnalysis = initialAnalysis;
exports.applyLinguisticResult = applyLinguisticResult;
exports.completeAnalysis = completeAnalysis;
exports.studentAnalysis = studentAnalysis;
const node_crypto_1 = require("node:crypto");
const flagiaEngine_1 = require("../engine/flagiaEngine");
const runtime_1 = require("./runtime");
const text_1 = require("./text");
const types_1 = require("./types");
function sourceFingerprint(input) {
    return (0, node_crypto_1.createHash)('sha256').update(JSON.stringify([
        input.markdown, input.template, input.mode, input.submittedAt,
    ])).digest('hex');
}
function isCurrentAnalysis(result, input) {
    return result.version === flagiaEngine_1.ANALYSIS_VERSION && result.sourceFingerprint === sourceFingerprint(input)
        && result.linguistic?.policyVersion === types_1.POLICY_VERSION
        && result.linguistic.modelVersion === (0, runtime_1.linguisticModelVersion)();
}
function initialAnalysis(input) {
    const analysis = (0, flagiaEngine_1.runFlagiaAnalysis)(input.events, input.markdown, input.template, input.mode, input.submittedAt);
    analysis.sessionSummary.sessionCount = input.sessionCount;
    analysis.sourceFingerprint = sourceFingerprint(input);
    const text = (0, text_1.submissionPlainText)(input.markdown);
    const reason = (0, text_1.earlyScopeReason)(text, input.mode, input.markdown)
        || ((0, runtime_1.linguisticModelVersion)() === 'unavailable' ? 'model_unavailable' : undefined);
    analysis.linguistic = {
        status: reason ? 'unevaluated' : 'pending', stage: reason ? undefined : 'queued', reason,
        modelVersion: (0, runtime_1.linguisticModelVersion)(), policyVersion: types_1.POLICY_VERSION,
        previousScore: analysis.flagiaScore, deduction: 0, appliedDeduction: 0,
    };
    return analysis;
}
function applyLinguisticResult(analysis, result, mode) {
    // Call only on a fresh legacy result; never subtract from a cached deduction.
    if (analysis.linguistic?.status === 'evaluated')
        throw new Error('linguistic_already_applied');
    const { deduction, level } = (0, types_1.deductionFor)(result);
    const previousScore = analysis.flagiaScore;
    const final = Math.round(Math.max(0, previousScore - deduction) * 100) / 100;
    const appliedDeduction = Math.round((previousScore - final) * 100) / 100;
    const flagStatus = (0, flagiaEngine_1.flagStatusForScore)(final, mode);
    const next = { ...analysis, flagiaScore: final, flagStatus };
    next.scoreAdjustments = [...(analysis.scoreAdjustments || [])];
    if (appliedDeduction)
        next.scoreAdjustments.push({ code: 'linguistic', label: '언어 분석 감점', points: -appliedDeduction });
    next.linguistic = { ...result, policyVersion: types_1.POLICY_VERSION, level, deduction, appliedDeduction, previousScore };
    if (deduction) {
        next.verdict = '언어 패턴 추가 검토 필요';
        next.verdictDetail = `언어 분석 정책에 따라 ${appliedDeduction}점이 차감되었습니다. AI 사용 확정 판정은 아닙니다. ` + analysis.verdictDetail;
    }
    return next;
}
async function completeAnalysis(input, onStage) {
    const initial = initialAnalysis(input);
    if (initial.linguistic?.status !== 'pending')
        return initial;
    let result;
    try {
        result = await runtime_1.linguisticRuntime.run({
            text: (0, text_1.submissionPlainText)(input.markdown), mode: input.mode, states: (0, text_1.revisionStates)(input.events),
        }, onStage);
        (0, types_1.deductionFor)(result);
    }
    catch {
        result = { status: 'unevaluated', reason: 'inference_failed', modelVersion: (0, runtime_1.linguisticModelVersion)() };
    }
    const baseline = (0, flagiaEngine_1.runFlagiaAnalysis)(input.events, input.markdown, input.template, input.mode, input.submittedAt, result.revisions);
    baseline.sessionSummary.sessionCount = input.sessionCount;
    baseline.sourceFingerprint = sourceFingerprint(input);
    return applyLinguisticResult(baseline, result, input.mode);
}
function studentAnalysis(analysis) {
    if (!analysis)
        return null;
    return {
        version: analysis.version, flagiaScore: analysis.flagiaScore, flagStatus: analysis.flagStatus,
        sessionSummary: analysis.sessionSummary,
        linguistic: analysis.linguistic ? { status: analysis.linguistic.status, stage: analysis.linguistic.stage } : undefined,
    };
}
//# sourceMappingURL=pipeline.js.map
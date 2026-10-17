"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POLICY_VERSION = void 0;
exports.deductionFor = deductionFor;
exports.POLICY_VERSION = 'ko-deduction-v1';
function deductionFor(result) {
    if (result.status === 'unevaluated')
        return { deduction: 0, level: undefined };
    if (result.status !== 'evaluated')
        throw new Error('invalid_linguistic_status');
    const { featureScore: a, contextScore: b, thresholds: t } = result;
    const values = [a, b, t?.aReview, t?.aStrong, t?.bReview];
    if (!values.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)
        || !t || t.aStrong < t.aReview)
        throw new Error('invalid_linguistic_result');
    if (a <= t.aReview)
        return { deduction: 0, level: 'none' };
    if (b <= t.bReview)
        return { deduction: 15, level: 'review' };
    if (a > t.aStrong)
        return { deduction: 65, level: 'strong' };
    return { deduction: 35, level: 'corroborated' };
}
//# sourceMappingURL=types.js.map
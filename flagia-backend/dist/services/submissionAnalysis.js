"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.activeAnalysisStage = activeAnalysisStage;
exports.saveSubmissionAnalysis = saveSubmissionAnalysis;
exports.scheduleSubmissionAnalysis = scheduleSubmissionAnalysis;
const database_1 = __importDefault(require("../database"));
const pipeline_1 = require("../linguistic/pipeline");
const jobs = new Map();
function activeAnalysisStage(id) { return jobs.get(id)?.stage; }
async function saveSubmissionAnalysis(id, result, markdown, requireCurrentSource = false) {
    // Keep list/dashboard columns consistent with the detailed result. Never
    // overwrite a newer draft if the submission is still being edited.
    await database_1.default.query(`UPDATE submissions SET flagia_score = ?, flag_status = ?, coefficient_of_variation = ?,
      revision_ratio = ?, total_paste_count = ?, total_blur_duration = ?, analysis_json = ?
     WHERE id = ? AND final_markdown <=> ? AND status IN ('SUBMITTED', 'FORCE_CLOSED')
       ${requireCurrentSource ? `AND JSON_UNQUOTE(JSON_EXTRACT(analysis_json, '$.sourceFingerprint')) = ?
         AND JSON_UNQUOTE(JSON_EXTRACT(analysis_json, '$.linguistic.modelVersion')) = ?
         AND JSON_UNQUOTE(JSON_EXTRACT(analysis_json, '$.linguistic.policyVersion')) = ?` : ''}`, [result.flagiaScore, result.flagStatus, result.coefficientOfVariation, result.revisionRatio,
        result.totalPasteCount, result.totalBlurDuration, JSON.stringify(result), id, markdown,
        ...(requireCurrentSource ? [result.sourceFingerprint, result.linguistic?.modelVersion, result.linguistic?.policyVersion] : [])]);
}
function scheduleSubmissionAnalysis(id, input) {
    if (jobs.has(id))
        return;
    const entry = { stage: 'queued', promise: Promise.resolve() };
    jobs.set(id, entry);
    entry.promise = new Promise(resolve => setImmediate(resolve)).then(async () => {
        try {
            const result = await (0, pipeline_1.completeAnalysis)(input, stage => { entry.stage = stage; });
            await saveSubmissionAnalysis(id, result, input.markdown, true);
            if (input.assignmentId && input.studentId) {
                // Lazy import avoids the websocket -> finalizer -> analysis module cycle.
                try {
                    const { notifySubmissionsUpdate } = await Promise.resolve().then(() => __importStar(require('../websocket')));
                    notifySubmissionsUpdate(input.assignmentId, input.studentId);
                }
                catch { /* Saved results are still available through polling. */ }
            }
        }
        catch {
            // Inference failure never cancels submission or invents a zero model score.
            const fallback = (0, pipeline_1.initialAnalysis)(input);
            fallback.linguistic = { ...fallback.linguistic, status: 'unevaluated', stage: undefined, reason: 'inference_failed' };
            try {
                await saveSubmissionAnalysis(id, fallback, input.markdown, true);
            }
            catch {
                console.error('Unable to persist submission analysis');
            }
        }
        finally {
            jobs.delete(id);
        }
    });
}
//# sourceMappingURL=submissionAnalysis.js.map
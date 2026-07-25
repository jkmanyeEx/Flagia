"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.finalizeSubmission = finalizeSubmission;
const database_1 = __importDefault(require("../database"));
const flagiaEngine_1 = require("../engine/flagiaEngine");
function errorMessage(error) {
    return error instanceof Error ? error.message : '알 수 없는 분석 오류';
}
/**
 * Atomically claims an IN_PROGRESS submission, then runs the shared Flagia
 * analysis pipeline. The status predicate makes this safe when a student's
 * direct submission and an assignment fallback race each other.
 */
async function finalizeSubmission(options) {
    const markdown = options.finalMarkdown === undefined ? null : options.finalMarkdown;
    const [updateResult] = await database_1.default.query(`UPDATE submissions
     SET final_markdown = COALESCE(?, final_markdown, ''),
         status = ?,
         submitted_at = NOW()
     WHERE id = ? AND status = 'IN_PROGRESS'`, [markdown, options.status, options.submissionId]);
    const [rows] = await database_1.default.query(`SELECT s.*, a.template_text, a.mode, a.text_limit
     FROM submissions s
     JOIN assignments a ON s.assignment_id = a.id
     WHERE s.id = ?`, [options.submissionId]);
    const submission = rows[0];
    if (!submission) {
        return { outcome: 'not_found', analysis: null };
    }
    if (updateResult.affectedRows === 0) {
        return { outcome: 'already_finalized', submission, analysis: null };
    }
    const [sessionRows] = await database_1.default.query('SELECT events_blob FROM sessions WHERE submission_id = ? ORDER BY start_time ASC', [options.submissionId]);
    const allEvents = [];
    for (const session of sessionRows) {
        if (!session.events_blob)
            continue;
        try {
            const parsed = JSON.parse(session.events_blob);
            if (Array.isArray(parsed))
                allEvents.push(...parsed);
        }
        catch {
            // A malformed session must not prevent the remaining valid sessions from
            // being analysed or the submission from being finalized.
        }
    }
    try {
        const analysis = (0, flagiaEngine_1.runFlagiaAnalysis)(allEvents, submission.final_markdown || '', submission.template_text || '', submission.mode, submission.submitted_at);
        await database_1.default.query(`UPDATE submissions SET
        flagia_score = ?, flag_status = ?,
        coefficient_of_variation = ?, revision_ratio = ?,
        total_paste_count = ?, total_blur_duration = ?,
        analysis_json = ?
       WHERE id = ? AND status = ?`, [
            analysis.flagiaScore,
            analysis.flagStatus,
            analysis.coefficientOfVariation,
            analysis.revisionRatio,
            analysis.totalPasteCount,
            analysis.totalBlurDuration,
            JSON.stringify(analysis),
            options.submissionId,
            options.status,
        ]);
        return { outcome: 'finalized', submission, analysis };
    }
    catch (error) {
        console.error('Flagia Analysis Engine Error:', error);
        return {
            outcome: 'finalized',
            submission,
            analysis: null,
            analysisError: errorMessage(error),
        };
    }
}
//# sourceMappingURL=submissionFinalizer.js.map
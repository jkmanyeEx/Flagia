"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.finalizeSubmission = finalizeSubmission;
const database_1 = __importDefault(require("../database"));
const pipeline_1 = require("../linguistic/pipeline");
const submissionAnalysis_1 = require("./submissionAnalysis");
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
        const input = {
            events: allEvents, markdown: submission.final_markdown || '',
            template: submission.template_text || '', mode: submission.mode,
            submittedAt: submission.submitted_at, sessionCount: sessionRows.length,
            assignmentId: submission.assignment_id, studentId: submission.student_id,
        };
        const analysis = (0, pipeline_1.initialAnalysis)(input);
        await (0, submissionAnalysis_1.saveSubmissionAnalysis)(options.submissionId, analysis, input.markdown);
        if (analysis.linguistic?.status === 'pending')
            (0, submissionAnalysis_1.scheduleSubmissionAnalysis)(options.submissionId, input);
        return { outcome: 'finalized', submission, analysis };
    }
    catch {
        console.error('Flagia submission analysis could not be saved');
        return {
            outcome: 'finalized',
            submission,
            analysis: null,
            analysisError: '분석 결과를 저장할 수 없습니다. 제출은 완료되었습니다.',
        };
    }
}
//# sourceMappingURL=submissionFinalizer.js.map
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Regrade all submitted submissions with the updated Flagia engine.
 * Usage: node dist/regrade.js
 */
const database_1 = __importDefault(require("./database"));
const pipeline_1 = require("./linguistic/pipeline");
const runtime_1 = require("./linguistic/runtime");
const submissionAnalysis_1 = require("./services/submissionAnalysis");
async function regrade() {
    console.log('🔄 Fetching submitted submissions...');
    const [rows] = await database_1.default.query(`SELECT s.id, s.final_markdown, s.status, s.submitted_at, a.template_text, a.mode, a.text_limit
     FROM submissions s
     JOIN assignments a ON s.assignment_id = a.id
     WHERE s.status IN ('SUBMITTED', 'FORCE_CLOSED')`);
    const submissions = rows;
    console.log(`📋 Found ${submissions.length} submissions to regrade.\n`);
    let success = 0;
    let failed = 0;
    for (const sub of submissions) {
        try {
            // Gather all session events
            const [sessionRows] = await database_1.default.query('SELECT events_blob FROM sessions WHERE submission_id = ? ORDER BY start_time ASC', [sub.id]);
            const allEvents = [];
            for (const session of sessionRows) {
                if (session.events_blob) {
                    try {
                        const parsed = JSON.parse(session.events_blob);
                        if (Array.isArray(parsed))
                            allEvents.push(...parsed);
                    }
                    catch { /* skip malformed */ }
                }
            }
            // Run updated analysis
            const analysis = await (0, pipeline_1.completeAnalysis)({
                events: allEvents, markdown: sub.final_markdown || '', template: sub.template_text || '',
                mode: sub.mode, submittedAt: sub.submitted_at, sessionCount: sessionRows.length,
            }, () => { });
            if (analysis.linguistic?.status === 'unevaluated' &&
                ['model_unavailable', 'inference_failed', 'timeout', 'busy', 'worker_exited', 'model_changed', 'invalid_worker_result'].includes(analysis.linguistic.reason || '')) {
                throw new Error('language_analysis_failed');
            }
            await (0, submissionAnalysis_1.saveSubmissionAnalysis)(sub.id, analysis, sub.final_markdown || '');
            success++;
            console.log(`  Regraded ${success + failed}/${submissions.length}`);
        }
        catch {
            console.error('Analysis failed; previous result preserved');
            failed++;
        }
    }
    console.log(`\n🏁 Done. ${success} regraded, ${failed} failed.`);
    if (failed)
        process.exitCode = 1;
}
regrade().catch(() => {
    console.error('Regrading could not be completed');
    process.exitCode = 1;
}).finally(async () => {
    runtime_1.linguisticRuntime.close();
    await database_1.default.end();
});
//# sourceMappingURL=regrade.js.map
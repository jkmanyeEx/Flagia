/**
 * Regrade all submitted submissions with the updated Flagia engine.
 * Usage: node dist/regrade.js
 */
import pool from './database';
import { completeAnalysis } from './linguistic/pipeline';
import { linguisticRuntime } from './linguistic/runtime';
import { saveSubmissionAnalysis } from './services/submissionAnalysis';

async function regrade() {
  console.log('🔄 Fetching submitted submissions...');

  const [rows] = await pool.query(
    `SELECT s.id, s.final_markdown, s.status, s.submitted_at, a.template_text, a.mode, a.text_limit
     FROM submissions s
     JOIN assignments a ON s.assignment_id = a.id
     WHERE s.status IN ('SUBMITTED', 'FORCE_CLOSED')`
  );

  const submissions = rows as any[];
  console.log(`📋 Found ${submissions.length} submissions to regrade.\n`);

  let success = 0;
  let failed = 0;

  for (const sub of submissions) {
    try {
      // Gather all session events
      const [sessionRows] = await pool.query(
        'SELECT events_blob FROM sessions WHERE submission_id = ? ORDER BY start_time ASC',
        [sub.id]
      );
      const allEvents: any[] = [];
      for (const session of sessionRows as any[]) {
        if (session.events_blob) {
          try {
            const parsed = JSON.parse(session.events_blob);
            if (Array.isArray(parsed)) allEvents.push(...parsed);
          } catch { /* skip malformed */ }
        }
      }

      // Run updated analysis
      const analysis = await completeAnalysis({
        events: allEvents, markdown: sub.final_markdown || '', template: sub.template_text || '',
        mode: sub.mode, submittedAt: sub.submitted_at, sessionCount: (sessionRows as any[]).length,
      }, () => {});
      if (analysis.linguistic?.status === 'unevaluated' &&
          ['model_unavailable', 'inference_failed', 'timeout', 'busy', 'worker_exited', 'model_changed', 'invalid_worker_result'].includes(analysis.linguistic.reason || '')) {
        throw new Error('language_analysis_failed');
      }
      await saveSubmissionAnalysis(sub.id, analysis, sub.final_markdown || '');

      success++;
      console.log(`  Regraded ${success + failed}/${submissions.length}`);
    } catch {
      console.error('Analysis failed; previous result preserved');
      failed++;
    }
  }

  console.log(`\n🏁 Done. ${success} regraded, ${failed} failed.`);
  if (failed) process.exitCode = 1;
}

regrade().catch(() => {
  console.error('Regrading could not be completed');
  process.exitCode = 1;
}).finally(async () => {
  linguisticRuntime.close();
  await pool.end();
});

/**
 * Regrade all submitted submissions with the updated Flagia engine.
 * Usage: node dist/regrade.js
 */
import pool from './database';
import { runFlagiaAnalysis } from './engine/flagiaEngine';

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
      const analysis = runFlagiaAnalysis(
        allEvents,
        sub.final_markdown || '',
        sub.template_text || '',
        sub.mode,
        sub.submitted_at
      );

      // Update DB
      await pool.query(
        `UPDATE submissions SET
           flagia_score = ?, flag_status = ?,
           coefficient_of_variation = ?, revision_ratio = ?,
           total_paste_count = ?, total_blur_duration = ?,
           analysis_json = ?
         WHERE id = ?`,
        [
          analysis.flagiaScore,
          analysis.flagStatus,
          analysis.coefficientOfVariation,
          analysis.revisionRatio,
          analysis.totalPasteCount,
          analysis.totalBlurDuration,
          JSON.stringify(analysis),
          sub.id,
        ]
      );

      console.log(`  ✅ ${sub.id.slice(0, 8)}… | ${analysis.flagiaScore.toFixed(1)} (${analysis.flagStatus}) | events: ${allEvents.length}`);
      success++;
    } catch (err: any) {
      console.error(`  ❌ ${sub.id.slice(0, 8)}… | Error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n🏁 Done. ${success} regraded, ${failed} failed.`);
  process.exit(0);
}

regrade().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

import type { ResultSetHeader } from 'mysql2';
import pool from '../database';
import { runFlagiaAnalysis } from '../engine/flagiaEngine';

export type FinalSubmissionStatus = 'SUBMITTED' | 'FORCE_CLOSED';

export interface FinalizeSubmissionOptions {
  submissionId: string;
  status: FinalSubmissionStatus;
  /**
   * When omitted, preserve the latest draft already stored on the server.
   * An explicitly supplied empty string is a valid final document.
   */
  finalMarkdown?: string;
}

export interface FinalizeSubmissionResult {
  outcome: 'finalized' | 'already_finalized' | 'not_found';
  submission?: any;
  analysis: any | null;
  analysisError?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '알 수 없는 분석 오류';
}

/**
 * Atomically claims an IN_PROGRESS submission, then runs the shared Flagia
 * analysis pipeline. The status predicate makes this safe when a student's
 * direct submission and an assignment fallback race each other.
 */
export async function finalizeSubmission(
  options: FinalizeSubmissionOptions
): Promise<FinalizeSubmissionResult> {
  const markdown = options.finalMarkdown === undefined ? null : options.finalMarkdown;
  const [updateResult] = await pool.query<ResultSetHeader>(
    `UPDATE submissions
     SET final_markdown = COALESCE(?, final_markdown, ''),
         status = ?,
         submitted_at = NOW()
     WHERE id = ? AND status = 'IN_PROGRESS'`,
    [markdown, options.status, options.submissionId]
  );

  const [rows] = await pool.query(
    `SELECT s.*, a.template_text, a.mode, a.text_limit
     FROM submissions s
     JOIN assignments a ON s.assignment_id = a.id
     WHERE s.id = ?`,
    [options.submissionId]
  );
  const submission = (rows as any[])[0];

  if (!submission) {
    return { outcome: 'not_found', analysis: null };
  }
  if (updateResult.affectedRows === 0) {
    return { outcome: 'already_finalized', submission, analysis: null };
  }

  const [sessionRows] = await pool.query(
    'SELECT events_blob FROM sessions WHERE submission_id = ? ORDER BY start_time ASC',
    [options.submissionId]
  );
  const allEvents: any[] = [];
  for (const session of sessionRows as any[]) {
    if (!session.events_blob) continue;
    try {
      const parsed = JSON.parse(session.events_blob);
      if (Array.isArray(parsed)) allEvents.push(...parsed);
    } catch {
      // A malformed session must not prevent the remaining valid sessions from
      // being analysed or the submission from being finalized.
    }
  }

  try {
    const analysis = runFlagiaAnalysis(
      allEvents,
      submission.final_markdown || '',
      submission.template_text || '',
      submission.mode,
      submission.submitted_at
    );

    await pool.query(
      `UPDATE submissions SET
        flagia_score = ?, flag_status = ?,
        coefficient_of_variation = ?, revision_ratio = ?,
        total_paste_count = ?, total_blur_duration = ?,
        analysis_json = ?
       WHERE id = ? AND status = ?`,
      [
        analysis.flagiaScore,
        analysis.flagStatus,
        analysis.coefficientOfVariation,
        analysis.revisionRatio,
        analysis.totalPasteCount,
        analysis.totalBlurDuration,
        JSON.stringify(analysis),
        options.submissionId,
        options.status,
      ]
    );

    return { outcome: 'finalized', submission, analysis };
  } catch (error) {
    console.error('Flagia Analysis Engine Error:', error);
    return {
      outcome: 'finalized',
      submission,
      analysis: null,
      analysisError: errorMessage(error),
    };
  }
}

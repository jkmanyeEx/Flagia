import type { ResultSetHeader } from 'mysql2';
import pool from '../database';
import { initialAnalysis, type AnalysisInput } from '../linguistic/pipeline';
import { saveSubmissionAnalysis, scheduleSubmissionAnalysis } from './submissionAnalysis';

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
    const input: AnalysisInput = {
      events: allEvents, markdown: submission.final_markdown || '',
      template: submission.template_text || '', mode: submission.mode,
      submittedAt: submission.submitted_at, sessionCount: (sessionRows as any[]).length,
      assignmentId: submission.assignment_id, studentId: submission.student_id,
    };
    const analysis = initialAnalysis(input);
    await saveSubmissionAnalysis(options.submissionId, analysis, input.markdown);
    if (analysis.linguistic?.status === 'pending') scheduleSubmissionAnalysis(options.submissionId, input);

    return { outcome: 'finalized', submission, analysis };
  } catch {
    console.error('Flagia submission analysis could not be saved');
    return {
      outcome: 'finalized',
      submission,
      analysis: null,
      analysisError: '분석 결과를 저장할 수 없습니다. 제출은 완료되었습니다.',
    };
  }
}

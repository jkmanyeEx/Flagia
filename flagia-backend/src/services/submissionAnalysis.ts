import pool from '../database';
import type { AnalysisResult } from '../engine/flagiaEngine';
import { completeAnalysis, initialAnalysis, type AnalysisInput } from '../linguistic/pipeline';
import type { LinguisticStage } from '../linguistic/types';

const jobs = new Map<string, { stage: LinguisticStage; promise: Promise<void> }>();

export function activeAnalysisStage(id: string): LinguisticStage | undefined { return jobs.get(id)?.stage; }

export async function saveSubmissionAnalysis(id: string, result: AnalysisResult, markdown: string, requireCurrentSource = false): Promise<void> {
  // Keep list/dashboard columns consistent with the detailed result. Never
  // overwrite a newer draft if the submission is still being edited.
  await pool.query(
    `UPDATE submissions SET flagia_score = ?, flag_status = ?, coefficient_of_variation = ?,
      revision_ratio = ?, total_paste_count = ?, total_blur_duration = ?, analysis_json = ?
     WHERE id = ? AND final_markdown <=> ? AND status IN ('SUBMITTED', 'FORCE_CLOSED')
       ${requireCurrentSource ? `AND JSON_UNQUOTE(JSON_EXTRACT(analysis_json, '$.sourceFingerprint')) = ?
         AND JSON_UNQUOTE(JSON_EXTRACT(analysis_json, '$.linguistic.modelVersion')) = ?
         AND JSON_UNQUOTE(JSON_EXTRACT(analysis_json, '$.linguistic.policyVersion')) = ?` : ''}`,
    [result.flagiaScore, result.flagStatus, result.coefficientOfVariation, result.revisionRatio,
      result.totalPasteCount, result.totalBlurDuration, JSON.stringify(result), id, markdown,
      ...(requireCurrentSource ? [result.sourceFingerprint, result.linguistic?.modelVersion, result.linguistic?.policyVersion] : [])]
  );
}

export function scheduleSubmissionAnalysis(id: string, input: AnalysisInput): void {
  if (jobs.has(id)) return;
  const entry = { stage: 'queued' as LinguisticStage, promise: Promise.resolve() };
  jobs.set(id, entry);
  entry.promise = new Promise<void>(resolve => setImmediate(resolve)).then(async () => {
    try {
      const result = await completeAnalysis(input, stage => { entry.stage = stage; });
      await saveSubmissionAnalysis(id, result, input.markdown, true);
      if (input.assignmentId && input.studentId) {
        // Lazy import avoids the websocket -> finalizer -> analysis module cycle.
        try {
          const { notifySubmissionsUpdate } = await import('../websocket');
          notifySubmissionsUpdate(input.assignmentId, input.studentId);
        } catch { /* Saved results are still available through polling. */ }
      }
    } catch {
      // Inference failure never cancels submission or invents a zero model score.
      const fallback = initialAnalysis(input);
      fallback.linguistic = { ...fallback.linguistic!, status: 'unevaluated', stage: undefined, reason: 'inference_failed' };
      try { await saveSubmissionAnalysis(id, fallback, input.markdown, true); }
      catch { console.error('Unable to persist submission analysis'); }
    } finally { jobs.delete(id); }
  });
}

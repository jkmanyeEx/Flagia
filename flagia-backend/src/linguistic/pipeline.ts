import { createHash } from 'node:crypto';
import { ANALYSIS_VERSION, flagStatusForScore, runFlagiaAnalysis, type AnalysisResult, type TelemetryEvent } from '../engine/flagiaEngine';
import { linguisticModelVersion, linguisticRuntime } from './runtime';
import { earlyScopeReason, revisionStates, submissionPlainText } from './text';
import { deductionFor, POLICY_VERSION, type LinguisticStage, type WorkerResult } from './types';

export interface AnalysisInput {
  events: TelemetryEvent[];
  markdown: string;
  template: string;
  mode: string;
  submittedAt?: Date | string;
  sessionCount: number;
  assignmentId?: string;
  studentId?: string;
}

export function sourceFingerprint(input: Pick<AnalysisInput, 'markdown' | 'template' | 'mode' | 'submittedAt'>): string {
  return createHash('sha256').update(JSON.stringify([
    input.markdown, input.template, input.mode, input.submittedAt,
  ])).digest('hex');
}

export function isCurrentAnalysis(result: AnalysisResult, input: Parameters<typeof sourceFingerprint>[0]): boolean {
  return result.version === ANALYSIS_VERSION && result.sourceFingerprint === sourceFingerprint(input)
    && result.linguistic?.policyVersion === POLICY_VERSION
    && result.linguistic.modelVersion === linguisticModelVersion();
}

export function initialAnalysis(input: AnalysisInput): AnalysisResult {
  const analysis = runFlagiaAnalysis(input.events, input.markdown, input.template, input.mode, input.submittedAt);
  analysis.sessionSummary.sessionCount = input.sessionCount;
  analysis.sourceFingerprint = sourceFingerprint(input);
  const text = submissionPlainText(input.markdown);
  const reason = earlyScopeReason(text, input.mode, input.markdown)
    || (linguisticModelVersion() === 'unavailable' ? 'model_unavailable' : undefined);
  analysis.linguistic = {
    status: reason ? 'unevaluated' : 'pending', stage: reason ? undefined : 'queued', reason,
    modelVersion: linguisticModelVersion(), policyVersion: POLICY_VERSION,
    previousScore: analysis.flagiaScore, deduction: 0, appliedDeduction: 0,
  };
  return analysis;
}

export function applyLinguisticResult(analysis: AnalysisResult, result: WorkerResult, mode: string): AnalysisResult {
  // Call only on a fresh legacy result; never subtract from a cached deduction.
  if (analysis.linguistic?.status === 'evaluated') throw new Error('linguistic_already_applied');
  const { deduction, level } = deductionFor(result);
  const previousScore = analysis.flagiaScore;
  const final = Math.round(Math.max(0, previousScore - deduction) * 100) / 100;
  const appliedDeduction = Math.round((previousScore - final) * 100) / 100;
  const flagStatus = flagStatusForScore(final, mode);
  const next = { ...analysis, flagiaScore: final, flagStatus } as AnalysisResult;
  next.scoreAdjustments = [...(analysis.scoreAdjustments || [])];
  if (appliedDeduction) next.scoreAdjustments.push({ code: 'linguistic', label: '언어 분석 감점', points: -appliedDeduction });
  next.linguistic = { ...result, policyVersion: POLICY_VERSION, level, deduction, appliedDeduction, previousScore };
  if (deduction) {
    next.verdict = '언어 패턴 추가 검토 필요';
    next.verdictDetail = `언어 분석 정책에 따라 ${appliedDeduction}점이 차감되었습니다. AI 사용 확정 판정은 아닙니다. ` + analysis.verdictDetail;
  }
  return next;
}

export async function completeAnalysis(input: AnalysisInput, onStage: (stage: LinguisticStage) => void): Promise<AnalysisResult> {
  const initial = initialAnalysis(input);
  if (initial.linguistic?.status !== 'pending') return initial;
  let result: WorkerResult;
  try {
    result = await linguisticRuntime.run({
      text: submissionPlainText(input.markdown), mode: input.mode, states: revisionStates(input.events),
    }, onStage);
    deductionFor(result);
  } catch {
    result = { status: 'unevaluated', reason: 'inference_failed', modelVersion: linguisticModelVersion() };
  }
  const baseline = runFlagiaAnalysis(input.events, input.markdown, input.template, input.mode,
    input.submittedAt, result.revisions);
  baseline.sessionSummary.sessionCount = input.sessionCount;
  baseline.sourceFingerprint = sourceFingerprint(input);
  return applyLinguisticResult(baseline, result, input.mode);
}

export function studentAnalysis(analysis: AnalysisResult | null): object | null {
  if (!analysis) return null;
  return {
    version: analysis.version, flagiaScore: analysis.flagiaScore, flagStatus: analysis.flagStatus,
    sessionSummary: analysis.sessionSummary,
    linguistic: analysis.linguistic ? { status: analysis.linguistic.status, stage: analysis.linguistic.stage } : undefined,
  };
}

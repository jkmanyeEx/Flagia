export interface RevisionAnalysis {
  status: 'evaluated' | 'unevaluated';
  stableSentenceCount: number;
  surfaceEdits: number;
  rewordings: number;
  meaningEdits: number;
  unknownEdits: number;
  meaningChangeRatio: number;
  method: string;
  coverage?: 'sampled' | 'complete-checkpoints';
  examples: { kind: string; before: string; after: string }[];
}

export type LinguisticStage = 'queued' | 'loading' | 'features' | 'context' | 'revisions';
export interface LinguisticResult {
  status: 'pending' | 'evaluated' | 'unevaluated';
  policyVersion: 'ko-deduction-v1';
  modelVersion: string;
  deduction: number;
  appliedDeduction: number;
  previousScore: number;
  level?: 'none' | 'review' | 'corroborated' | 'strong';
  reason?: string;
  stage?: LinguisticStage;
  validation?: 'provisional' | 'validated';
  featureScore?: number;
  contextScore?: number;
  thresholds?: { aReview: number; aStrong: number; bReview: number };
  calibrationHumanCount?: number;
  chunkCount?: number;
  evidence?: { feature: string; value: number; contribution: number }[];
  revisions?: RevisionAnalysis;
}

export type WorkerResult = Omit<LinguisticResult,
  'policyVersion' | 'deduction' | 'appliedDeduction' | 'previousScore'>;

export const POLICY_VERSION = 'ko-deduction-v1' as const;

export function deductionFor(result: WorkerResult): { deduction: number; level: LinguisticResult['level'] } {
  if (result.status === 'unevaluated') return { deduction: 0, level: undefined };
  if (result.status !== 'evaluated') throw new Error('invalid_linguistic_status');
  const { featureScore: a, contextScore: b, thresholds: t } = result;
  const values = [a, b, t?.aReview, t?.aStrong, t?.bReview];
  if (!values.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)
    || !t || t.aStrong < t.aReview) throw new Error('invalid_linguistic_result');
  if (a! <= t.aReview) return { deduction: 0, level: 'none' };
  if (b! <= t.bReview) return { deduction: 15, level: 'review' };
  if (a! > t.aStrong) return { deduction: 65, level: 'strong' };
  return { deduction: 35, level: 'corroborated' };
}

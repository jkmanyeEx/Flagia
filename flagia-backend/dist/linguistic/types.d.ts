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
    examples: {
        kind: string;
        before: string;
        after: string;
    }[];
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
    thresholds?: {
        aReview: number;
        aStrong: number;
        bReview: number;
    };
    calibrationHumanCount?: number;
    chunkCount?: number;
    evidence?: {
        feature: string;
        value: number;
        contribution: number;
    }[];
    revisions?: RevisionAnalysis;
}
export type WorkerResult = Omit<LinguisticResult, 'policyVersion' | 'deduction' | 'appliedDeduction' | 'previousScore'>;
export declare const POLICY_VERSION: "ko-deduction-v1";
export declare function deductionFor(result: WorkerResult): {
    deduction: number;
    level: LinguisticResult['level'];
};
//# sourceMappingURL=types.d.ts.map
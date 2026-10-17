import { type AnalysisResult, type TelemetryEvent } from '../engine/flagiaEngine';
import { type LinguisticStage, type WorkerResult } from './types';
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
export declare function sourceFingerprint(input: Pick<AnalysisInput, 'markdown' | 'template' | 'mode' | 'submittedAt'>): string;
export declare function isCurrentAnalysis(result: AnalysisResult, input: Parameters<typeof sourceFingerprint>[0]): boolean;
export declare function initialAnalysis(input: AnalysisInput): AnalysisResult;
export declare function applyLinguisticResult(analysis: AnalysisResult, result: WorkerResult, mode: string): AnalysisResult;
export declare function completeAnalysis(input: AnalysisInput, onStage: (stage: LinguisticStage) => void): Promise<AnalysisResult>;
export declare function studentAnalysis(analysis: AnalysisResult | null): object | null;
//# sourceMappingURL=pipeline.d.ts.map
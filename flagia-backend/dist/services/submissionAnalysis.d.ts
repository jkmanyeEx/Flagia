import type { AnalysisResult } from '../engine/flagiaEngine';
import { type AnalysisInput } from '../linguistic/pipeline';
import type { LinguisticStage } from '../linguistic/types';
export declare function activeAnalysisStage(id: string): LinguisticStage | undefined;
export declare function saveSubmissionAnalysis(id: string, result: AnalysisResult, markdown: string, requireCurrentSource?: boolean): Promise<void>;
export declare function scheduleSubmissionAnalysis(id: string, input: AnalysisInput): void;
//# sourceMappingURL=submissionAnalysis.d.ts.map
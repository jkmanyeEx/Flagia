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
export declare function finalizeSubmission(options: FinalizeSubmissionOptions): Promise<FinalizeSubmissionResult>;
//# sourceMappingURL=submissionFinalizer.d.ts.map
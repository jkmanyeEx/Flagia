export declare function submissionPlainText(markdown: string): string;
export declare function earlyScopeReason(text: string, mode: string, markup?: string): string | undefined;
/** UTF-16 frame offsets are applied BEFORE normalizing the comparison text. */
export declare function revisionStates(events: any[]): {
    text: string;
    timestamp: number;
    segment?: number;
}[];
//# sourceMappingURL=text.d.ts.map
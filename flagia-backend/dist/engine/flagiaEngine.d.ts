/**
 * Flagia Analysis Engine v2.0
 *
 * Computes human-writing confidence metrics from keystroke telemetry:
 * - IKI Coefficient of Variation (Cv = σ/μ)
 * - Revision Ratio (totalKeystrokes / finalTextLength)
 * - Paste Detection (excluding legitimate CB quotes)
 * - Blur Duration accumulation
 * - Composite Flagia Score (0-100)
 * - Per-component scores with breakdown
 * - Writing timeline with intensity buckets
 * - Natural language verdict
 */
interface TelemetryEvent {
    seq: number;
    timestamp: number;
    iki: number;
    type: 'keydown' | 'keyup' | 'paste' | 'blur' | 'focus' | 'toolbar_action';
    meta: {
        key?: string;
        cursorPosition?: number;
        pasteLength?: number;
        actionType?: string;
    };
    currentHash: string;
}
interface ComponentScore {
    raw: number;
    weighted: number;
    weight: number;
    label: string;
    description: string;
    status: 'good' | 'warning' | 'danger';
}
interface TimelineBucket {
    startMs: number;
    endMs: number;
    keystrokeCount: number;
    avgIki: number;
    isBlurred: boolean;
    pasteCount: number;
}
interface BlurInterval {
    startMs: number;
    endMs: number;
    durationSec: number;
}
interface SessionSummary {
    totalDurationSec: number;
    sessionCount: number;
    totalKeystrokes: number;
    totalCharactersTyped: number;
    averageWPM: number;
}
interface AnalysisResult {
    flagiaScore: number;
    flagStatus: 'GREEN' | 'AMBER' | 'RED';
    coefficientOfVariation: number;
    revisionRatio: number;
    totalPasteCount: number;
    totalBlurDuration: number;
    components: {
        typingRhythm: ComponentScore;
        revisionIntensity: ComponentScore;
        externalContent: ComponentScore;
        focusDuration: ComponentScore;
    };
    timeline: TimelineBucket[];
    blurIntervals: BlurInterval[];
    sessionSummary: SessionSummary;
    verdict: string;
    verdictDetail: string;
}
/**
 * Main analysis function
 */
export declare function runFlagiaAnalysis(events: TelemetryEvent[], finalMarkdown: string, templateText: string, mode: string): AnalysisResult;
export {};
//# sourceMappingURL=flagiaEngine.d.ts.map
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
  // `leave`/`reconnect` are server-injected markers bounding a period when the
  // student had left the site; the gap between them is excluded from writing time.
  type: 'keydown' | 'keyup' | 'paste' | 'blur' | 'focus' | 'toolbar_action' | 'leave' | 'reconnect' | 'snapshot';
  meta: {
    key?: string;
    cursorPosition?: number;
    pasteLength?: number;
    actionType?: string;
    // True when the pasted text was copied from within this page (editor or
    // template pane) — legitimate, so excluded from the external-content score.
    internal?: boolean;
    // 'snapshot' events carry the editor's plain text at capture time (used for
    // replay and content-divergence detection).
    text?: string;
  };
  currentHash: string;
}

interface ComponentScore {
  raw: number;       // 0-100
  weighted: number;  // raw * weight
  weight: number;    // 0-1
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
  version?: number;
  flagiaScore: number;
  // Weighted sum of the 5 components BEFORE any structural penalties. The
  // component cards add up to this; the final flagiaScore = baseScore + the
  // (negative) scoreAdjustments below.
  baseScore?: number;
  scoreAdjustments?: { label: string; points: number }[];
  // Breakdown of the copy-typing (transcription) penalty for the analysis UI.
  transcription?: {
    basis: 'none' | 'divergence' | 'rr' | 'template';
    triggered: boolean;
    points: number; // total penalty applied (≤ 0)
    rows: { label: string; value: string }[];
  };
  flagStatus: 'GREEN' | 'AMBER' | 'RED';
  coefficientOfVariation: number;
  revisionRatio: number;
  totalPasteCount: number;
  totalBlurDuration: number;
  totalBlurCount: number;
  // v2 additions
  components: {
    typingRhythm: ComponentScore;
    revisionIntensity: ComponentScore;
    externalContent: ComponentScore;
    focusDuration: ComponentScore;
    writingTime: ComponentScore;
  };
  timeline: TimelineBucket[];
  blurIntervals: BlurInterval[];
  sessionSummary: SessionSummary;
  verdict: string;
  verdictDetail: string;
}

// Keys that are not typed content and should be excluded from rhythm analysis.
// NOTE: 'Process'/'Unidentified'/'Dead' are NOT excluded — Korean (and other IME)
// input fires keydown with key='Process' during composition. Those are REAL
// content keystrokes (each jamo is a press), and their inter-keystroke timing IS
// the typing rhythm. Excluding them dropped all Korean keystrokes → Cv = 0.
const NON_CONTENT_KEYS = new Set([
  'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete', 'Backspace',
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
  'ContextMenu', 'Pause', 'ScrollLock', 'NumLock', 'PrintScreen',
]);

// IKI samples beyond this are treated as "thinking pauses", not typing rhythm.
// Korean typing is naturally bimodal (intra-syllable ~50ms, inter-word ~300ms);
// allowing multi-second pauses inflates Cv and unfairly penalizes real writers.
const IKI_CEILING_MS = 2000;

// Mode-specific weight adjustments. timeWeight added so writing-pace can
// down-score submissions that arrive far too fast for their length.
const MODE_WEIGHTS: Record<string, { cvWeight: number; rrWeight: number; pasteWeight: number; blurWeight: number; timeWeight: number }> = {
  STRICT:   { cvWeight: 0.30, rrWeight: 0.20, pasteWeight: 0.20, blurWeight: 0.15, timeWeight: 0.15 },
  STANDARD: { cvWeight: 0.25, rrWeight: 0.20, pasteWeight: 0.20, blurWeight: 0.20, timeWeight: 0.15 },
  RESEARCH: { cvWeight: 0.20, rrWeight: 0.15, pasteWeight: 0.30, blurWeight: 0.20, timeWeight: 0.15 },
  CREATIVE: { cvWeight: 0.20, rrWeight: 0.25, pasteWeight: 0.20, blurWeight: 0.20, timeWeight: 0.15 },
};

// Mode-specific flag thresholds
const MODE_THRESHOLDS: Record<string, { green: number; amber: number }> = {
  STRICT:   { green: 75, amber: 50 },
  STANDARD: { green: 70, amber: 40 },
  RESEARCH: { green: 60, amber: 35 },
  CREATIVE: { green: 55, amber: 30 },
};

/**
 * Compute Coefficient of Variation for IKI values
 * Cv = σ / μ (with division-by-zero guard)
 */
function computeCv(ikiValues: number[]): number {
  if (ikiValues.length < 2) return 0;

  const n = ikiValues.length;
  const mean = ikiValues.reduce((a, b) => a + b, 0) / n;

  // Guard: if mean is effectively zero, return 0
  if (mean < 1) return 0;

  const variance = ikiValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (n - 1);
  const stddev = Math.sqrt(variance);

  return stddev / mean;
}

/**
 * Score component: IKI Cv
 * 
 * Higher Cv = more variation in keystroke timing.
 * Human typing has natural variation (Cv 0.4–0.9).
 * Very LOW Cv (< 0.2) = suspiciously uniform = likely bot/macro/copy-typing.
 * Very HIGH Cv (> 1.5) = erratic bursts = likely paste then edit.
 *
 * IMPORTANT: Low Cv (consistent speed) is PENALIZED because
 * real humans don't type at machine-like constant speed.
 */
function scoreCv(cv: number): number {
  // Sweet spot: natural human variation. Intentionally WIDE so genuine writers
  // (fast clean typists through thoughtful pausers) aren't mistaken for
  // copy-typists — the curve has a broad plateau and gentle, high-floored sides.
  if (cv >= 0.3 && cv <= 1.1) return 100;

  // ── Below the plateau = uniform typing (possible copy-typing) ──
  // Softer than before, with a much higher floor; only near-machine uniformity
  // scores very low. The transcription penalty (RR-based) is the real backstop.
  if (cv >= 0.24 && cv < 0.3) {
    return Math.round(85 + ((cv - 0.24) / 0.06) * 15);  // 85 → 100
  }
  if (cv >= 0.16 && cv < 0.24) {
    return Math.round(62 + ((cv - 0.16) / 0.08) * 23);  // 62 → 85
  }
  if (cv >= 0.09 && cv < 0.16) {
    return Math.round(38 + ((cv - 0.09) / 0.07) * 24);  // 38 → 62
  }
  // Machine-like uniformity.
  if (cv < 0.09) {
    return Math.max(15, Math.round(38 * (cv / 0.09)));  // 0 → 38 (floor 15)
  }

  // ── Above the plateau = uneven bursts (thinking pauses). Lenient taper. ──
  if (cv > 1.1 && cv <= 1.8) {
    return Math.round(92 + ((1.8 - cv) / 0.7) * 8);     // 92 → 100
  }
  if (cv > 1.8 && cv <= 2.8) {
    return Math.round(80 + ((2.8 - cv) / 1.0) * 12);    // 80 → 92
  }
  // Very erratic — still only a mild deduction (floor 72).
  return Math.max(72, Math.round(80 - (cv - 2.8) * 3));
}

/**
 * Cv description must reflect the FINAL score (after confidence scaling),
 * not just raw cv. Otherwise we get "good" scores paired with "very erratic /
 * paste pattern" text, confusing teachers.
 */
function getCvDescription(cv: number, finalScore: number, rhythmConfidence: number, sampleCount: number): string {
  // Low-confidence path: too few keystrokes or paste-dominated. The Cv number
  // is statistically meaningless here — explain that.
  if (rhythmConfidence < 0.5) {
    if (sampleCount < 10) {
      return `타이핑 표본이 너무 적습니다(${sampleCount}회). 직접 타이핑한 내용이 거의 없어 리듬을 판정할 수 없습니다.`;
    }
    return '최종 텍스트에 비해 직접 타이핑한 키 입력이 현저히 적습니다. 대부분의 내용이 외부에서 가져온 것으로 의심되어 리듬 분석 신뢰도가 매우 낮습니다.';
  }

  // High-confidence path: describe by score tier so text matches the number.
  if (finalScore >= 85) return '자연스러운 사람의 타이핑 리듬이 관찰됩니다. 키 입력 간격의 변동이 사람의 일반적인 범위 내에 있습니다.';
  if (finalScore >= 70) {
    if (cv > 1.1) return '키 입력 간격의 편차가 큽니다. 중간중간 충분히 생각하며(사고 멈춤) 작성한 것으로 보이는 자연스러운 패턴입니다.';
    return '대체로 자연스러운 타이핑 리듬입니다. 일반적인 사람의 작성 패턴 범위에 해당합니다.';
  }
  if (finalScore >= 50) {
    return '타이핑 속도가 다소 일정합니다. 미리 작성된 텍스트를 보고 옮겨 치고 있을 가능성이 있습니다.';
  }
  // Low score → suspiciously uniform (high Cv is no longer penalized into this
  // tier — it's treated as thinking pauses above).
  if (cv < 0.1) return '키 입력이 기계적으로 균일합니다. 자동 입력 도구나 매크로 사용이 강하게 의심됩니다.';
  return '타이핑 리듬이 비정상적으로 균일합니다. 외부의 글을 보며 그대로 옮겨 쓴(베껴 쓰기) 패턴이 의심됩니다.';
}

/**
 * Score component: Revision Ratio
 * Typical human writing: RR ≈ 1.2-2.5 (edits, backspaces, corrections)
 */
function scoreRevisionRatio(rr: number): number {
  // Genuine composition is MESSY: writers delete, rewrite, reorder, fix — so
  // total keystrokes substantially exceed the final length (RR ≈ 1.6–3+).
  // Copy-typing (reading text off-screen and transcribing it) is near-LINEAR:
  // each character typed roughly once, almost no revision → RR ≈ 1.0–1.2.
  // So a very low RR is a transcription signal, not "clean writing".
  // Broadened, higher-floored curve: the healthy plateau starts earlier and runs
  // wider, and the low-RR (copy-typing) zone is no longer brutal — the dedicated
  // transcription penalty is the real backstop, so this component just nudges.
  if (rr <= 0) return 50;                                              // no usable data
  if (rr < 1.0) return 30;                                             // keystrokes < text → pasted
  if (rr < 1.2)  return Math.round(45 + ((rr - 1.0) / 0.2) * 20);      // 45→65  copy-typing zone
  if (rr < 1.4)  return Math.round(65 + ((rr - 1.2) / 0.2) * 25);      // 65→90
  if (rr < 1.5)  return Math.round(90 + ((rr - 1.4) / 0.1) * 10);      // 90→100
  if (rr <= 3.5) return 100;                                           // broad healthy plateau
  if (rr <= 6.0) return Math.round(100 - ((rr - 3.5) / 2.5) * 35);     // 100→65
  return Math.max(40, Math.round(65 - (rr - 6.0) * 6));                // >6 erratic
}

function getRrDescription(rr: number): string {
  if (rr < 1.0) return '키 입력 수가 최종 텍스트 길이보다 적습니다. 붙여넣기를 통해 대부분의 내용이 입력되었습니다.';
  if (rr < 1.15) return '수정 흔적이 거의 없이 최종 글이 사실상 한 번에 그대로 입력되었습니다. 직접 구상하며 쓴 글은 보통 더 많은 삭제·재작성을 동반하므로, 외부의 글을 보며 그대로 옮겨 친(베껴 쓰기) 정황이 의심됩니다.';
  if (rr < 1.4) return '수정·편집 활동이 평균보다 현저히 적습니다. 자연스러운 작문 과정이라기보다 미리 준비된 텍스트를 옮겨 적었을 가능성이 있습니다.';
  if (rr < 1.6) return '다소 적은 수준의 수정이 있었습니다. 비교적 정돈된 작성 과정입니다.';
  if (rr <= 3.0) return '적절한 수준의 수정과 편집이 이루어졌습니다. 글을 쓰면서 자연스럽게 내용을 다듬은 흔적이 보입니다.';
  if (rr <= 5.0) return '상당한 양의 수정 작업이 관찰됩니다. 글의 구조를 크게 변경하며 작성한 것으로 보입니다.';
  return '매우 많은 수정이 있었습니다. 글을 반복적으로 재작성한 것으로 보입니다.';
}

/**
 * Score component: Paste Count
 */
function scorePasteCount(count: number): number {
  if (count === 0) return 100;
  if (count <= 2) return 80;
  if (count <= 5) return 60;
  if (count <= 10) return 40;
  return Math.max(0, 30 - (count - 10) * 2);
}

/**
 * Score component: Paste Volume (total pasted length vs final text length)
 * This measures the RATIO of pasted content to final text, not just event count.
 * A single large paste is more suspicious than many small ones.
 */
function scorePasteVolume(totalPastedLength: number, finalTextLength: number): number {
  if (totalPastedLength === 0) return 100;
  const ratio = finalTextLength > 0 ? totalPastedLength / finalTextLength : 1;
  if (ratio < 0.05) return 95;       // < 5% pasted — negligible
  if (ratio < 0.15) return 80;       // < 15% pasted — minor references
  if (ratio < 0.30) return 60;       // < 30% pasted — noticeable
  if (ratio < 0.50) return 40;       // < 50% pasted — significant
  if (ratio < 0.75) return 20;       // < 75% pasted — majority pasted
  return 5;                          // >= 75% pasted — nearly all external
}

function getPasteDescription(count: number, totalPastedLength: number, finalTextLength: number): string {
  const ratio = finalTextLength > 0 ? Math.round((totalPastedLength / finalTextLength) * 100) : 0;
  if (count === 0) return '외부에서 텍스트를 붙여넣기한 흔적이 없습니다. 모든 내용이 직접 타이핑으로 작성되었습니다.';
  if (ratio < 10) return `${count}회의 붙여넣기가 감지되었습니다 (전체의 약 ${ratio}%). 소량의 인용이나 참고 내용 삽입으로 보입니다.`;
  if (ratio < 30) return `${count}회의 붙여넣기가 감지되었습니다 (전체의 약 ${ratio}%). 외부 소스에서 내용을 가져온 것으로 보입니다.`;
  if (ratio < 60) return `${count}회의 붙여넣기가 감지되었습니다 (전체의 약 ${ratio}%). 상당 부분이 외부에서 작성된 내용일 수 있습니다.`;
  return `${count}회의 붙여넣기로 전체의 약 ${ratio}%가 외부에서 복사되었습니다. 대부분의 내용이 외부에서 작성된 것으로 의심됩니다.`;
}

/**
 * Score component: Blur Duration
 */
function scoreBlurDuration(totalSeconds: number): number {
  if (totalSeconds < 30) return 100;
  if (totalSeconds < 60) return 90;
  if (totalSeconds < 120) return 75;
  if (totalSeconds < 300) return 60;
  if (totalSeconds < 600) return 40;
  return Math.max(0, 30 - Math.floor((totalSeconds - 600) / 60));
}

/**
 * Frequency modifier for the focus score. Time-away is the PRIMARY signal
 * (scoreBlurDuration above), but a high RATE of leaving-and-returning — popping
 * out repeatedly even briefly, e.g. glancing at a second screen every few
 * seconds — is itself suspicious and shouldn't score a clean 100. This returns
 * a small, CAPPED deduction so frequency only nudges the duration-based score.
 *
 * - 0–1 departures: free.
 * - Volume: a high total count over the session adds a little.
 * - Rate: bursty in-and-out (departures per active minute) adds more — this is
 *   the "left 3 times in one minute" case the duration score alone misses.
 * Capped at 18 points so duration always remains the dominant factor.
 */
function blurFrequencyPenalty(blurCount: number, activeMinutes: number): number {
  if (blurCount <= 1) return 0;
  const perMin = activeMinutes > 0.5 ? blurCount / activeMinutes : blurCount;
  let penalty = 0;
  if (blurCount > 3) penalty += (blurCount - 3) * 1.5;   // volume: many over the session
  if (perMin > 1.5) penalty += (perMin - 1.5) * 6;       // rate: bursty popping in/out
  return Math.min(18, Math.round(penalty));
}

function getBlurDescription(totalSeconds: number, blurCount: number, freqPenalty: number): string {
  // Frequency note appended when bursty in/out drove a deduction even though the
  // total time away may be small.
  const freqNote = freqPenalty > 0
    ? ` 또한 화면을 ${blurCount}회 드나들어, 잦은 이탈 빈도로 인한 감점이 적용되었습니다.`
    : '';
  if (totalSeconds < 30) {
    return (freqPenalty > 0
      ? `화면 이탈 시간은 짧지만(총 ${Math.round(totalSeconds)}초), 짧게 자주 드나든 정황이 있습니다.${freqNote}`
      : '작성 중 화면 이탈이 거의 없었습니다. 집중해서 글을 작성한 것으로 판단됩니다.');
  }
  if (totalSeconds < 60) return `총 ${Math.round(totalSeconds)}초간 화면을 이탈했습니다. 짧은 참고 활동 정도로 보입니다.${freqNote}`;
  if (totalSeconds < 120) return `총 ${Math.round(totalSeconds)}초간 화면을 이탈했습니다. 외부 자료를 참고하며 작성한 것으로 보입니다.${freqNote}`;
  if (totalSeconds < 300) return `총 ${Math.round(totalSeconds / 60)}분간 화면을 이탈했습니다. 상당한 시간을 다른 곳에서 보냈습니다.${freqNote}`;
  return `총 ${Math.round(totalSeconds / 60)}분간 화면을 이탈했습니다. 작성 시간의 상당 부분을 외부에서 활동한 것으로 의심됩니다.${freqNote}`;
}

/**
 * Score component: Writing Time
 *
 * Human writing in Korean averages ~100–150 characters per minute (cpm);
 * fast writers can sustain ~200 cpm. Beyond ~400 cpm, the submission was
 * almost certainly not typed in real time. Very short sessions for long
 * texts are a strong AI/paste signal.
 *
 * Excludes the submission edge case: < 50 chars is too little to judge.
 */
function scoreWritingTime(durationSec: number, textLength: number): number {
  if (textLength < 50) return 100;          // not enough content to judge
  if (durationSec < 5) return 5;            // submitted before they could type
  const cpm = textLength / (durationSec / 60);
  if (cpm <= 200) return 100;               // natural human pace
  if (cpm <= 300) return 85;                // fast but plausible
  if (cpm <= 500) return 55;                // very fast — paste-and-edit likely
  if (cpm <= 800) return 25;
  return 10;                                // unrealistic for human typing
}

function getTimeDescription(durationSec: number, textLength: number): string {
  if (textLength < 50) return '판정할 만큼 충분한 글자 수가 아닙니다.';
  if (durationSec < 5) return '작성 시간이 비정상적으로 짧습니다. 사실상 타이핑 없이 제출된 것으로 보입니다.';
  const cpm = Math.round(textLength / (durationSec / 60));
  const mins = Math.max(1, Math.round(durationSec / 60));
  if (cpm <= 200) return `약 ${mins}분 동안 분당 ${cpm}자를 작성했습니다. 사람의 일반적인 글쓰기 속도입니다.`;
  if (cpm <= 300) return `분당 약 ${cpm}자로 다소 빠르지만 사람이 작성할 수 있는 범위입니다.`;
  if (cpm <= 500) return `분당 약 ${cpm}자로 매우 빠른 속도입니다. 외부에서 작성된 글을 옮겼거나 부분적으로 붙여넣었을 가능성이 있습니다.`;
  if (cpm <= 800) return `분당 약 ${cpm}자입니다. 사람이 실시간으로 타이핑한 속도라고 보기 어렵습니다.`;
  return `분당 약 ${cpm}자로 사람이 작성할 수 없는 속도입니다. 대부분의 내용이 외부에서 작성되어 한 번에 입력된 것으로 의심됩니다.`;
}

/**
 * Drop the trailing unpaired blur event that fires when the student clicks
 * the "제출" button — the editor loses focus before the submit completes,
 * but no matching focus event ever returns. Counting this as an editor
 * leave produces a spurious yellow bucket at the end of every timeline.
 */
function stripSubmitInducedBlur(events: TelemetryEvent[]): TelemetryEvent[] {
  let openBlurIdx = -1;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type === 'blur') openBlurIdx = i;
    else if (e.type === 'focus') openBlurIdx = -1;
  }
  if (openBlurIdx < 0) return events;
  // If the unmatched blur is also the last event (or only followed by
  // non-focus/keydown events), treat it as submit-induced and drop it.
  const hasFocusOrInputAfter = events.slice(openBlurIdx + 1).some(
    e => e.type === 'focus' || e.type === 'keydown' || e.type === 'paste'
  );
  if (hasFocusOrInputAfter) return events;
  return events.slice(0, openBlurIdx).concat(events.slice(openBlurIdx + 1));
}

function getComponentStatus(score: number): 'good' | 'warning' | 'danger' {
  if (score >= 70) return 'good';
  if (score >= 40) return 'warning';
  return 'danger';
}

/**
 * Build writing timeline — aggregate into 30-second buckets
 */
function buildTimeline(events: TelemetryEvent[], bucketSizeMs = 30000, submittedAt?: Date | string): TimelineBucket[] {
  if (events.length === 0) return [];

  const timestamps = events.map(e => e.timestamp).filter(t => t > 0);
  if (timestamps.length === 0) return [];

  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);

  let endT = maxTime + bucketSizeMs;
  if (submittedAt) {
    const parsedSub = new Date(submittedAt).getTime();
    if (!isNaN(parsedSub) && parsedSub > minTime) {
      endT = parsedSub;
    }
  }

  const buckets: TimelineBucket[] = [];
  let currentStart = minTime;

  while (currentStart < endT) {
    const currentEnd = Math.min(currentStart + bucketSizeMs, endT);
    const bucketEvents = events.filter(e => e.timestamp >= currentStart && e.timestamp < currentEnd);
    
    const keystrokes = bucketEvents.filter(e => e.type === 'keydown').length;
    const ikiValues = bucketEvents
      .filter(e => e.type === 'keydown' && e.iki > 0 && e.iki < IKI_CEILING_MS)
      .map(e => e.iki);
    const avgIki = ikiValues.length > 0 ? ikiValues.reduce((a, b) => a + b, 0) / ikiValues.length : 0;
    const isBlurred = bucketEvents.some(e => e.type === 'blur') && !bucketEvents.some(e => e.type === 'focus');
    const pasteCount = bucketEvents.filter(e => e.type === 'paste').length;

    buckets.push({
      startMs: currentStart - minTime,
      endMs: currentEnd - minTime,
      keystrokeCount: keystrokes,
      avgIki: Math.round(avgIki),
      isBlurred,
      pasteCount,
    });

    currentStart = currentEnd;
    if (bucketSizeMs <= 0) break;
  }

  return buckets;
}

/**
 * Build blur interval list
 */
function buildBlurIntervals(events: TelemetryEvent[]): BlurInterval[] {
  const intervals: BlurInterval[] = [];
  let lastBlurTime: number | null = null;
  const minTime = events.length > 0 ? Math.min(...events.map(e => e.timestamp).filter(t => t > 0)) : 0;

  for (const event of events) {
    if (event.type === 'blur') {
      lastBlurTime = event.timestamp;
    } else if (event.type === 'focus' && lastBlurTime !== null) {
      const blurMs = event.timestamp - lastBlurTime;
      if (blurMs > 0 && blurMs < 3600000) {
        intervals.push({
          startMs: lastBlurTime - minTime,
          endMs: event.timestamp - minTime,
          durationSec: Math.round((blurMs / 1000) * 100) / 100,
        });
      }
      lastBlurTime = null;
    }
  }

  return intervals;
}

/**
 * Generate natural language verdict
 */
function generateVerdict(
  flagiaScore: number,
  flagStatus: string,
  scores: { cv: number; rr: number; paste: number; blur: number; time: number },
  mode: string
): { verdict: string; verdictDetail: string } {
  let verdict: string;
  let details: string[] = [];

  if (flagStatus === 'GREEN') {
    verdict = '이 제출물은 자연스러운 사람의 글쓰기 패턴을 보여줍니다.';
    details.push('키스트로크 리듬, 수정 빈도, 집중 시간, 작성 속도 등 모든 지표가 정상 범위 내에 있습니다.');
  } else if (flagStatus === 'AMBER') {
    verdict = '이 제출물에서 일부 비정상적인 패턴이 감지되었습니다.';
    const issues: string[] = [];
    if (scores.cv < 70) issues.push('타이핑 리듬');
    if (scores.rr < 70) issues.push('수정 패턴');
    if (scores.paste < 70) issues.push('외부 콘텐츠');
    if (scores.blur < 70) issues.push('화면 이탈');
    if (scores.time < 70) issues.push('작성 시간');
    if (issues.length > 0) details.push(`주의가 필요한 영역: ${issues.join(', ')}`);
    details.push('추가적인 확인이 권장되지만, 단독으로 부정행위를 판단하기에는 불충분합니다.');
  } else {
    verdict = '이 제출물에서 심각한 비정상 패턴이 다수 감지되었습니다.';
    details.push('여러 지표가 외부에서 작성된 글을 복사하거나 자동화 도구를 사용했을 가능성을 시사합니다.');
    details.push('교사의 직접 확인 및 학생 면담이 권장됩니다.');
  }

  details.push(`\n분석 모드: ${mode} | 최종 점수: ${flagiaScore}점`);

  return { verdict, verdictDetail: details.join(' ') };
}

// ── Linguistic pause alignment (Part 2) ────────────────────────────────────
// A genuine writer's cognitive pauses (500–1500ms) land at SEMANTIC boundaries
// — after a space/punctuation, or before starting a new word — because the
// pause is "what do I write next?" thinking. A copy-typist reading text off a
// screen pauses wherever their eyes lose their place, which lands MID-WORD.
//
// Cursor offsets are unreliable, so instead of position we use the KEY SEQUENCE:
// for each long-IKI keystroke we look at the key just before and the key just
// after the pause. If neither is a delimiter (both are letters/jamo), the pause
// happened in the middle of a word — the copy-typing signature.
function isContentChar(k?: string | null): boolean {
  if (!k || k.length !== 1) return false;
  // Hangul syllables + compatibility jamo, latin letters, digits.
  return /[가-힣㄰-㆏0-9A-Za-z]/.test(k);
}
const PAUSE_DELIMITERS = new Set([
  ' ', ' ', '\n', 'Enter', '\t',
  '.', ',', '!', '?', ';', ':', ')', ']', '}', '(', '[', '{',
  '"', "'", '。', '、', '·', '…', '~', '-', '/',
]);
function isPauseDelimiter(k?: string | null): boolean {
  return !!k && PAUSE_DELIMITERS.has(k);
}

interface PauseAlignment { cognitivePauses: number; midWordPauses: number; midWordRatio: number; score: number; }

function analyzePauseAlignment(events: TelemetryEvent[]): PauseAlignment {
  const PAUSE_MIN_MS = 500;    // below this is motor rhythm, not cognition
  const PAUSE_MAX_MS = 10000;  // above this is AFK / tab-switch, not a "thinking pause"
  let cognitive = 0;
  let midWord = 0;
  let prevKey: string | null = null; // last "flow" key (content or delimiter)

  for (const e of events) {
    if (e.type !== 'keydown') continue;
    const k = e.meta?.key;
    // Only the writing flow matters: skip modifiers, arrows, backspace, etc.
    if (!isContentChar(k) && !isPauseDelimiter(k)) continue;

    if (e.iki > PAUSE_MIN_MS && e.iki < PAUSE_MAX_MS) {
      cognitive++;
      const atBoundary = isPauseDelimiter(prevKey) || isPauseDelimiter(k);
      if (!atBoundary && isContentChar(prevKey) && isContentChar(k)) midWord++;
    }
    prevKey = k ?? null;
  }

  // Too few pauses to judge → neutral (no penalty).
  if (cognitive < 8) return { cognitivePauses: cognitive, midWordPauses: midWord, midWordRatio: 0, score: 100 };

  const midWordRatio = midWord / cognitive;
  // Allow ~15% mid-word pauses as natural; penalize sharply beyond that.
  // 0.15→100, 0.50→44, 0.70→12, 0.85→0
  const score = Math.max(0, Math.min(100, Math.round(100 - (midWordRatio - 0.15) * 160)));
  return { cognitivePauses: cognitive, midWordPauses: midWord, midWordRatio, score };
}

/**
 * Calculate expected keystroke count normalized for language (specifically Korean Hangul)
 */
function getExpectedKeystrokeCount(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const code = char.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      // Hangul Syllable
      const offset = code - 0xAC00;
      const jungIdx = Math.floor((offset % 588) / 28);
      const jongIdx = offset % 28;
      
      let keystrokes = 1; // Initial consonant (choseong) is 1 keystroke
      
      // jungseong: compound vowels require 2 keystrokes
      if ([9, 10, 11, 14, 15, 16, 19].includes(jungIdx)) {
        keystrokes += 2;
      } else {
        keystrokes += 1;
      }
      
      // jongseong: if present, check if compound (2 keystrokes) or single (1 keystroke)
      if (jongIdx > 0) {
        if ([3, 5, 6, 9, 10, 11, 12, 13, 14, 15, 18].includes(jongIdx)) {
          keystrokes += 2;
        } else {
          keystrokes += 1;
        }
      }
      count += keystrokes;
    } else if (code >= 0x3131 && code <= 0x318E) {
      // Compatibility Jamo (typically typed as 1 keystroke)
      count += 1;
    } else if (char === '\r') {
      continue;
    } else {
      // All other characters (ASCII, Latin, spaces, punctuation, etc.)
      count += 1;
    }
  }
  return Math.max(1, count);
}

// ── Fuzzy text similarity (NFC + character n-grams) ──
// Used to compare texts tolerantly of small typos. NFC-normalize so composed vs.
// decomposed Hangul match (한 == ㅎㅏㄴ); strip whitespace so Korean 띄어쓰기
// variance doesn't matter; character n-grams are typo-tolerant (a single typo
// perturbs only ~n grams) and script-agnostic (Latin/Hangul/CJK/emoji alike).
function normSim(s: string): string {
  return (s || '').normalize('NFC').replace(/\s+/g, '').toLowerCase();
}
function ngramSet(normalized: string, n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= normalized.length; i++) out.add(normalized.slice(i, i + n));
  return out;
}
// Directional containment: share of A's n-grams that also appear in B (0..1).
// ngramContainment(final, template) ≈ "how much of the final text is the template".
function ngramContainment(a: string, b: string, n = 3): number {
  const A = ngramSet(normSim(a), n);
  if (A.size === 0) return 0;
  const B = ngramSet(normSim(b), n);
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return hit / A.size;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

// ── Content divergence (genuine reworking only) ──
// How much GENUINELY DIFFERENT content the student wrote then abandoned: words
// that appeared mid-draft (in a snapshot), are absent from the final, AND aren't
// just a typo / IME-composition fragment of a final word. Excluding that churn
// is what makes this robust for Korean — IME intermediate syllables (쉬→쉼) and
// corrected typos no longer masquerade as "reworded content". Genuine rewording
// (writing a phrase, then replacing it with a DIFFERENT one) still counts.
function computeDivergence(snapshotTexts: string[], finalText: string): number {
  const tokenize = (s: string): string[] =>
    ((s || '').normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  const finalSet = new Set(tokenize(finalText));
  if (finalSet.size === 0) return 0;
  const finalArr = [...finalSet];

  // How many snapshots each non-final token appears in. Genuinely written-then-
  // abandoned content persists across several 2-second snapshots; Korean IME
  // composition states and fleeting typos flicker in just ONE snapshot, so a
  // persistence floor (≥ 2 snapshots) strips that transient noise.
  const seenCount = new Map<string, number>();
  for (const snap of snapshotTexts) {
    const toks = new Set(tokenize(snap));
    for (const w of toks)
      if (w.length >= 2 && !finalSet.has(w)) seenCount.set(w, (seenCount.get(w) || 0) + 1);
  }

  // A candidate is churn (not genuine rework) if it's a prefix/build-up of a
  // final word or a near-miss spelling of one.
  const isChurn = (w: string): boolean => {
    for (const f of finalArr) {
      if (f.startsWith(w) || w.startsWith(f)) return true;
      if (Math.abs(f.length - w.length) <= 2) {
        const tol = Math.max(1, Math.round(Math.max(w.length, f.length) * 0.3));
        if (levenshtein(w, f) <= tol) return true;
      }
    }
    return false;
  };

  let genuine = 0;
  for (const [w, cnt] of seenCount) {
    if (cnt < 2) continue;       // transient flicker (IME/typo) → not real rework
    if (isChurn(w)) continue;
    genuine++;
  }
  return genuine / finalSet.size;
}

/**
 * Main analysis function
 */
export function runFlagiaAnalysis(
  rawEvents: TelemetryEvent[],
  finalMarkdown: string,
  templateText: string,
  mode: string,
  submittedAt?: Date | string
): AnalysisResult {
  // Deduplicate consecutive keydown events of the exact same key that occur within 15ms
  const cleanedEvents: TelemetryEvent[] = [];
  let lastKdTime = 0;
  let lastKdKey = '';
  for (const e of rawEvents) {
    if (e.type === 'keydown' && e.meta?.key) {
      if (e.meta.key === lastKdKey && lastKdTime > 0 && (e.timestamp - lastKdTime) < 15) {
        continue;
      }
      lastKdTime = e.timestamp;
      lastKdKey = e.meta.key;
    }
    cleanedEvents.push(e);
  }

  const weights = MODE_WEIGHTS[mode] || MODE_WEIGHTS.STANDARD;
  const thresholds = MODE_THRESHOLDS[mode] || MODE_THRESHOLDS.STANDARD;
  const events = stripSubmitInducedBlur(cleanedEvents);

  const plainText = finalMarkdown
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  // Strip HTML from template to do a proper text-to-text comparison
  const plainTemplate = (templateText || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  // Estimate how much of the template is actually preserved in the final text.
  // We divide the template into 20-char chunks and check how many exist in the final text.
  let preservedTemplateLength = 0;
  if (plainTemplate.length > 0) {
    const chunkSize = 20;
    const totalChunks = Math.ceil(plainTemplate.length / chunkSize);
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const chunk = plainTemplate.substring(start, Math.min(start + chunkSize, plainTemplate.length));
      if (chunk.length >= 10 && plainText.includes(chunk)) {
        preservedTemplateLength += chunk.length;
      }
    }
  }

  // Calculate expected keystrokes normalized for language (specifically Korean Hangul)
  const totalExpectedKeystrokes = getExpectedKeystrokeCount(plainText);
  const totalKeydowns = events.filter((e) => e.type === 'keydown').length;

  const isTemplateDominated = plainText.length > 0 && (preservedTemplateLength / plainText.length) > 0.8;
  const isSubstantiallyTyped = totalKeydowns > 0.5 * totalExpectedKeystrokes;
  const shouldSubtractTemplate = !(isTemplateDominated && isSubstantiallyTyped);

  const effectiveTextLength = shouldSubtractTemplate
    ? Math.max(1, plainText.length - preservedTemplateLength)
    : Math.max(1, plainText.length);

  const effectiveExpectedKeystrokes = plainText.length > 0
    ? Math.max(1, Math.round(totalExpectedKeystrokes * (effectiveTextLength / plainText.length)))
    : 1;

  // ── IKI values: only CONTENT keydown events with valid IKI ──
  // Modifier and navigation keys (Shift, Meta, arrows, Backspace…) are not
  // typing rhythm — filtering them out keeps a paste followed by Ctrl/Meta+V
  // from registering as a 99-score "rhythm sample".
  const contentKeydowns = events.filter(
    (e) => e.type === 'keydown' && e.meta?.key && !NON_CONTENT_KEYS.has(e.meta.key)
  );
  const ikiValues = contentKeydowns
    .filter((e) => e.iki > 0 && e.iki < IKI_CEILING_MS)
    .map((e) => e.iki);

  const cv = computeCv(ikiValues);

  // ── Revision Ratio: total keydown count / effective expected keystrokes ──
  const revisionRatio = effectiveExpectedKeystrokes > 0 
    ? totalKeydowns / effectiveExpectedKeystrokes 
    : 0;

  // ── Paste Detection (count + total volume) ──
  // Pastes whose content was copied from this page (editor or template pane) are
  // tagged `meta.internal` by the client and are legitimate (moving/duplicating
  // one's own text, quoting the provided template) — they don't count as external
  // content. Code-block pastes are likewise excluded.
  const isInternalPaste = (e: TelemetryEvent) =>
    e.meta?.internal === true ||
    e.meta?.actionType === 'codeblock' || e.meta?.actionType === 'CB';

  let totalPasteCount = 0;
  let totalPastedLength = 0;
  for (const event of events) {
    if (event.type === 'paste' && !isInternalPaste(event)) {
      totalPasteCount++;
      totalPastedLength += event.meta?.pasteLength || 0;
    }
  }

  // ── Blur Duration + count ──
  // blurCount = completed leave→return round-trips (the frequency signal).
  let totalBlurDuration = 0;
  let blurCount = 0;
  let lastBlurTime: number | null = null;

  for (const event of events) {
    if (event.type === 'blur') {
      lastBlurTime = event.timestamp;
    } else if (event.type === 'focus' && lastBlurTime !== null) {
      const blurMs = event.timestamp - lastBlurTime;
      if (blurMs > 0 && blurMs < 3600000) {
        totalBlurDuration += blurMs / 1000;
        blurCount++;
      }
      lastBlurTime = null;
    }
  }

  // ── Component Scores ──
  // Rhythm score is only meaningful when there's enough typing AND when most
  // of the final text was actually typed (not pasted). Scale toward a low
  // floor when the sample is too small or content-keystrokes ≪ final text.
  const sampleConfidence = Math.min(1, ikiValues.length / 30);
  const contentConfidence = effectiveExpectedKeystrokes > 0
    ? Math.min(1, contentKeydowns.length / effectiveExpectedKeystrokes)
    : 0;
  const rhythmConfidence = Math.min(sampleConfidence, contentConfidence);
  const RHYTHM_FLOOR = 5;
  const rawCvScore = scoreCv(cv);

  // ── Part 2: blend in linguistic pause alignment ──
  // Cv alone can be fooled by a copy-typist whose scan-delays raise variance.
  // Pause alignment catches them: if their long pauses land mid-word rather than
  // at semantic boundaries, the rhythm isn't genuine composition.
  const pauseAlign = analyzePauseAlignment(events);
  const rhythmAuthenticity = pauseAlign.cognitivePauses >= 8
    ? Math.round(rawCvScore * 0.6 + pauseAlign.score * 0.4)
    : rawCvScore;
  const cvScore = Math.round(rhythmAuthenticity * rhythmConfidence + RHYTHM_FLOOR * (1 - rhythmConfidence));

  // ── Part 3: paste-then-disguise detection (temporal, cursor-free) ──
  // A cheater pastes a large block then sprinkles edits to inflate the revision
  // ratio into the "safe" zone. Cursor offsets are unreliable, so we detect the
  // disguise by TIME: edits clustered right after a paste don't count as genuine
  // authorship. If a meaningful chunk was pasted AND most keystrokes happen in
  // the window just after pastes, we discount the laundered revision credit and
  // dock the external-content score.
  const PASTE_EDIT_WINDOW_MS = 120000; // 2 min after each paste
  const pasteTimes = events.filter(e => e.type === 'paste' && !isInternalPaste(e)).map(e => e.timestamp);
  let pasteAdjacentKeydowns = 0;
  if (pasteTimes.length > 0) {
    for (const e of events) {
      if (e.type !== 'keydown') continue;
      if (pasteTimes.some(pt => e.timestamp >= pt && e.timestamp <= pt + PASTE_EDIT_WINDOW_MS)) {
        pasteAdjacentKeydowns++;
      }
    }
  }
  const pasteAdjacentRatio = totalKeydowns > 0 ? pasteAdjacentKeydowns / totalKeydowns : 0;
  const pastedVolumeRatio = effectiveTextLength > 0 ? totalPastedLength / effectiveTextLength : 0;
  const pasteLaundering = pastedVolumeRatio > 0.15 && pasteAdjacentRatio > 0.4;

  let rrScore = scoreRevisionRatio(revisionRatio);
  if (pasteLaundering) {
    // The "revision" is mostly editing pasted text, not original writing.
    rrScore = Math.round(rrScore * (1 - Math.min(0.7, pasteAdjacentRatio)));
  }
  const pasteCountScore = scorePasteCount(totalPasteCount);
  const pasteVolumeScore = scorePasteVolume(totalPastedLength, effectiveTextLength);
  // Blend count and volume: volume is weighted higher (60/40) since it captures severity better
  let pasteScore = Math.round(pasteVolumeScore * 0.6 + pasteCountScore * 0.4);
  if (pasteLaundering) {
    pasteScore = Math.round(pasteScore * (1 - 0.3 * Math.min(1, pasteAdjacentRatio)));
  }
  // Time-away is the primary focus signal; a frequency deduction is layered on
  // below once active writing-time (for the per-minute rate) is known.
  const blurDurationScore = scoreBlurDuration(totalBlurDuration);
  let blurScore = blurDurationScore;
  let blurFreqPenalty = 0;

  // ── Writing-time score: derived from active session span vs. final text length ──
  // The student may have left the site and come back; that wall-clock gap is NOT
  // writing time. We sum every (leave → reconnect) gap and subtract it from the
  // overall span. leave/reconnect carry server timestamps, so each gap duration
  // is accurate regardless of client clock skew; subtracting an accurate
  // duration from the (client-time) activity span yields the real active time.
  // Only subtract disconnect gaps that are INTERNAL to the writing — i.e. the
  // student left mid-write and came BACK and wrote more. Gaps after the last
  // keystroke (e.g. leaving the editor tab open afterward, which makes the WS
  // reconnect every couple of minutes and emit reconnect/leave markers with no
  // typing) must NOT be subtracted: the activity span doesn't include them, so
  // subtracting would wrongly drive the writing time toward 0.
  let lastActivityIdx = -1;
  for (let i = 0; i < events.length; i++) {
    const t = events[i].type;
    if (t !== 'leave' && t !== 'reconnect') lastActivityIdx = i;
  }
  let disconnectedMs = 0;
  let reconnectCount = 0;
  let pendingLeave: number | null = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type === 'leave') {
      if (pendingLeave === null) {
        pendingLeave = e.timestamp;
      }
    } else if (e.type === 'reconnect') {
      reconnectCount++;
      // Count the gap only if real activity continues after this reconnect.
      if (pendingLeave !== null && i < lastActivityIdx) {
        const gap = e.timestamp - pendingLeave;
        if (gap > 0 && gap < 86400000) disconnectedMs += gap; // ignore >24h / negative
      }
      pendingLeave = null;
    }
  }

  // Span is measured over real activity only (exclude the leave/reconnect
  // markers so their server timestamps don't skew the bounds).
  const activityTimestamps = events
    .filter(e => e.type !== 'leave' && e.type !== 'reconnect')
    .map(e => e.timestamp)
    .filter(t => t > 0);
  const rawSpanSec = activityTimestamps.length >= 2
    ? (Math.max(...activityTimestamps) - Math.min(...activityTimestamps)) / 1000
    : 0;
  const totalDurationSec = Math.max(0, rawSpanSec - disconnectedMs / 1000);
  const timeScore = scoreWritingTime(totalDurationSec, effectiveTextLength);

  // Layer the frequency deduction onto the focus score now that we know the
  // active writing time (for the per-minute leave rate). Duration stays dominant
  // (full 0–100 range); frequency only nudges it down, capped at 18.
  blurFreqPenalty = blurFrequencyPenalty(blurCount, totalDurationSec / 60);
  blurScore = Math.max(0, blurDurationScore - blurFreqPenalty);

  // ── Composite Flagia Score ──
  // baseScore is the weighted sum of the 5 components (what the component cards
  // add up to). Structural penalties are then recorded as explicit adjustments
  // so the final score always reconciles: final = baseScore + Σ adjustments.
  const weightedSum =
    cvScore * weights.cvWeight +
    rrScore * weights.rrWeight +
    pasteScore * weights.pasteWeight +
    blurScore * weights.blurWeight +
    timeScore * weights.timeWeight;
  const baseScore = Math.round(Math.max(0, Math.min(100, weightedSum)) * 100) / 100;

  const scoreAdjustments: { label: string; points: number }[] = [];
  let flagiaScore = baseScore;

  // ── Copy-typing (transcription) structural penalty ──
  // The hardest cheat: read AI text off a second screen and type it by hand — or
  // type the provided template verbatim. Keystrokes are genuinely human, so
  // Cv/rhythm look fine and there's no paste, and a cheater can inflate the
  // revision ratio (RR) with fake delete-and-retype "edits" to look messy.
  //
  // RR only measures keystroke VOLUME, not whether the writing changed, so it's
  // both over-sensitive (clean honest writers look linear) and gameable (fake
  // edits). The primary signal here is CONTENT DIVERGENCE from the periodic text
  // snapshots: how much text the student wrote then abandoned/reworded (n-grams
  // that appeared mid-draft but aren't in the final). Genuine writing diverges a
  // lot; copy-typing — even with fake edits or small typos — converges verbatim
  // to the final, so divergence ≈ 0. Fuzzy (NFC + char n-gram) comparison makes
  // it typo-tolerant and script-fair (Korean included).
  const pastedShare = effectiveTextLength > 0 ? totalPastedLength / effectiveTextLength : 0;

  // Content divergence from snapshots (−1 = no snapshots → RR fallback).
  const snapshotTexts = events
    .filter(e => e.type === 'snapshot' && typeof e.meta?.text === 'string')
    .map(e => e.meta!.text as string)
    .filter(t => t.trim().length > 0);
  const hasSnapshots = snapshotTexts.length >= 2;
  // Genuine-reworking divergence (typo/IME churn filtered out — Korean-safe).
  const divergenceRatio = hasSnapshots ? computeDivergence(snapshotTexts, plainText) : -1;

  // Fuzzy template match: share of the final text's n-grams contained in the
  // provided template (typo-tolerant). High ⇒ the student largely reproduced the
  // prompt/template by hand.
  const templateSim = plainTemplate.length > 20 ? ngramContainment(plainText, plainTemplate, 3) : 0;

  const substantial = effectiveExpectedKeystrokes >= 400 && plainText.length >= 120;
  // The fake-edit (acting) case is gated on actual typing EFFORT, not final
  // length: lots of keystrokes that produced ~no content change is suspicious
  // even for a short final text (e.g. a short essay typed with heavy fake churn).
  const actingEligible = totalKeydowns >= 300 && plainText.length >= 50;
  const lowPaste = pastedShare < 0.15;

  let transcriptionSeverity = 0;
  let actingFactor = 0;
  let detectBasis: 'none' | 'divergence' | 'rr' | 'template' = 'none';

  if (lowPaste) {
    if (substantial && templateSim > 0.8 && isSubstantiallyTyped) {
      // 1) Reproduced the provided template by hand (even with minor changes).
      transcriptionSeverity = Math.min(1, templateSim);
      detectBasis = 'template';
    } else if (hasSnapshots && actingEligible) {
      // 2) FAKE-EDIT "acting" (the robust catch): the student appears to revise a
      //    lot (high RR ⇒ lots of keystrokes beyond the final length) yet the
      //    content barely DIVERGED from the final (≈ nothing was reworded/abandoned).
      //    Genuine revision at this RR would have produced lots of divergence;
      //    delete-and-retype-the-same disguise produces ~none. We deliberately do
      //    NOT penalize low divergence alone — a clean honest writer who composes
      //    linearly also has low divergence and must not be flagged. Only the
      //    high-RR + low-divergence COMBINATION is unambiguous deception.
      if (revisionRatio >= 1.25 && divergenceRatio >= 0 && divergenceRatio < 0.05) {
        detectBasis = 'divergence';
        const divShort = (0.05 - divergenceRatio) / 0.05;            // 0..1 (how empty the "edits" were)
        const claimed = Math.min(1, (revisionRatio - 1.25) / 1.0);   // RR 1.25→0 … 2.25→1
        // Severity scales with how far past the 1.25 boundary the RR is, so the
        // borderline (1.25) gets a moderate hit and blatant fake-editing is hammered.
        transcriptionSeverity = Math.min(1, 0.25 + divShort * 0.35 + claimed * 0.4);
        // "More acting penalty": the busier the fake editing, the bigger the boost.
        actingFactor = Math.min(0.5, 0.1 + (revisionRatio - 1.25) * 0.3);
      }
    } else if (substantial && !hasSnapshots && revisionRatio >= 1.0 && revisionRatio < 1.35) {
      // 3) FALLBACK (no snapshots): RR-based, deliberately LIGHT (less RR penalty).
      transcriptionSeverity = Math.min(1, (1.35 - revisionRatio) / 0.35);
      detectBasis = 'rr';
    }
  }

  let transcriptionPoints = 0;
  if (transcriptionSeverity > 0) {
    // Base reduction leans LESS on RR than before; acting (fake-edit) adds on top.
    const baseFactor = detectBasis === 'template' ? 0.75 : (detectBasis === 'rr' ? 0.45 : 0.55);
    const penaltyFactor = Math.min(0.9, baseFactor * transcriptionSeverity + actingFactor);
    let penalized = Math.round(baseScore * (1 - penaltyFactor) * 100) / 100;

    const sev = Math.min(1, transcriptionSeverity + actingFactor);
    if (detectBasis === 'template') {
      penalized = Math.min(penalized, transcriptionSeverity > 0.85 ? 38 : 48);
    } else if (detectBasis === 'divergence') {
      if (sev > 0.7) penalized = Math.min(penalized, 42);
      else if (sev > 0.4) penalized = Math.min(penalized, 55);
    } else {
      // rr fallback: lighter caps (less RR penalty)
      if (sev > 0.6) penalized = Math.min(penalized, 55);
      else if (sev > 0.3) penalized = Math.min(penalized, 65);
    }

    const delta = Math.round((penalized - baseScore) * 100) / 100;
    if (delta < 0) {
      transcriptionPoints = delta;
      const label = detectBasis === 'template'
        ? '베껴쓰기 감점 — 제시문 그대로 타이핑'
        : (actingFactor > 0
            ? '베껴쓰기 감점 — 편집 위장(복사 후 가짜 수정)'
            : '베껴쓰기(전사) 패턴 감점');
      scoreAdjustments.push({ label, points: delta });
      flagiaScore = penalized;
    }
  }

  // Per-section breakdown for the analysis UI's "minus" area.
  const basisKo: Record<string, string> = {
    none: '해당 없음', divergence: '내용 발산도(스냅샷)', rr: '수정 비율(스냅샷 없음)', template: '제시문 일치',
  };
  const transcription = {
    basis: detectBasis,
    triggered: transcriptionPoints < 0,
    points: transcriptionPoints,
    rows: [
      { label: '판정 근거', value: basisKo[detectBasis] },
      {
        label: '내용 발산도 (낮을수록 베껴쓰기 의심)',
        value: divergenceRatio >= 0 ? `${(divergenceRatio * 100).toFixed(1)}%` : '스냅샷 없음',
      },
      { label: '수정 비율 (RR)', value: revisionRatio.toFixed(2) },
      { label: '제시문 일치율', value: `${Math.round(templateSim * 100)}%` },
      { label: '편집 위장(acting) 가중', value: actingFactor > 0 ? `+${actingFactor.toFixed(2)}` : '없음' },
      { label: '심각도', value: Math.min(1, transcriptionSeverity + actingFactor).toFixed(2) },
    ],
  };

  // ── Flag Status ──
  let flagStatus: 'GREEN' | 'AMBER' | 'RED';
  if (flagiaScore >= thresholds.green) {
    flagStatus = 'GREEN';
  } else if (flagiaScore >= thresholds.amber) {
    flagStatus = 'AMBER';
  } else {
    flagStatus = 'RED';
  }

  // ── Edge case: if no events at all, flag as RED ──
  if (events.length === 0) {
    flagiaScore = 0;
    flagStatus = 'RED';
  }

  // ── Build components ──
  const components = {
    typingRhythm: {
      raw: cvScore,
      weighted: Math.round(cvScore * weights.cvWeight * 100) / 100,
      weight: weights.cvWeight,
      label: '타이핑 리듬',
      description: getCvDescription(cv, cvScore, rhythmConfidence, ikiValues.length)
        + (pauseAlign.cognitivePauses >= 8 && pauseAlign.midWordRatio > 0.5
            ? ` ⚠️ 인지적 멈춤의 약 ${Math.round(pauseAlign.midWordRatio * 100)}%가 단어 중간에서 발생했습니다. 의미 경계가 아닌 곳에서 멈춘다는 것은 화면의 글을 시각적으로 따라가며 베껴 쓴 정황을 시사합니다.`
            : ''),
      status: getComponentStatus(cvScore),
    } as ComponentScore,
    revisionIntensity: {
      raw: rrScore,
      weighted: Math.round(rrScore * weights.rrWeight * 100) / 100,
      weight: weights.rrWeight,
      label: '수정 강도',
      description: getRrDescription(revisionRatio)
        + (pasteLaundering
            ? ` ⚠️ 수정 입력의 약 ${Math.round(pasteAdjacentRatio * 100)}%가 붙여넣기 직후 구간에 집중되어 있습니다. 외부 텍스트를 붙여넣은 뒤 부분 수정으로 수정 흔적을 위장한 정황이 의심됩니다.`
            : ''),
      status: getComponentStatus(rrScore),
    } as ComponentScore,
    externalContent: {
      raw: pasteScore,
      weighted: Math.round(pasteScore * weights.pasteWeight * 100) / 100,
      weight: weights.pasteWeight,
      label: '외부 콘텐츠',
      description: getPasteDescription(totalPasteCount, totalPastedLength, effectiveTextLength),
      status: getComponentStatus(pasteScore),
    } as ComponentScore,
    focusDuration: {
      raw: blurScore,
      weighted: Math.round(blurScore * weights.blurWeight * 100) / 100,
      weight: weights.blurWeight,
      label: '집중도',
      description: getBlurDescription(totalBlurDuration, blurCount, blurFreqPenalty),
      status: getComponentStatus(blurScore),
    } as ComponentScore,
    writingTime: {
      raw: timeScore,
      weighted: Math.round(timeScore * weights.timeWeight * 100) / 100,
      weight: weights.timeWeight,
      label: '작성 시간',
      description: getTimeDescription(totalDurationSec, effectiveTextLength),
      status: getComponentStatus(timeScore),
    } as ComponentScore,
  };

  // ── Timeline & blur intervals ──
  // Build over real activity only; the server-injected leave/reconnect markers
  // would otherwise shift the bucket bounds by any client/server clock offset.
  const activityEvents = events.filter(e => e.type !== 'leave' && e.type !== 'reconnect');
  const timeline = buildTimeline(activityEvents, 30000, submittedAt);
  const blurIntervals = buildBlurIntervals(activityEvents);

  // ── Session Summary ──
  const avgWPM = totalDurationSec > 0
    ? Math.round((effectiveTextLength / 5) / (totalDurationSec / 60))
    : 0;

  const sessionSummary: SessionSummary = {
    totalDurationSec: Math.round(totalDurationSec),
    sessionCount: reconnectCount + 1,
    totalKeystrokes: totalKeydowns,
    totalCharactersTyped: effectiveTextLength,
    averageWPM: avgWPM,
  };

  // ── Verdict ──
  let { verdict, verdictDetail } = generateVerdict(
    flagiaScore,
    flagStatus,
    { cv: cvScore, rr: rrScore, paste: pasteScore, blur: blurScore, time: timeScore },
    mode
  );
  if (transcriptionSeverity > 0.4) {
    verdictDetail += ` ⚠️ 충분한 분량의 글이 거의 수정 없이 한 번에 입력되었습니다(수정 비율 ${revisionRatio.toFixed(2)}). 타이핑 리듬은 사람과 유사하더라도, 이는 외부 화면의 글을 보며 손으로 그대로 옮겨 쓴(베껴 쓰기) 경우의 전형적 패턴입니다. 직접 확인이 필요합니다.`;
  }

  return {
    version: 3,
    flagiaScore,
    baseScore,
    scoreAdjustments,
    transcription,
    flagStatus,
    coefficientOfVariation: Math.round(cv * 1000000) / 1000000,
    revisionRatio: Math.round(revisionRatio * 10000) / 10000,
    totalPasteCount,
    totalBlurDuration: Math.round(totalBlurDuration * 100) / 100,
    totalBlurCount: blurCount,
    components,
    timeline,
    blurIntervals,
    sessionSummary,
    verdict,
    verdictDetail,
  };
}

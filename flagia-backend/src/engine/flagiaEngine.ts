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
  flagiaScore: number;
  flagStatus: 'GREEN' | 'AMBER' | 'RED';
  coefficientOfVariation: number;
  revisionRatio: number;
  totalPasteCount: number;
  totalBlurDuration: number;
  // v2 additions
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

// Mode-specific weight adjustments
const MODE_WEIGHTS: Record<string, { cvWeight: number; rrWeight: number; pasteWeight: number; blurWeight: number }> = {
  STRICT:   { cvWeight: 0.35, rrWeight: 0.25, pasteWeight: 0.25, blurWeight: 0.15 },
  STANDARD: { cvWeight: 0.30, rrWeight: 0.25, pasteWeight: 0.25, blurWeight: 0.20 },
  RESEARCH: { cvWeight: 0.25, rrWeight: 0.20, pasteWeight: 0.30, blurWeight: 0.25 },
  CREATIVE: { cvWeight: 0.20, rrWeight: 0.30, pasteWeight: 0.25, blurWeight: 0.25 },
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
 * Human typing typically has Cv between 0.3-0.8
 * Very low Cv (< 0.1) suggests automated input
 * Very high Cv (> 1.5) suggests copy-paste bursts
 */
function scoreCv(cv: number): number {
  // Smooth bell-curve scorer centered on the natural range (0.3-0.8)
  // Uses linear interpolation instead of hard step thresholds
  if (cv >= 0.3 && cv <= 0.8) return 100;       // Natural human range — perfect

  // Below natural range: smooth degradation
  if (cv < 0.3 && cv >= 0.2) {
    return 85 + ((cv - 0.2) / 0.1) * 15;         // 85 → 100 linear
  }
  if (cv < 0.2 && cv >= 0.1) {
    return 50 + ((cv - 0.1) / 0.1) * 35;         // 50 → 85 linear
  }
  if (cv < 0.1) {
    return Math.max(10, 50 * (cv / 0.1));        // 0 → 50 linear, floor 10
  }

  // Above natural range: smooth degradation
  if (cv > 0.8 && cv <= 1.0) {
    return 80 + ((1.0 - cv) / 0.2) * 20;         // 80 → 100 linear
  }
  if (cv > 1.0 && cv <= 1.5) {
    return 30 + ((1.5 - cv) / 0.5) * 50;         // 30 → 80 linear
  }
  // cv > 1.5: erratic bursts
  return Math.max(10, 30 - (cv - 1.5) * 15);    // degrades from 30
}

function getCvDescription(cv: number): string {
  if (cv >= 0.3 && cv <= 0.8) return '자연스러운 사람의 타이핑 리듬이 관찰됩니다. 키 입력 간격의 변동이 사람의 일반적인 범위 내에 있습니다.';
  if (cv >= 0.2 && cv < 0.3) return '타이핑 리듬이 약간 균일하지만, 대부분의 자연스러운 타이핑 패턴과 일치합니다.';
  if (cv > 0.8 && cv <= 1.0) return '타이핑 리듬에 다소 높은 변동이 관찰됩니다. 간헐적인 사고나 수정 작업이 포함된 것으로 보입니다.';
  if (cv >= 0.1 && cv < 0.2) return '타이핑 리듬이 상당히 균일합니다. 미리 작성된 텍스트를 옮겨 쓰고 있을 가능성이 있습니다.';
  if (cv > 1.0 && cv <= 1.5) return '키 입력 간격의 변동이 매우 큽니다. 외부 소스에서 간헐적으로 복사했을 가능성이 있습니다.';
  if (cv < 0.1) return '키 입력이 기계적으로 균일합니다. 자동 입력 도구나 매크로 사용이 의심됩니다.';
  return '키 입력 패턴이 매우 불규칙합니다. 대량 복사-붙여넣기 후 간헐적 수정 패턴이 관찰됩니다.';
}

/**
 * Score component: Revision Ratio
 * Typical human writing: RR ≈ 1.2-2.5 (edits, backspaces, corrections)
 */
function scoreRevisionRatio(rr: number): number {
  if (rr >= 1.2 && rr <= 2.5) return 100;
  if (rr >= 1.1 && rr < 1.2) return 75;
  if (rr > 2.5 && rr <= 3.5) return 80;
  if (rr > 3.5 && rr <= 5.0) return 60;
  if (rr < 1.1 && rr >= 1.0) return 50;
  if (rr < 1.0) return 20;                       // Less keystrokes than chars = definite paste
  return 40;                                      // rr > 5.0
}

function getRrDescription(rr: number): string {
  if (rr >= 1.2 && rr <= 2.5) return '적절한 수준의 수정과 편집이 이루어졌습니다. 글을 쓰면서 자연스럽게 내용을 다듬은 흔적이 보입니다.';
  if (rr >= 1.1 && rr < 1.2) return '수정이 거의 없이 한 번에 작성된 것으로 보입니다. 사전에 다른 곳에서 글을 준비했을 수 있습니다.';
  if (rr > 2.5 && rr <= 3.5) return '평균보다 많은 수정이 있었습니다. 글을 신중하게 다듬은 것으로 판단됩니다.';
  if (rr > 3.5 && rr <= 5.0) return '상당한 양의 수정 작업이 관찰됩니다. 글의 구조를 크게 변경하며 작성한 것으로 보입니다.';
  if (rr < 1.1 && rr >= 1.0) return '키 입력 수가 최종 텍스트 길이와 거의 같습니다. 이미 완성된 글을 단순히 옮겨 적었을 가능성이 높습니다.';
  if (rr < 1.0) return '키 입력 수가 최종 텍스트 길이보다 적습니다. 붙여넣기를 통해 대부분의 내용이 입력되었습니다.';
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

function getBlurDescription(totalSeconds: number): string {
  if (totalSeconds < 30) return '작성 중 화면 이탈이 거의 없었습니다. 집중해서 글을 작성한 것으로 판단됩니다.';
  if (totalSeconds < 60) return `총 ${Math.round(totalSeconds)}초간 화면을 이탈했습니다. 짧은 참고 활동 정도로 보입니다.`;
  if (totalSeconds < 120) return `총 ${Math.round(totalSeconds)}초간 화면을 이탈했습니다. 외부 자료를 참고하며 작성한 것으로 보입니다.`;
  if (totalSeconds < 300) return `총 ${Math.round(totalSeconds / 60)}분간 화면을 이탈했습니다. 상당한 시간을 다른 곳에서 보냈습니다.`;
  return `총 ${Math.round(totalSeconds / 60)}분간 화면을 이탈했습니다. 작성 시간의 상당 부분을 외부에서 활동한 것으로 의심됩니다.`;
}

function getComponentStatus(score: number): 'good' | 'warning' | 'danger' {
  if (score >= 70) return 'good';
  if (score >= 40) return 'warning';
  return 'danger';
}

/**
 * Build writing timeline — aggregate into 30-second buckets
 */
function buildTimeline(events: TelemetryEvent[], bucketSizeMs = 30000): TimelineBucket[] {
  if (events.length === 0) return [];

  const timestamps = events.map(e => e.timestamp).filter(t => t > 0);
  if (timestamps.length === 0) return [];

  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);

  const buckets: TimelineBucket[] = [];
  let currentStart = minTime;

  while (currentStart < maxTime + bucketSizeMs) {
    const currentEnd = currentStart + bucketSizeMs;
    const bucketEvents = events.filter(e => e.timestamp >= currentStart && e.timestamp < currentEnd);
    
    const keystrokes = bucketEvents.filter(e => e.type === 'keydown').length;
    const ikiValues = bucketEvents
      .filter(e => e.type === 'keydown' && e.iki > 0 && e.iki < 30000)
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
  cv: number,
  rr: number,
  pasteCount: number,
  blurSeconds: number,
  mode: string
): { verdict: string; verdictDetail: string } {
  let verdict: string;
  let details: string[] = [];

  if (flagStatus === 'GREEN') {
    verdict = '이 제출물은 자연스러운 사람의 글쓰기 패턴을 보여줍니다.';
    details.push('키스트로크 리듬, 수정 빈도, 집중 시간 등 모든 지표가 정상 범위 내에 있습니다.');
  } else if (flagStatus === 'AMBER') {
    verdict = '이 제출물에서 일부 비정상적인 패턴이 감지되었습니다.';
    const issues: string[] = [];
    if (scoreCv(cv) < 70) issues.push('타이핑 리듬');
    if (scoreRevisionRatio(rr) < 70) issues.push('수정 패턴');
    if (scorePasteCount(pasteCount) < 70) issues.push('외부 콘텐츠');
    if (scoreBlurDuration(blurSeconds) < 70) issues.push('화면 이탈');
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

/**
 * Main analysis function
 */
export function runFlagiaAnalysis(
  events: TelemetryEvent[],
  finalMarkdown: string,
  templateText: string,
  mode: string
): AnalysisResult {
  const weights = MODE_WEIGHTS[mode] || MODE_WEIGHTS.STANDARD;
  const thresholds = MODE_THRESHOLDS[mode] || MODE_THRESHOLDS.STANDARD;

  // ── Template offset: strip template text length from final text count ──
  const templateLength = (templateText || '').length;
  const effectiveTextLength = Math.max(1, finalMarkdown.length - templateLength);

  // ── IKI values: only keydown events with valid IKI ──
  const ikiValues = events
    .filter((e) => e.type === 'keydown' && e.iki > 0 && e.iki < 30000)
    .map((e) => e.iki);

  const cv = computeCv(ikiValues);

  // ── Revision Ratio: total keydown count / effective text length ──
  const totalKeydowns = events.filter((e) => e.type === 'keydown').length;
  const revisionRatio = effectiveTextLength > 0 
    ? totalKeydowns / effectiveTextLength 
    : 0;

  // ── Paste Detection (count + total volume) ──
  let totalPasteCount = 0;
  let totalPastedLength = 0;
  for (const event of events) {
    if (event.type === 'paste') {
      const isCbPaste = event.meta?.actionType === 'codeblock' || event.meta?.actionType === 'CB';
      if (!isCbPaste) {
        totalPasteCount++;
        totalPastedLength += event.meta?.pasteLength || 0;
      }
    }
  }

  // ── Blur Duration ──
  let totalBlurDuration = 0;
  let lastBlurTime: number | null = null;

  for (const event of events) {
    if (event.type === 'blur') {
      lastBlurTime = event.timestamp;
    } else if (event.type === 'focus' && lastBlurTime !== null) {
      const blurMs = event.timestamp - lastBlurTime;
      if (blurMs > 0 && blurMs < 3600000) {
        totalBlurDuration += blurMs / 1000;
      }
      lastBlurTime = null;
    }
  }

  // ── Component Scores ──
  const cvScore = scoreCv(cv);
  const rrScore = scoreRevisionRatio(revisionRatio);
  const pasteCountScore = scorePasteCount(totalPasteCount);
  const pasteVolumeScore = scorePasteVolume(totalPastedLength, effectiveTextLength);
  // Blend count and volume: volume is weighted higher (60/40) since it captures severity better
  const pasteScore = Math.round(pasteVolumeScore * 0.6 + pasteCountScore * 0.4);
  const blurScore = scoreBlurDuration(totalBlurDuration);

  // ── Composite Flagia Score ──
  let flagiaScore = 
    cvScore * weights.cvWeight +
    rrScore * weights.rrWeight +
    pasteScore * weights.pasteWeight +
    blurScore * weights.blurWeight;

  flagiaScore = Math.round(Math.max(0, Math.min(100, flagiaScore)) * 100) / 100;

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
      description: getCvDescription(cv),
      status: getComponentStatus(cvScore),
    } as ComponentScore,
    revisionIntensity: {
      raw: rrScore,
      weighted: Math.round(rrScore * weights.rrWeight * 100) / 100,
      weight: weights.rrWeight,
      label: '수정 강도',
      description: getRrDescription(revisionRatio),
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
      description: getBlurDescription(totalBlurDuration),
      status: getComponentStatus(blurScore),
    } as ComponentScore,
  };

  // ── Timeline & blur intervals ──
  const timeline = buildTimeline(events);
  const blurIntervals = buildBlurIntervals(events);

  // ── Session Summary ──
  const timestamps = events.map(e => e.timestamp).filter(t => t > 0);
  const totalDurationSec = timestamps.length >= 2
    ? (Math.max(...timestamps) - Math.min(...timestamps)) / 1000
    : 0;
  const avgWPM = totalDurationSec > 0
    ? Math.round((effectiveTextLength / 5) / (totalDurationSec / 60))
    : 0;

  const sessionSummary: SessionSummary = {
    totalDurationSec: Math.round(totalDurationSec),
    sessionCount: 1,
    totalKeystrokes: totalKeydowns,
    totalCharactersTyped: effectiveTextLength,
    averageWPM: avgWPM,
  };

  // ── Verdict ──
  const { verdict, verdictDetail } = generateVerdict(
    flagiaScore, flagStatus, cv, revisionRatio, totalPasteCount, totalBlurDuration, mode
  );

  return {
    flagiaScore,
    flagStatus,
    coefficientOfVariation: Math.round(cv * 1000000) / 1000000,
    revisionRatio: Math.round(revisionRatio * 10000) / 10000,
    totalPasteCount,
    totalBlurDuration: Math.round(totalBlurDuration * 100) / 100,
    components,
    timeline,
    blurIntervals,
    sessionSummary,
    verdict,
    verdictDetail,
  };
}

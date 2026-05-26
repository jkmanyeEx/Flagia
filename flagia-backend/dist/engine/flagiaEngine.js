"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFlagiaAnalysis = runFlagiaAnalysis;
// Keys that are not typed content and should be excluded from rhythm analysis.
// NOTE: 'Process'/'Unidentified'/'Dead' are NOT excluded — Korean (and other IME)
// input fires keydown with key='Process' during composition. Those are REAL
// content keystrokes (each jamo is a press), and their inter-keystroke timing IS
// the typing rhythm. Excluding them dropped all Korean keystrokes → Cv = 0.
const NON_CONTENT_KEYS = new Set([
    'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape',
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete', 'Backspace',
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
    'ContextMenu', 'Pause', 'ScrollLock', 'NumLock', 'PrintScreen',
]);
// IKI samples beyond this are treated as "thinking pauses", not typing rhythm.
// Korean typing is naturally bimodal (intra-syllable ~50ms, inter-word ~300ms);
// allowing multi-second pauses inflates Cv and unfairly penalizes real writers.
const IKI_CEILING_MS = 2000;
// Mode-specific weight adjustments. timeWeight added so writing-pace can
// down-score submissions that arrive far too fast for their length.
const MODE_WEIGHTS = {
    STRICT: { cvWeight: 0.30, rrWeight: 0.20, pasteWeight: 0.20, blurWeight: 0.15, timeWeight: 0.15 },
    STANDARD: { cvWeight: 0.25, rrWeight: 0.20, pasteWeight: 0.20, blurWeight: 0.20, timeWeight: 0.15 },
    RESEARCH: { cvWeight: 0.20, rrWeight: 0.15, pasteWeight: 0.30, blurWeight: 0.20, timeWeight: 0.15 },
    CREATIVE: { cvWeight: 0.20, rrWeight: 0.25, pasteWeight: 0.20, blurWeight: 0.20, timeWeight: 0.15 },
};
// Mode-specific flag thresholds
const MODE_THRESHOLDS = {
    STRICT: { green: 75, amber: 50 },
    STANDARD: { green: 70, amber: 40 },
    RESEARCH: { green: 60, amber: 35 },
    CREATIVE: { green: 55, amber: 30 },
};
/**
 * Compute Coefficient of Variation for IKI values
 * Cv = σ / μ (with division-by-zero guard)
 */
function computeCv(ikiValues) {
    if (ikiValues.length < 2)
        return 0;
    const n = ikiValues.length;
    const mean = ikiValues.reduce((a, b) => a + b, 0) / n;
    // Guard: if mean is effectively zero, return 0
    if (mean < 1)
        return 0;
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
function scoreCv(cv) {
    // Sweet spot: natural human variation
    if (cv >= 0.4 && cv <= 0.9)
        return 100;
    // ── Below the natural range = COPY-TYPING danger zone ──
    // A human composing their own thoughts is bimodal: fast jamo/letter bursts
    // punctuated by cognitive micro-pauses (500–1500ms) at idea/word boundaries.
    // That bimodality keeps Cv up. A near-uniform low Cv means the keystrokes
    // were almost certainly read off-screen and transcribed (사서 베껴 치기), so
    // the penalty here is deliberately harsh.
    if (cv >= 0.3 && cv < 0.4) {
        return Math.round(70 + ((cv - 0.3) / 0.1) * 30); // 70 → 100
    }
    // Suspiciously consistent — strong copy-typing signal.
    if (cv >= 0.2 && cv < 0.3) {
        return Math.round(22 + ((cv - 0.2) / 0.1) * 33); // 22 → 55
    }
    // Very uniform — copy-typing / automated transcription.
    if (cv >= 0.1 && cv < 0.2) {
        return Math.round(6 + ((cv - 0.1) / 0.1) * 16); // 6 → 22
    }
    // Machine-like uniformity.
    if (cv < 0.1) {
        return Math.max(2, Math.round(6 * (cv / 0.1))); // 0 → 6
    }
    // ── Above the natural range = treated leniently ──
    // A HIGH Cv just means very uneven keystroke timing — most often a student
    // who pauses to think between bursts (정상적인 사고 멈춤). Genuine external
    // copying/reference behaviour is already captured by the focus (blur) and
    // external-content (paste) components, so penalizing high Cv here would
    // double-count. We keep a gentle taper with a generous floor.
    if (cv > 0.9 && cv <= 1.3) {
        return Math.round(90 + ((1.3 - cv) / 0.4) * 10); // 90 → 100
    }
    if (cv > 1.3 && cv <= 2.0) {
        return Math.round(78 + ((2.0 - cv) / 0.7) * 12); // 78 → 90
    }
    // Very erratic — still only a mild deduction (floor 70).
    return Math.max(70, Math.round(78 - (cv - 2.0) * 4));
}
/**
 * Cv description must reflect the FINAL score (after confidence scaling),
 * not just raw cv. Otherwise we get "good" scores paired with "very erratic /
 * paste pattern" text, confusing teachers.
 */
function getCvDescription(cv, finalScore, rhythmConfidence, sampleCount) {
    // Low-confidence path: too few keystrokes or paste-dominated. The Cv number
    // is statistically meaningless here — explain that.
    if (rhythmConfidence < 0.5) {
        if (sampleCount < 10) {
            return `타이핑 표본이 너무 적습니다(${sampleCount}회). 직접 타이핑한 내용이 거의 없어 리듬을 판정할 수 없습니다.`;
        }
        return '최종 텍스트에 비해 직접 타이핑한 키 입력이 현저히 적습니다. 대부분의 내용이 외부에서 가져온 것으로 의심되어 리듬 분석 신뢰도가 매우 낮습니다.';
    }
    // High-confidence path: describe by score tier so text matches the number.
    if (finalScore >= 85)
        return '자연스러운 사람의 타이핑 리듬이 관찰됩니다. 키 입력 간격의 변동이 사람의 일반적인 범위 내에 있습니다.';
    if (finalScore >= 70) {
        if (cv > 1.1)
            return '키 입력 간격의 편차가 큽니다. 중간중간 충분히 생각하며(사고 멈춤) 작성한 것으로 보이는 자연스러운 패턴입니다.';
        return '대체로 자연스러운 타이핑 리듬입니다. 일반적인 사람의 작성 패턴 범위에 해당합니다.';
    }
    if (finalScore >= 50) {
        return '타이핑 속도가 다소 일정합니다. 미리 작성된 텍스트를 보고 옮겨 치고 있을 가능성이 있습니다.';
    }
    // Low score → suspiciously uniform (high Cv is no longer penalized into this
    // tier — it's treated as thinking pauses above).
    if (cv < 0.1)
        return '키 입력이 기계적으로 균일합니다. 자동 입력 도구나 매크로 사용이 강하게 의심됩니다.';
    return '타이핑 리듬이 비정상적으로 균일합니다. 외부의 글을 보며 그대로 옮겨 쓴(베껴 쓰기) 패턴이 의심됩니다.';
}
/**
 * Score component: Revision Ratio
 * Typical human writing: RR ≈ 1.2-2.5 (edits, backspaces, corrections)
 */
function scoreRevisionRatio(rr) {
    // Genuine composition is MESSY: writers delete, rewrite, reorder, fix — so
    // total keystrokes substantially exceed the final length (RR ≈ 1.6–3+).
    // Copy-typing (reading text off-screen and transcribing it) is near-LINEAR:
    // each character typed roughly once, almost no revision → RR ≈ 1.0–1.2.
    // So a very low RR is a transcription signal, not "clean writing".
    if (rr <= 0)
        return 50; // no usable data
    if (rr < 1.0)
        return 10; // keystrokes < text → pasted
    if (rr < 1.15)
        return Math.round(18 + ((rr - 1.0) / 0.15) * 14); // 18→32  copy-typing zone
    if (rr < 1.4)
        return Math.round(32 + ((rr - 1.15) / 0.25) * 28); // 32→60
    if (rr < 1.6)
        return Math.round(60 + ((rr - 1.4) / 0.2) * 40); // 60→100
    if (rr <= 3.0)
        return 100; // healthy composition
    if (rr <= 5.0)
        return Math.round(100 - ((rr - 3.0) / 2.0) * 40); // 100→60
    return Math.max(30, Math.round(60 - (rr - 5.0) * 8)); // >5 erratic
}
function getRrDescription(rr) {
    if (rr < 1.0)
        return '키 입력 수가 최종 텍스트 길이보다 적습니다. 붙여넣기를 통해 대부분의 내용이 입력되었습니다.';
    if (rr < 1.15)
        return '수정 흔적이 거의 없이 최종 글이 사실상 한 번에 그대로 입력되었습니다. 직접 구상하며 쓴 글은 보통 더 많은 삭제·재작성을 동반하므로, 외부의 글을 보며 그대로 옮겨 친(베껴 쓰기) 정황이 의심됩니다.';
    if (rr < 1.4)
        return '수정·편집 활동이 평균보다 현저히 적습니다. 자연스러운 작문 과정이라기보다 미리 준비된 텍스트를 옮겨 적었을 가능성이 있습니다.';
    if (rr < 1.6)
        return '다소 적은 수준의 수정이 있었습니다. 비교적 정돈된 작성 과정입니다.';
    if (rr <= 3.0)
        return '적절한 수준의 수정과 편집이 이루어졌습니다. 글을 쓰면서 자연스럽게 내용을 다듬은 흔적이 보입니다.';
    if (rr <= 5.0)
        return '상당한 양의 수정 작업이 관찰됩니다. 글의 구조를 크게 변경하며 작성한 것으로 보입니다.';
    return '매우 많은 수정이 있었습니다. 글을 반복적으로 재작성한 것으로 보입니다.';
}
/**
 * Score component: Paste Count
 */
function scorePasteCount(count) {
    if (count === 0)
        return 100;
    if (count <= 2)
        return 80;
    if (count <= 5)
        return 60;
    if (count <= 10)
        return 40;
    return Math.max(0, 30 - (count - 10) * 2);
}
/**
 * Score component: Paste Volume (total pasted length vs final text length)
 * This measures the RATIO of pasted content to final text, not just event count.
 * A single large paste is more suspicious than many small ones.
 */
function scorePasteVolume(totalPastedLength, finalTextLength) {
    if (totalPastedLength === 0)
        return 100;
    const ratio = finalTextLength > 0 ? totalPastedLength / finalTextLength : 1;
    if (ratio < 0.05)
        return 95; // < 5% pasted — negligible
    if (ratio < 0.15)
        return 80; // < 15% pasted — minor references
    if (ratio < 0.30)
        return 60; // < 30% pasted — noticeable
    if (ratio < 0.50)
        return 40; // < 50% pasted — significant
    if (ratio < 0.75)
        return 20; // < 75% pasted — majority pasted
    return 5; // >= 75% pasted — nearly all external
}
function getPasteDescription(count, totalPastedLength, finalTextLength) {
    const ratio = finalTextLength > 0 ? Math.round((totalPastedLength / finalTextLength) * 100) : 0;
    if (count === 0)
        return '외부에서 텍스트를 붙여넣기한 흔적이 없습니다. 모든 내용이 직접 타이핑으로 작성되었습니다.';
    if (ratio < 10)
        return `${count}회의 붙여넣기가 감지되었습니다 (전체의 약 ${ratio}%). 소량의 인용이나 참고 내용 삽입으로 보입니다.`;
    if (ratio < 30)
        return `${count}회의 붙여넣기가 감지되었습니다 (전체의 약 ${ratio}%). 외부 소스에서 내용을 가져온 것으로 보입니다.`;
    if (ratio < 60)
        return `${count}회의 붙여넣기가 감지되었습니다 (전체의 약 ${ratio}%). 상당 부분이 외부에서 작성된 내용일 수 있습니다.`;
    return `${count}회의 붙여넣기로 전체의 약 ${ratio}%가 외부에서 복사되었습니다. 대부분의 내용이 외부에서 작성된 것으로 의심됩니다.`;
}
/**
 * Score component: Blur Duration
 */
function scoreBlurDuration(totalSeconds) {
    if (totalSeconds < 30)
        return 100;
    if (totalSeconds < 60)
        return 90;
    if (totalSeconds < 120)
        return 75;
    if (totalSeconds < 300)
        return 60;
    if (totalSeconds < 600)
        return 40;
    return Math.max(0, 30 - Math.floor((totalSeconds - 600) / 60));
}
function getBlurDescription(totalSeconds) {
    if (totalSeconds < 30)
        return '작성 중 화면 이탈이 거의 없었습니다. 집중해서 글을 작성한 것으로 판단됩니다.';
    if (totalSeconds < 60)
        return `총 ${Math.round(totalSeconds)}초간 화면을 이탈했습니다. 짧은 참고 활동 정도로 보입니다.`;
    if (totalSeconds < 120)
        return `총 ${Math.round(totalSeconds)}초간 화면을 이탈했습니다. 외부 자료를 참고하며 작성한 것으로 보입니다.`;
    if (totalSeconds < 300)
        return `총 ${Math.round(totalSeconds / 60)}분간 화면을 이탈했습니다. 상당한 시간을 다른 곳에서 보냈습니다.`;
    return `총 ${Math.round(totalSeconds / 60)}분간 화면을 이탈했습니다. 작성 시간의 상당 부분을 외부에서 활동한 것으로 의심됩니다.`;
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
function scoreWritingTime(durationSec, textLength) {
    if (textLength < 50)
        return 100; // not enough content to judge
    if (durationSec < 5)
        return 5; // submitted before they could type
    const cpm = textLength / (durationSec / 60);
    if (cpm <= 200)
        return 100; // natural human pace
    if (cpm <= 300)
        return 85; // fast but plausible
    if (cpm <= 500)
        return 55; // very fast — paste-and-edit likely
    if (cpm <= 800)
        return 25;
    return 10; // unrealistic for human typing
}
function getTimeDescription(durationSec, textLength) {
    if (textLength < 50)
        return '판정할 만큼 충분한 글자 수가 아닙니다.';
    if (durationSec < 5)
        return '작성 시간이 비정상적으로 짧습니다. 사실상 타이핑 없이 제출된 것으로 보입니다.';
    const cpm = Math.round(textLength / (durationSec / 60));
    const mins = Math.max(1, Math.round(durationSec / 60));
    if (cpm <= 200)
        return `약 ${mins}분 동안 분당 ${cpm}자를 작성했습니다. 사람의 일반적인 글쓰기 속도입니다.`;
    if (cpm <= 300)
        return `분당 약 ${cpm}자로 다소 빠르지만 사람이 작성할 수 있는 범위입니다.`;
    if (cpm <= 500)
        return `분당 약 ${cpm}자로 매우 빠른 속도입니다. 외부에서 작성된 글을 옮겼거나 부분적으로 붙여넣었을 가능성이 있습니다.`;
    if (cpm <= 800)
        return `분당 약 ${cpm}자입니다. 사람이 실시간으로 타이핑한 속도라고 보기 어렵습니다.`;
    return `분당 약 ${cpm}자로 사람이 작성할 수 없는 속도입니다. 대부분의 내용이 외부에서 작성되어 한 번에 입력된 것으로 의심됩니다.`;
}
/**
 * Drop the trailing unpaired blur event that fires when the student clicks
 * the "제출" button — the editor loses focus before the submit completes,
 * but no matching focus event ever returns. Counting this as an editor
 * leave produces a spurious yellow bucket at the end of every timeline.
 */
function stripSubmitInducedBlur(events) {
    let openBlurIdx = -1;
    for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (e.type === 'blur')
            openBlurIdx = i;
        else if (e.type === 'focus')
            openBlurIdx = -1;
    }
    if (openBlurIdx < 0)
        return events;
    // If the unmatched blur is also the last event (or only followed by
    // non-focus/keydown events), treat it as submit-induced and drop it.
    const hasFocusOrInputAfter = events.slice(openBlurIdx + 1).some(e => e.type === 'focus' || e.type === 'keydown' || e.type === 'paste');
    if (hasFocusOrInputAfter)
        return events;
    return events.slice(0, openBlurIdx).concat(events.slice(openBlurIdx + 1));
}
function getComponentStatus(score) {
    if (score >= 70)
        return 'good';
    if (score >= 40)
        return 'warning';
    return 'danger';
}
/**
 * Build writing timeline — aggregate into 30-second buckets
 */
function buildTimeline(events, bucketSizeMs = 30000, submittedAt) {
    if (events.length === 0)
        return [];
    const timestamps = events.map(e => e.timestamp).filter(t => t > 0);
    if (timestamps.length === 0)
        return [];
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    let endT = maxTime + bucketSizeMs;
    if (submittedAt) {
        const parsedSub = new Date(submittedAt).getTime();
        if (!isNaN(parsedSub) && parsedSub > minTime) {
            endT = parsedSub;
        }
    }
    const buckets = [];
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
        if (bucketSizeMs <= 0)
            break;
    }
    return buckets;
}
/**
 * Build blur interval list
 */
function buildBlurIntervals(events) {
    const intervals = [];
    let lastBlurTime = null;
    const minTime = events.length > 0 ? Math.min(...events.map(e => e.timestamp).filter(t => t > 0)) : 0;
    for (const event of events) {
        if (event.type === 'blur') {
            lastBlurTime = event.timestamp;
        }
        else if (event.type === 'focus' && lastBlurTime !== null) {
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
function generateVerdict(flagiaScore, flagStatus, scores, mode) {
    let verdict;
    let details = [];
    if (flagStatus === 'GREEN') {
        verdict = '이 제출물은 자연스러운 사람의 글쓰기 패턴을 보여줍니다.';
        details.push('키스트로크 리듬, 수정 빈도, 집중 시간, 작성 속도 등 모든 지표가 정상 범위 내에 있습니다.');
    }
    else if (flagStatus === 'AMBER') {
        verdict = '이 제출물에서 일부 비정상적인 패턴이 감지되었습니다.';
        const issues = [];
        if (scores.cv < 70)
            issues.push('타이핑 리듬');
        if (scores.rr < 70)
            issues.push('수정 패턴');
        if (scores.paste < 70)
            issues.push('외부 콘텐츠');
        if (scores.blur < 70)
            issues.push('화면 이탈');
        if (scores.time < 70)
            issues.push('작성 시간');
        if (issues.length > 0)
            details.push(`주의가 필요한 영역: ${issues.join(', ')}`);
        details.push('추가적인 확인이 권장되지만, 단독으로 부정행위를 판단하기에는 불충분합니다.');
    }
    else {
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
function isContentChar(k) {
    if (!k || k.length !== 1)
        return false;
    // Hangul syllables + compatibility jamo, latin letters, digits.
    return /[가-힣㄰-㆏0-9A-Za-z]/.test(k);
}
const PAUSE_DELIMITERS = new Set([
    ' ', ' ', '\n', 'Enter', '\t',
    '.', ',', '!', '?', ';', ':', ')', ']', '}', '(', '[', '{',
    '"', "'", '。', '、', '·', '…', '~', '-', '/',
]);
function isPauseDelimiter(k) {
    return !!k && PAUSE_DELIMITERS.has(k);
}
function analyzePauseAlignment(events) {
    const PAUSE_MIN_MS = 500; // below this is motor rhythm, not cognition
    const PAUSE_MAX_MS = 10000; // above this is AFK / tab-switch, not a "thinking pause"
    let cognitive = 0;
    let midWord = 0;
    let prevKey = null; // last "flow" key (content or delimiter)
    for (const e of events) {
        if (e.type !== 'keydown')
            continue;
        const k = e.meta?.key;
        // Only the writing flow matters: skip modifiers, arrows, backspace, etc.
        if (!isContentChar(k) && !isPauseDelimiter(k))
            continue;
        if (e.iki > PAUSE_MIN_MS && e.iki < PAUSE_MAX_MS) {
            cognitive++;
            const atBoundary = isPauseDelimiter(prevKey) || isPauseDelimiter(k);
            if (!atBoundary && isContentChar(prevKey) && isContentChar(k))
                midWord++;
        }
        prevKey = k ?? null;
    }
    // Too few pauses to judge → neutral (no penalty).
    if (cognitive < 8)
        return { cognitivePauses: cognitive, midWordPauses: midWord, midWordRatio: 0, score: 100 };
    const midWordRatio = midWord / cognitive;
    // Allow ~15% mid-word pauses as natural; penalize sharply beyond that.
    // 0.15→100, 0.50→44, 0.70→12, 0.85→0
    const score = Math.max(0, Math.min(100, Math.round(100 - (midWordRatio - 0.15) * 160)));
    return { cognitivePauses: cognitive, midWordPauses: midWord, midWordRatio, score };
}
/**
 * Calculate expected keystroke count normalized for language (specifically Korean Hangul)
 */
function getExpectedKeystrokeCount(text) {
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
            }
            else {
                keystrokes += 1;
            }
            // jongseong: if present, check if compound (2 keystrokes) or single (1 keystroke)
            if (jongIdx > 0) {
                if ([3, 5, 6, 9, 10, 11, 12, 13, 14, 15, 18].includes(jongIdx)) {
                    keystrokes += 2;
                }
                else {
                    keystrokes += 1;
                }
            }
            count += keystrokes;
        }
        else if (code >= 0x3131 && code <= 0x318E) {
            // Compatibility Jamo (typically typed as 1 keystroke)
            count += 1;
        }
        else if (char === '\r') {
            continue;
        }
        else {
            // All other characters (ASCII, Latin, spaces, punctuation, etc.)
            count += 1;
        }
    }
    return Math.max(1, count);
}
/**
 * Main analysis function
 */
function runFlagiaAnalysis(rawEvents, finalMarkdown, templateText, mode, submittedAt) {
    // Deduplicate consecutive keydown events of the exact same key that occur within 15ms
    const cleanedEvents = [];
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
    // ── Template offset: strip HTML tags to get real text length ──
    const plainText = finalMarkdown.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    // Strip HTML from template to do a proper text-to-text comparison
    const plainTemplate = (templateText || '')
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
    const contentKeydowns = events.filter((e) => e.type === 'keydown' && e.meta?.key && !NON_CONTENT_KEYS.has(e.meta.key));
    const ikiValues = contentKeydowns
        .filter((e) => e.iki > 0 && e.iki < IKI_CEILING_MS)
        .map((e) => e.iki);
    const cv = computeCv(ikiValues);
    // ── Revision Ratio: total keydown count / effective expected keystrokes ──
    const revisionRatio = effectiveExpectedKeystrokes > 0
        ? totalKeydowns / effectiveExpectedKeystrokes
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
    let lastBlurTime = null;
    for (const event of events) {
        if (event.type === 'blur') {
            lastBlurTime = event.timestamp;
        }
        else if (event.type === 'focus' && lastBlurTime !== null) {
            const blurMs = event.timestamp - lastBlurTime;
            if (blurMs > 0 && blurMs < 3600000) {
                totalBlurDuration += blurMs / 1000;
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
    const pasteTimes = events.filter(e => e.type === 'paste').map(e => e.timestamp);
    let pasteAdjacentKeydowns = 0;
    if (pasteTimes.length > 0) {
        for (const e of events) {
            if (e.type !== 'keydown')
                continue;
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
    const blurScore = scoreBlurDuration(totalBlurDuration);
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
        if (t !== 'leave' && t !== 'reconnect')
            lastActivityIdx = i;
    }
    let disconnectedMs = 0;
    let reconnectCount = 0;
    let pendingLeave = null;
    for (let i = 0; i < events.length; i++) {
        const e = events[i];
        if (e.type === 'leave') {
            if (pendingLeave === null) {
                pendingLeave = e.timestamp;
            }
        }
        else if (e.type === 'reconnect') {
            reconnectCount++;
            // Count the gap only if real activity continues after this reconnect.
            if (pendingLeave !== null && i < lastActivityIdx) {
                const gap = e.timestamp - pendingLeave;
                if (gap > 0 && gap < 86400000)
                    disconnectedMs += gap; // ignore >24h / negative
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
    // ── Composite Flagia Score ──
    // baseScore is the weighted sum of the 5 components (what the component cards
    // add up to). Structural penalties are then recorded as explicit adjustments
    // so the final score always reconciles: final = baseScore + Σ adjustments.
    const weightedSum = cvScore * weights.cvWeight +
        rrScore * weights.rrWeight +
        pasteScore * weights.pasteWeight +
        blurScore * weights.blurWeight +
        timeScore * weights.timeWeight;
    const baseScore = Math.round(Math.max(0, Math.min(100, weightedSum)) * 100) / 100;
    const scoreAdjustments = [];
    let flagiaScore = baseScore;
    // ── Linear-transcription (copy-typing) structural penalty ──
    // The hardest cheat: read AI text off a second screen and type it by hand.
    // The keystrokes are genuinely human, so Cv/rhythm look fine and there's no
    // paste — the weighted sum stays green. But a SUBSTANTIAL, polished text typed
    // almost verbatim (very low revision) is the transcription signature: real
    // composition is messy (deletes/rewrites → higher RR). When that pattern holds
    // and nothing meaningful was pasted, scale the score down so it can no longer
    // pass on healthy rhythm alone. Threshold (RR<1.55, len≥200) is tunable.
    const pastedShare = effectiveTextLength > 0 ? totalPastedLength / effectiveTextLength : 0;
    let transcriptionSeverity = 0;
    if (effectiveTextLength >= 200 && revisionRatio >= 1.0 && revisionRatio < 1.55 && pastedShare < 0.15) {
        transcriptionSeverity = Math.min(1, (1.55 - revisionRatio) / 0.55); // RR 1.55→0 … 1.0→1
        const penaltyFactor = 0.75 * transcriptionSeverity; // Scale by up to 75% depending on severity
        let penalized = Math.round(baseScore * (1 - penaltyFactor) * 100) / 100;
        // Apply direct score caps to guarantee failing/RED or near-RED status for clear copy-typing:
        if (transcriptionSeverity > 0.4) {
            penalized = Math.min(penalized, 38);
        }
        else if (transcriptionSeverity > 0.1) {
            penalized = Math.min(penalized, 48);
        }
        const delta = Math.round((penalized - baseScore) * 100) / 100;
        if (delta < 0) {
            scoreAdjustments.push({ label: '베껴쓰기(전사) 패턴 감점', points: delta });
            flagiaScore = penalized;
        }
    }
    // ── Flag Status ──
    let flagStatus;
    if (flagiaScore >= thresholds.green) {
        flagStatus = 'GREEN';
    }
    else if (flagiaScore >= thresholds.amber) {
        flagStatus = 'AMBER';
    }
    else {
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
        },
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
        },
        externalContent: {
            raw: pasteScore,
            weighted: Math.round(pasteScore * weights.pasteWeight * 100) / 100,
            weight: weights.pasteWeight,
            label: '외부 콘텐츠',
            description: getPasteDescription(totalPasteCount, totalPastedLength, effectiveTextLength),
            status: getComponentStatus(pasteScore),
        },
        focusDuration: {
            raw: blurScore,
            weighted: Math.round(blurScore * weights.blurWeight * 100) / 100,
            weight: weights.blurWeight,
            label: '집중도',
            description: getBlurDescription(totalBlurDuration),
            status: getComponentStatus(blurScore),
        },
        writingTime: {
            raw: timeScore,
            weighted: Math.round(timeScore * weights.timeWeight * 100) / 100,
            weight: weights.timeWeight,
            label: '작성 시간',
            description: getTimeDescription(totalDurationSec, effectiveTextLength),
            status: getComponentStatus(timeScore),
        },
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
    const sessionSummary = {
        totalDurationSec: Math.round(totalDurationSec),
        sessionCount: reconnectCount + 1,
        totalKeystrokes: totalKeydowns,
        totalCharactersTyped: effectiveTextLength,
        averageWPM: avgWPM,
    };
    // ── Verdict ──
    let { verdict, verdictDetail } = generateVerdict(flagiaScore, flagStatus, { cv: cvScore, rr: rrScore, paste: pasteScore, blur: blurScore, time: timeScore }, mode);
    if (transcriptionSeverity > 0.4) {
        verdictDetail += ` ⚠️ 충분한 분량의 글이 거의 수정 없이 한 번에 입력되었습니다(수정 비율 ${revisionRatio.toFixed(2)}). 타이핑 리듬은 사람과 유사하더라도, 이는 외부 화면의 글을 보며 손으로 그대로 옮겨 쓴(베껴 쓰기) 경우의 전형적 패턴입니다. 직접 확인이 필요합니다.`;
    }
    return {
        version: 3,
        flagiaScore,
        baseScore,
        scoreAdjustments,
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
//# sourceMappingURL=flagiaEngine.js.map
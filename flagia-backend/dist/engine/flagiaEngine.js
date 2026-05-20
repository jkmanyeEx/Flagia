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
// Keys that are not typed content and should be excluded from rhythm analysis
const NON_CONTENT_KEYS = new Set([
    'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape',
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete', 'Backspace',
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
    'ContextMenu', 'Pause', 'ScrollLock', 'NumLock', 'PrintScreen',
    'Process', 'Unidentified', 'Dead',
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
    // Slightly below natural range (still okay)
    if (cv >= 0.3 && cv < 0.4) {
        return Math.round(80 + ((cv - 0.3) / 0.1) * 20);
    }
    // Getting too uniform — suspicious
    if (cv >= 0.2 && cv < 0.3) {
        return Math.round(50 + ((cv - 0.2) / 0.1) * 30);
    }
    // Very uniform — likely copy-typing or automated
    if (cv >= 0.1 && cv < 0.2) {
        return Math.round(20 + ((cv - 0.1) / 0.1) * 30);
    }
    // Machine-like uniformity
    if (cv < 0.1) {
        return Math.max(5, Math.round(20 * (cv / 0.1)));
    }
    // Slightly above natural range (still okay)
    if (cv > 0.9 && cv <= 1.1) {
        return Math.round(80 + ((1.1 - cv) / 0.2) * 20);
    }
    // Getting erratic — possible paste+edit pattern
    if (cv > 1.1 && cv <= 1.5) {
        return Math.round(40 + ((1.5 - cv) / 0.4) * 40);
    }
    // Very erratic
    return Math.max(5, Math.round(40 - (cv - 1.5) * 20));
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
    if (finalScore >= 70)
        return '대체로 자연스러운 타이핑 리듬입니다. 일반적인 사람의 작성 패턴 범위에 해당합니다.';
    if (finalScore >= 50) {
        if (cv < 0.3)
            return '타이핑 속도가 다소 일정합니다. 미리 작성된 텍스트를 보고 옮겨 치고 있을 가능성이 있습니다.';
        return '타이핑 리듬에 일부 비정상적인 변동이 관찰됩니다. 간헐적인 수정 작업이나 외부 참고가 포함된 것으로 보입니다.';
    }
    // Low score
    if (cv < 0.2)
        return '타이핑 리듬이 매우 균일합니다. 자동 입력이나 준비된 텍스트를 그대로 옮겨 쓰는 패턴입니다.';
    if (cv < 0.1)
        return '키 입력이 기계적으로 균일합니다. 자동 입력 도구나 매크로 사용이 강하게 의심됩니다.';
    return '키 입력 간격의 변동이 비정상적으로 큽니다. 외부 소스에서 복사한 뒤 간헐적으로 편집한 패턴일 수 있습니다.';
}
/**
 * Score component: Revision Ratio
 * Typical human writing: RR ≈ 1.2-2.5 (edits, backspaces, corrections)
 */
function scoreRevisionRatio(rr) {
    if (rr >= 1.2 && rr <= 2.5)
        return 100;
    if (rr >= 1.1 && rr < 1.2)
        return 75;
    if (rr > 2.5 && rr <= 3.5)
        return 80;
    if (rr > 3.5 && rr <= 5.0)
        return 60;
    if (rr < 1.1 && rr >= 1.0)
        return 50;
    if (rr < 1.0)
        return 20; // Less keystrokes than chars = definite paste
    return 40; // rr > 5.0
}
function getRrDescription(rr) {
    if (rr >= 1.2 && rr <= 2.5)
        return '적절한 수준의 수정과 편집이 이루어졌습니다. 글을 쓰면서 자연스럽게 내용을 다듬은 흔적이 보입니다.';
    if (rr >= 1.1 && rr < 1.2)
        return '수정이 거의 없이 한 번에 작성된 것으로 보입니다. 사전에 다른 곳에서 글을 준비했을 수 있습니다.';
    if (rr > 2.5 && rr <= 3.5)
        return '평균보다 많은 수정이 있었습니다. 글을 신중하게 다듬은 것으로 판단됩니다.';
    if (rr > 3.5 && rr <= 5.0)
        return '상당한 양의 수정 작업이 관찰됩니다. 글의 구조를 크게 변경하며 작성한 것으로 보입니다.';
    if (rr < 1.1 && rr >= 1.0)
        return '키 입력 수가 최종 텍스트 길이와 거의 같습니다. 이미 완성된 글을 단순히 옮겨 적었을 가능성이 높습니다.';
    if (rr < 1.0)
        return '키 입력 수가 최종 텍스트 길이보다 적습니다. 붙여넣기를 통해 대부분의 내용이 입력되었습니다.';
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
function buildTimeline(events, bucketSizeMs = 30000) {
    if (events.length === 0)
        return [];
    const timestamps = events.map(e => e.timestamp).filter(t => t > 0);
    if (timestamps.length === 0)
        return [];
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const buckets = [];
    let currentStart = minTime;
    while (currentStart < maxTime + bucketSizeMs) {
        const currentEnd = currentStart + bucketSizeMs;
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
/**
 * Main analysis function
 */
function runFlagiaAnalysis(rawEvents, finalMarkdown, templateText, mode) {
    const weights = MODE_WEIGHTS[mode] || MODE_WEIGHTS.STANDARD;
    const thresholds = MODE_THRESHOLDS[mode] || MODE_THRESHOLDS.STANDARD;
    const events = stripSubmitInducedBlur(rawEvents);
    // ── Template offset: strip HTML tags to get real text length ──
    const templateLength = (templateText || '').length;
    const plainText = finalMarkdown.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const effectiveTextLength = Math.max(1, plainText.length - templateLength);
    // ── IKI values: only CONTENT keydown events with valid IKI ──
    // Modifier and navigation keys (Shift, Meta, arrows, Backspace…) are not
    // typing rhythm — filtering them out keeps a paste followed by Ctrl/Meta+V
    // from registering as a 99-score "rhythm sample".
    const contentKeydowns = events.filter((e) => e.type === 'keydown' && e.meta?.key && !NON_CONTENT_KEYS.has(e.meta.key));
    const ikiValues = contentKeydowns
        .filter((e) => e.iki > 0 && e.iki < IKI_CEILING_MS)
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
    const contentConfidence = effectiveTextLength > 0
        ? Math.min(1, contentKeydowns.length / effectiveTextLength)
        : 0;
    const rhythmConfidence = Math.min(sampleConfidence, contentConfidence);
    const RHYTHM_FLOOR = 5;
    const rawCvScore = scoreCv(cv);
    const cvScore = Math.round(rawCvScore * rhythmConfidence + RHYTHM_FLOOR * (1 - rhythmConfidence));
    const rrScore = scoreRevisionRatio(revisionRatio);
    const pasteCountScore = scorePasteCount(totalPasteCount);
    const pasteVolumeScore = scorePasteVolume(totalPastedLength, effectiveTextLength);
    // Blend count and volume: volume is weighted higher (60/40) since it captures severity better
    const pasteScore = Math.round(pasteVolumeScore * 0.6 + pasteCountScore * 0.4);
    const blurScore = scoreBlurDuration(totalBlurDuration);
    // ── Writing-time score: derived from session span vs. final text length ──
    const eventTimestamps = events.map(e => e.timestamp).filter(t => t > 0);
    const totalDurationSec = eventTimestamps.length >= 2
        ? (Math.max(...eventTimestamps) - Math.min(...eventTimestamps)) / 1000
        : 0;
    const timeScore = scoreWritingTime(totalDurationSec, effectiveTextLength);
    // ── Composite Flagia Score ──
    let flagiaScore = cvScore * weights.cvWeight +
        rrScore * weights.rrWeight +
        pasteScore * weights.pasteWeight +
        blurScore * weights.blurWeight +
        timeScore * weights.timeWeight;
    flagiaScore = Math.round(Math.max(0, Math.min(100, flagiaScore)) * 100) / 100;
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
            description: getCvDescription(cv, cvScore, rhythmConfidence, ikiValues.length),
            status: getComponentStatus(cvScore),
        },
        revisionIntensity: {
            raw: rrScore,
            weighted: Math.round(rrScore * weights.rrWeight * 100) / 100,
            weight: weights.rrWeight,
            label: '수정 강도',
            description: getRrDescription(revisionRatio),
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
    const timeline = buildTimeline(events);
    const blurIntervals = buildBlurIntervals(events);
    // ── Session Summary ──
    const avgWPM = totalDurationSec > 0
        ? Math.round((effectiveTextLength / 5) / (totalDurationSec / 60))
        : 0;
    const sessionSummary = {
        totalDurationSec: Math.round(totalDurationSec),
        sessionCount: 1,
        totalKeystrokes: totalKeydowns,
        totalCharactersTyped: effectiveTextLength,
        averageWPM: avgWPM,
    };
    // ── Verdict ──
    const { verdict, verdictDetail } = generateVerdict(flagiaScore, flagStatus, { cv: cvScore, rr: rrScore, paste: pasteScore, blur: blurScore, time: timeScore }, mode);
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
//# sourceMappingURL=flagiaEngine.js.map
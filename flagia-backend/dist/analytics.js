"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getExcludedRanges = getExcludedRanges;
exports.calculateFlagiaScore = calculateFlagiaScore;
/**
 * Extracts ranges of text that should be excluded from keystroke analysis.
 * Excluded ranges include:
 * 1. The exact span where the templateText exists in the final content.
 * 2. Spans enclosed by <citation>...</citation> tags.
 */
function getExcludedRanges(content, templateText) {
    const ranges = [];
    // 1. Template Text matching
    if (templateText && templateText.trim().length > 0) {
        const trimmedTemplate = templateText.trim();
        const templateIndex = content.indexOf(trimmedTemplate);
        if (templateIndex !== -1) {
            ranges.push({
                start: templateIndex,
                end: templateIndex + trimmedTemplate.length
            });
        }
    }
    // 2. Citation blocks matching: <citation>...</citation>
    const citationRegex = /<citation>([\s\S]*?)<\/citation>/g;
    let match;
    while ((match = citationRegex.exec(content)) !== null) {
        ranges.push({
            start: match.index,
            end: match.index + match[0].length
        });
    }
    return ranges;
}
/**
 * Helper to check if a cursor position falls within any excluded ranges
 */
function isExcluded(position, ranges) {
    return ranges.some(range => position >= range.start && position <= range.end);
}
function calculateFlagiaScore(content, templateText, keystrokes, focusEvents, sensitivityMode) {
    const finalContent = content || '';
    const excludedRanges = getExcludedRanges(finalContent, templateText);
    // 1. Filter keystroke events (exclude keydowns that occurred inside template or citation zones)
    // We sort them chronologically
    const sortedKeystrokes = [...keystrokes].sort((a, b) => a.timestamp - b.timestamp);
    const filteredKeystrokes = sortedKeystrokes.filter(ks => {
        // If the event was logged at a position inside any excluded range, filter it out
        return !isExcluded(ks.position, excludedRanges);
    });
    // Calculate filtered content length
    // Exclude content lengths of citation blocks and template text
    let citationLength = 0;
    const citationRegex = /<citation>([\s\S]*?)<\/citation>/g;
    let citationMatch;
    while ((citationMatch = citationRegex.exec(finalContent)) !== null) {
        citationLength += citationMatch[0].length;
    }
    const templateLength = (templateText && finalContent.includes(templateText)) ? templateText.length : 0;
    const filteredContentLength = Math.max(0, finalContent.length - citationLength - templateLength);
    // 2. Inter-Keystroke Interval (IKI) Calculations on keydowns
    const keydowns = filteredKeystrokes.filter(ks => ks.eventType === 'keydown');
    const ikis = [];
    for (let i = 1; i < keydowns.length; i++) {
        const diff = keydowns[i].timestamp - keydowns[i - 1].timestamp;
        // Cap reasonable typing intervals (e.g. discard pauses larger than 10 seconds as non-typing breaks)
        if (diff > 0 && diff < 10000) {
            ikis.push(diff);
        }
    }
    let ikiMean = 0;
    let ikiCv = 0;
    if (ikis.length > 0) {
        const sum = ikis.reduce((a, b) => a + b, 0);
        ikiMean = sum / ikis.length;
        const variance = ikis.reduce((acc, val) => acc + Math.pow(val - ikiMean, 2), 0) / ikis.length;
        const stdDev = Math.sqrt(variance);
        ikiCv = ikiMean > 0 ? stdDev / ikiMean : 0;
    }
    // 3. Revision Ratio Calculation
    // Ratio of total key operations to final content length.
    // Real typing typically has edits (Backspace/Delete) leading to Revision Ratio > 1.1.
    // Paste inputs or pre-rendered text insertions result in 1.0 or lower.
    let revisionRatio = 0;
    if (filteredContentLength > 0) {
        revisionRatio = keydowns.length / filteredContentLength;
    }
    // 4. Focus lost count and suspicious focus return actions
    const focusLostCount = focusEvents.filter(e => e.eventType === 'blur').length;
    // Track suspicious copy pastes: pastes outside citation blocks with length > 20 characters
    let suspiciousPastes = 0;
    const pastes = sortedKeystrokes.filter(ks => ks.eventType === 'paste');
    for (const paste of pastes) {
        if (!isExcluded(paste.position, excludedRanges)) {
            const pasteLen = paste.textInserted ? paste.textInserted.length : 0;
            if (pasteLen > 20) {
                suspiciousPastes++;
            }
        }
    }
    // 5. Score calculation logic based on sensitivity modes
    let score = 100;
    // A: Keystroke volume check: if there is substantial typed content but zero or tiny logged keypresses,
    // it is highly indicative of external injection or pasting.
    if (filteredContentLength > 50 && keydowns.length < 5) {
        score -= 70; // Heavy penalty
    }
    // B: IKI Coefficient of Variation (Cv) penalty
    // Humans type with variable speed (Cv 0.3 - 0.7).
    // Cv < 0.15 indicates automated typing/macro scripts.
    if (keydowns.length >= 10) {
        if (ikiCv < 0.18) {
            score -= 35;
        }
        else if (ikiCv < 0.25) {
            score -= 15;
        }
        // Excessively high Cv might mean massive long breaks, handled separately.
    }
    // C: Revision Ratio check
    // Ratio close to 1.0 with no edits or below 1.0 (indicating bulk text paste).
    if (filteredContentLength > 20) {
        if (revisionRatio < 1.02) {
            score -= 30; // Paste indicator
        }
        else if (revisionRatio < 1.1) {
            score -= 15;
        }
    }
    // D: Focus Lost (Blur) penalties depending on sensitivity
    let blurPenaltyMultiplier = 10;
    let pastePenaltyMultiplier = 20;
    if (sensitivityMode === 'Strict') {
        blurPenaltyMultiplier = 25;
        pastePenaltyMultiplier = 40;
    }
    else if (sensitivityMode === 'Research') {
        // Research mode is more permissive with copy-pastes/focus loss for referencing
        blurPenaltyMultiplier = 5;
        pastePenaltyMultiplier = 5;
    }
    else if (sensitivityMode === 'Creative') {
        blurPenaltyMultiplier = 8;
        pastePenaltyMultiplier = 10;
        // Less strict on typing rhythm
    }
    score -= focusLostCount * blurPenaltyMultiplier;
    score -= suspiciousPastes * pastePenaltyMultiplier;
    // Clamp the score between 0 and 100
    score = Math.max(0, Math.min(100, Math.round(score)));
    // Define Risk flag based on score
    let riskFlag = 'Green';
    if (score < 50) {
        riskFlag = 'Red';
    }
    else if (score < 80) {
        riskFlag = 'Amber';
    }
    // Special override: in Strict mode, any blur automatically makes risk Amber at best
    if (sensitivityMode === 'Strict' && focusLostCount > 0 && riskFlag === 'Green') {
        riskFlag = 'Amber';
    }
    return {
        score,
        riskFlag,
        ikiMean: Math.round(ikiMean),
        ikiCv: parseFloat(ikiCv.toFixed(3)),
        revisionRatio: parseFloat(revisionRatio.toFixed(3)),
        focusLostCount,
        suspiciousPastes
    };
}

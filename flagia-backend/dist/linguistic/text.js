"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submissionPlainText = submissionPlainText;
exports.earlyScopeReason = earlyScopeReason;
exports.revisionStates = revisionStates;
function submissionPlainText(markdown) {
    return markdown
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|div|h[1-6]|li|blockquote|tr)>/gi, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&#(x[0-9a-f]+|\d+);/gi, (match, entity) => {
        const code = entity[0].toLowerCase() === 'x' ? parseInt(entity.slice(1), 16) : Number(entity);
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
            ? String.fromCodePoint(code) : match;
    }).normalize('NFC').trim();
}
function earlyScopeReason(text, mode, markup = '') {
    if (mode === 'CREATIVE' || /<code\b|<pre\b/i.test(markup) || text.includes('```'))
        return 'unsupported_genre';
    if (text.length < 200)
        return 'too_short';
    if (text.length > 12000)
        return 'too_long';
    const letters = text.match(/\p{L}/gu)?.length || 0;
    const hangul = text.match(/[가-힣]/g)?.length || 0;
    if (hangul / Math.max(1, letters) < .6)
        return 'unsupported_language';
    return undefined;
}
/** UTF-16 frame offsets are applied BEFORE normalizing the comparison text. */
function revisionStates(events) {
    const samplePairs = (states) => {
        if (states.length <= 96)
            return states;
        // Keep adjacent pairs, rather than pretending widely separated observations
        // prove a sentence persisted continuously across unobserved changes.
        return Array.from({ length: 48 }, (_, segment) => {
            const start = Math.floor(segment * (states.length - 2) / 47);
            return [states[start], states[start + 1]].map(s => ({ ...s, segment }));
        }).flat();
    };
    const snapshots = events.filter(e => e.type === 'snapshot' && typeof e.meta?.text === 'string'
        && e.meta.text.length <= 12000 && Number.isFinite(e.timestamp));
    if (snapshots.length >= 2) {
        return samplePairs(snapshots.map(e => ({ text: e.meta.text, timestamp: e.timestamp })));
    }
    const result = [];
    let text = '', valid = false, lastCaptured = -Infinity;
    for (const e of events) {
        if (e.type !== 'document_frame')
            continue;
        const m = e.meta;
        if (!m || m.v !== 3) {
            valid = false;
            continue;
        }
        if (typeof m.baseText === 'string') {
            text = m.baseText;
            valid = text.length <= 12000;
        }
        if (!valid)
            continue;
        const { from, to, insertedText, textLength } = m;
        if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to > text.length
            || typeof insertedText !== 'string' || !Number.isFinite(e.timestamp)) {
            valid = false;
            continue;
        }
        const splitsPair = (offset) => offset > 0 && offset < text.length
            && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]);
        if (splitsPair(from) || splitsPair(to)) {
            valid = false;
            continue;
        }
        const next = text.slice(0, from) + insertedText + text.slice(to);
        if (next.length !== textLength || next.length > 12000) {
            valid = false;
            continue;
        }
        text = next;
        if (e.timestamp - lastCaptured >= 2000) {
            result.push({ text, timestamp: e.timestamp });
            lastCaptured = e.timestamp;
            if (result.length > 4096)
                return [];
        }
    }
    return samplePairs(result);
}
//# sourceMappingURL=text.js.map
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const flagiaEngine_1 = require("./flagiaEngine");
function correlationUnitTests() {
    const boundary = (0, flagiaEngine_1.calculateRrDivergenceCorrelation)(1.43, 0.056);
    strict_1.default.equal(boundary.eligible, true);
    strict_1.default.ok(boundary.expectedDivergence > 0.056, 'RR 1.43 should expect more divergence than the observed 5.6%');
    strict_1.default.ok(boundary.risk > 0.4, 'the reported boundary class should carry meaningful risk');
    const lowerRr = (0, flagiaEngine_1.calculateRrDivergenceCorrelation)(1.25, 0.056);
    strict_1.default.ok(lowerRr.risk < boundary.risk, 'the same divergence must become more suspicious as RR rises');
    const proportionalRevision = (0, flagiaEngine_1.calculateRrDivergenceCorrelation)(1.43, boundary.expectedDivergence);
    strict_1.default.equal(proportionalRevision.risk, 0, 'divergence proportional to RR should not receive fake-edit risk');
    const belowGate = (0, flagiaEngine_1.calculateRrDivergenceCorrelation)(1.24, 0);
    strict_1.default.equal(belowGate.eligible, false, 'low-RR linear writing keeps the safety gate');
    strict_1.default.equal(belowGate.risk, 0);
    const baseTolerance = (0, flagiaEngine_1.calculateRrDivergenceCorrelation)(1.25, 0.069);
    strict_1.default.ok(baseTolerance.risk > 0, 'the base tolerance is raised slightly to 7%');
    strict_1.default.equal((0, flagiaEngine_1.calculateRrDivergenceCorrelation)(1.25, 0.07).risk, 0);
}
function makeFinalText() {
    return Array.from({ length: 36 }, (_, index) => `word${index.toString().padStart(3, '0')}`).join(' ');
}
function makeEvents(finalText, abandonedWords, options = {}) {
    const events = [];
    let seq = 0;
    const includeSnapshots = options.includeSnapshots ?? true;
    if (includeSnapshots) {
        const draft = `${finalText} ${abandonedWords.join(' ')}`.trim();
        for (let index = 0; index < 2; index++) {
            events.push({
                seq: seq++,
                timestamp: 1_000 + index * 2_000,
                iki: 0,
                type: 'snapshot',
                meta: { text: draft },
                currentHash: '',
            });
        }
        events.push({
            seq: seq++,
            timestamp: 5_000,
            iki: 0,
            type: 'snapshot',
            meta: { text: finalText },
            currentHash: '',
        });
    }
    const keydownCount = Math.round(finalText.length * (options.revisionRatio ?? 1.43));
    let timestamp = 6_000;
    for (let index = 0; index < keydownCount; index++) {
        const iki = 120 + (index % 7) * 35;
        timestamp += iki;
        events.push({
            seq: seq++,
            timestamp,
            iki,
            type: 'keydown',
            meta: { key: String.fromCharCode(97 + (index % 20)) },
            currentHash: '',
        });
    }
    if (options.pasteLength) {
        events.push({
            seq: seq++,
            timestamp: timestamp + 500,
            iki: 0,
            type: 'paste',
            meta: { pasteLength: options.pasteLength },
            currentHash: '',
        });
    }
    return events;
}
function transcriptionRow(analysis, label) {
    return analysis.transcription?.rows.find(row => row.label === label)?.value;
}
function integrationTests() {
    const finalText = makeFinalText();
    // Two persistent non-final words across 36 unique final words = 5.6%
    // divergence, matching the reported false-negative boundary without using
    // any student content or identifying data.
    const suspicious = (0, flagiaEngine_1.runFlagiaAnalysis)(makeEvents(finalText, ['discardedalpha', 'discardedbeta']), finalText, '', 'STANDARD');
    strict_1.default.equal(suspicious.version, 5);
    strict_1.default.equal(suspicious.transcription?.basis, 'divergence');
    strict_1.default.equal(suspicious.transcription?.triggered, true);
    strict_1.default.ok((suspicious.transcription?.points ?? 0) < 0, 'RR/divergence mismatch should apply a structural penalty');
    strict_1.default.equal(suspicious.flagiaScore, 39);
    strict_1.default.equal(suspicious.flagStatus, 'RED');
    strict_1.default.equal(transcriptionRow(suspicious, '강한 상관 위험 RED 기준'), '충족');
    strict_1.default.match(suspicious.verdictDetail, /편집 위장 패턴/);
    const lowerRrBoundary = (0, flagiaEngine_1.runFlagiaAnalysis)(makeEvents(finalText, ['discardedalpha', 'discardedbeta'], {
        revisionRatio: 1.25,
    }), finalText, '', 'STANDARD');
    strict_1.default.notEqual(lowerRrBoundary.flagStatus, 'RED', 'the same divergence at the RR eligibility floor must not auto-escalate to RED');
    strict_1.default.equal(transcriptionRow(lowerRrBoundary, '강한 상관 위험 RED 기준'), '미충족');
    const honestRevision = (0, flagiaEngine_1.runFlagiaAnalysis)(makeEvents(finalText, [
        'discardedalpha',
        'discardedbeta',
        'discardedgamma',
        'discardeddelta',
        'discardedepsilon',
        'discardedzeta',
        'discardedeta',
        'discardedtheta',
    ]), finalText, '', 'STANDARD');
    strict_1.default.equal(honestRevision.transcription?.triggered, false);
    strict_1.default.equal(honestRevision.transcription?.basis, 'none');
    const imeChurn = (0, flagiaEngine_1.runFlagiaAnalysis)(makeEvents(finalText, ['word00']), finalText, '', 'STANDARD');
    strict_1.default.equal(transcriptionRow(imeChurn, '내용 발산도 (낮을수록 베껴쓰기 의심)'), '0.0%', 'persistent prefixes produced by Korean IME build-up remain excluded');
    const templateText = Array.from({ length: 70 }, (_, index) => `template${index.toString().padStart(3, '0')}`).join(' ');
    const noSnapshots = (0, flagiaEngine_1.runFlagiaAnalysis)(makeEvents(templateText, [], { revisionRatio: 1.2, includeSnapshots: false }), templateText, '', 'STANDARD');
    strict_1.default.equal(noSnapshots.transcription?.basis, 'rr');
    strict_1.default.equal(noSnapshots.transcription?.triggered, true);
    const templateCopy = (0, flagiaEngine_1.runFlagiaAnalysis)(makeEvents(templateText, []), templateText, templateText, 'STANDARD');
    strict_1.default.equal(templateCopy.transcription?.basis, 'template');
    strict_1.default.equal(templateCopy.transcription?.triggered, true);
    const pasteDominated = (0, flagiaEngine_1.runFlagiaAnalysis)(makeEvents(finalText, ['discardedalpha', 'discardedbeta'], {
        pasteLength: Math.ceil(finalText.length * 0.2),
    }), finalText, '', 'STANDARD');
    strict_1.default.equal(pasteDominated.transcription?.triggered, false, 'paste-dominated work stays in the dedicated external-content path');
    strict_1.default.equal(transcriptionRow(pasteDominated, 'RR–발산도 불일치 위험'), '해당 없음', 'excluded paste cases must not show a misleading correlation risk');
    strict_1.default.ok((pasteDominated.totalPasteCount ?? 0) > 0);
}
correlationUnitTests();
integrationTests();
// Semantic support supplements the existing evidence; it never adds a penalty.
const semanticText = makeFinalText();
const semanticEvents = makeEvents(semanticText, []);
const legacy = (0, flagiaEngine_1.runFlagiaAnalysis)(semanticEvents, semanticText, '', 'STANDARD');
const meaning = {
    status: 'evaluated', stableSentenceCount: 4, surfaceEdits: 0,
    rewordings: 0, meaningEdits: 2, unknownEdits: 0, meaningChangeRatio: .2,
    examples: [], method: 'test',
};
const supported = (0, flagiaEngine_1.runFlagiaAnalysis)(semanticEvents, semanticText, '', 'STANDARD', undefined, meaning);
strict_1.default.ok(supported.flagiaScore > legacy.flagiaScore, 'observed meaning changes can reduce transcription risk');
const unavailable = (0, flagiaEngine_1.runFlagiaAnalysis)(semanticEvents, semanticText, '', 'STANDARD', undefined, { ...meaning, status: 'unevaluated' });
strict_1.default.equal(unavailable.flagiaScore, legacy.flagiaScore, 'missing semantic history cannot change the legacy score');
console.log('Flagia RR/divergence correlation tests passed');
//# sourceMappingURL=flagiaEngine_test.js.map
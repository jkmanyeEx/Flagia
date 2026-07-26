import assert from 'node:assert/strict';
import {
  calculateRrDivergenceCorrelation,
  runFlagiaAnalysis,
} from './flagiaEngine';

function correlationUnitTests(): void {
  const boundary = calculateRrDivergenceCorrelation(1.43, 0.056);
  assert.equal(boundary.eligible, true);
  assert.ok(
    boundary.expectedDivergence > 0.056,
    'RR 1.43 should expect more divergence than the observed 5.6%',
  );
  assert.ok(boundary.risk > 0.4, 'the reported boundary class should carry meaningful risk');

  const lowerRr = calculateRrDivergenceCorrelation(1.25, 0.056);
  assert.ok(
    lowerRr.risk < boundary.risk,
    'the same divergence must become more suspicious as RR rises',
  );

  const proportionalRevision = calculateRrDivergenceCorrelation(
    1.43,
    boundary.expectedDivergence,
  );
  assert.equal(
    proportionalRevision.risk,
    0,
    'divergence proportional to RR should not receive fake-edit risk',
  );

  const belowGate = calculateRrDivergenceCorrelation(1.24, 0);
  assert.equal(belowGate.eligible, false, 'low-RR linear writing keeps the safety gate');
  assert.equal(belowGate.risk, 0);

  const baseTolerance = calculateRrDivergenceCorrelation(1.25, 0.069);
  assert.ok(baseTolerance.risk > 0, 'the base tolerance is raised slightly to 7%');
  assert.equal(calculateRrDivergenceCorrelation(1.25, 0.07).risk, 0);
}

function makeFinalText(): string {
  return Array.from({ length: 36 }, (_, index) =>
    `word${index.toString().padStart(3, '0')}`
  ).join(' ');
}

function makeEvents(
  finalText: string,
  abandonedWords: string[],
  options: {
    revisionRatio?: number;
    includeSnapshots?: boolean;
    pasteLength?: number;
  } = {},
): any[] {
  const events: any[] = [];
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

function transcriptionRow(
  analysis: ReturnType<typeof runFlagiaAnalysis>,
  label: string,
): string | undefined {
  return analysis.transcription?.rows.find(row => row.label === label)?.value;
}

function integrationTests(): void {
  const finalText = makeFinalText();

  // Two persistent non-final words across 36 unique final words = 5.6%
  // divergence, matching the reported false-negative boundary without using
  // any student content or identifying data.
  const suspicious = runFlagiaAnalysis(
    makeEvents(finalText, ['discardedalpha', 'discardedbeta']),
    finalText,
    '',
    'STANDARD',
  );
  assert.equal(suspicious.version, 4);
  assert.equal(suspicious.transcription?.basis, 'divergence');
  assert.equal(suspicious.transcription?.triggered, true);
  assert.ok(
    (suspicious.transcription?.points ?? 0) < 0,
    'RR/divergence mismatch should apply a structural penalty',
  );
  assert.equal(suspicious.flagiaScore, 39);
  assert.equal(suspicious.flagStatus, 'RED');
  assert.equal(
    transcriptionRow(suspicious, '강한 상관 위험 RED 기준'),
    '충족',
  );
  assert.match(suspicious.verdictDetail, /편집 위장 패턴/);

  const lowerRrBoundary = runFlagiaAnalysis(
    makeEvents(finalText, ['discardedalpha', 'discardedbeta'], {
      revisionRatio: 1.25,
    }),
    finalText,
    '',
    'STANDARD',
  );
  assert.notEqual(
    lowerRrBoundary.flagStatus,
    'RED',
    'the same divergence at the RR eligibility floor must not auto-escalate to RED',
  );
  assert.equal(
    transcriptionRow(lowerRrBoundary, '강한 상관 위험 RED 기준'),
    '미충족',
  );

  const honestRevision = runFlagiaAnalysis(
    makeEvents(finalText, [
      'discardedalpha',
      'discardedbeta',
      'discardedgamma',
      'discardeddelta',
      'discardedepsilon',
      'discardedzeta',
      'discardedeta',
      'discardedtheta',
    ]),
    finalText,
    '',
    'STANDARD',
  );
  assert.equal(honestRevision.transcription?.triggered, false);
  assert.equal(honestRevision.transcription?.basis, 'none');

  const imeChurn = runFlagiaAnalysis(
    makeEvents(finalText, ['word00']),
    finalText,
    '',
    'STANDARD',
  );
  assert.equal(
    transcriptionRow(imeChurn, '내용 발산도 (낮을수록 베껴쓰기 의심)'),
    '0.0%',
    'persistent prefixes produced by Korean IME build-up remain excluded',
  );

  const templateText = Array.from({ length: 70 }, (_, index) =>
    `template${index.toString().padStart(3, '0')}`
  ).join(' ');

  const noSnapshots = runFlagiaAnalysis(
    makeEvents(templateText, [], { revisionRatio: 1.2, includeSnapshots: false }),
    templateText,
    '',
    'STANDARD',
  );
  assert.equal(noSnapshots.transcription?.basis, 'rr');
  assert.equal(noSnapshots.transcription?.triggered, true);

  const templateCopy = runFlagiaAnalysis(
    makeEvents(templateText, []),
    templateText,
    templateText,
    'STANDARD',
  );
  assert.equal(templateCopy.transcription?.basis, 'template');
  assert.equal(templateCopy.transcription?.triggered, true);

  const pasteDominated = runFlagiaAnalysis(
    makeEvents(finalText, ['discardedalpha', 'discardedbeta'], {
      pasteLength: Math.ceil(finalText.length * 0.2),
    }),
    finalText,
    '',
    'STANDARD',
  );
  assert.equal(
    pasteDominated.transcription?.triggered,
    false,
    'paste-dominated work stays in the dedicated external-content path',
  );
  assert.equal(
    transcriptionRow(pasteDominated, 'RR–발산도 불일치 위험'),
    '해당 없음',
    'excluded paste cases must not show a misleading correlation risk',
  );
  assert.ok((pasteDominated.totalPasteCount ?? 0) > 0);
}

correlationUnitTests();
integrationTests();
console.log('Flagia RR/divergence correlation tests passed');

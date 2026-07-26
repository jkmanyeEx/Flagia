import assert from 'node:assert/strict';
import {
  filterTelemetryEvents,
  isValidDocumentFrameEvent,
  MAX_TELEMETRY_BATCH_EVENTS,
} from './telemetryValidation';

const validFrame = {
  seq: 1,
  timestamp: Date.now(),
  iki: 0,
  type: 'document_frame',
  meta: {
    v: 3,
    from: 0,
    to: 1,
    insertedText: '안',
    cursorPosition: 1,
    selectionLength: 0,
    textLength: 1,
    baseText: '아',
  },
  currentHash: '',
};

assert.equal(isValidDocumentFrameEvent(validFrame, 100), true);
assert.equal(isValidDocumentFrameEvent({
  ...validFrame,
  meta: { ...validFrame.meta, to: -1 },
}, 100), false);
assert.equal(isValidDocumentFrameEvent({
  ...validFrame,
  meta: { ...validFrame.meta, insertedText: '가'.repeat(101), textLength: 101 },
}, 100), false);
assert.equal(isValidDocumentFrameEvent({
  ...validFrame,
  meta: { ...validFrame.meta, cursorPosition: 2 },
}, 100), false);

const oversizedBatch = Array.from(
  { length: MAX_TELEMETRY_BATCH_EVENTS + 2 },
  (_, index) => ({ ...validFrame, seq: index + 1 }),
);
const filtered = filterTelemetryEvents(oversizedBatch, 100);
assert.equal(filtered.accepted.length, MAX_TELEMETRY_BATCH_EVENTS);
assert.equal(filtered.rejectedCount, 2);

const mixed = filterTelemetryEvents([
  { type: 'keydown', timestamp: Date.now(), meta: { key: 'Process' } },
  validFrame,
  { ...validFrame, meta: { ...validFrame.meta, v: 2 } },
], 100);
assert.equal(mixed.accepted.length, 2);
assert.equal(mixed.rejectedCount, 1);

console.log('Telemetry document-frame validation tests passed');

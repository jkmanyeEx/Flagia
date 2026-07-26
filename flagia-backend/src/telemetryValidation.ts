import { Buffer } from 'buffer';

export const DOCUMENT_FRAME_VERSION = 3;
export const MAX_TELEMETRY_BATCH_EVENTS = 1_000;
export const MAX_DOCUMENT_FRAME_BYTES = 450_000;

interface DocumentFrameMeta {
  v: number;
  from: number;
  to: number;
  insertedText: string;
  cursorPosition: number;
  selectionLength: number;
  textLength: number;
  baseText?: string;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function isValidDocumentFrameEvent(
  event: unknown,
  maxContentLength: number,
): boolean {
  if (!event || typeof event !== 'object') return false;
  const candidate = event as { type?: unknown; timestamp?: unknown; meta?: unknown };
  if (candidate.type !== 'document_frame') return false;
  if (!isSafeNonNegativeInteger(candidate.timestamp) || candidate.timestamp === 0) return false;
  if (!candidate.meta || typeof candidate.meta !== 'object') return false;

  const meta = candidate.meta as Partial<DocumentFrameMeta>;
  if (
    meta.v !== DOCUMENT_FRAME_VERSION ||
    !isSafeNonNegativeInteger(meta.from) ||
    !isSafeNonNegativeInteger(meta.to) ||
    !isSafeNonNegativeInteger(meta.cursorPosition) ||
    !isSafeNonNegativeInteger(meta.selectionLength) ||
    !isSafeNonNegativeInteger(meta.textLength) ||
    typeof meta.insertedText !== 'string' ||
    (meta.baseText !== undefined && typeof meta.baseText !== 'string')
  ) {
    return false;
  }

  const maxUtf16Length = Math.max(0, maxContentLength) * 2;
  if (
    meta.to < meta.from ||
    meta.from > maxUtf16Length ||
    meta.to > maxUtf16Length ||
    meta.textLength > maxUtf16Length ||
    meta.cursorPosition + meta.selectionLength > meta.textLength ||
    Array.from(meta.insertedText).length > maxContentLength ||
    (meta.baseText !== undefined && Array.from(meta.baseText).length > maxContentLength)
  ) {
    return false;
  }

  return Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= MAX_DOCUMENT_FRAME_BYTES;
}

export function filterTelemetryEvents(
  events: unknown[],
  maxContentLength: number,
): { accepted: unknown[]; rejectedCount: number } {
  const bounded = events.slice(0, MAX_TELEMETRY_BATCH_EVENTS);
  const accepted = bounded.filter(event => {
    if (!event || typeof event !== 'object') return false;
    if ((event as { type?: unknown }).type !== 'document_frame') return true;
    return isValidDocumentFrameEvent(event, maxContentLength);
  });
  return {
    accepted,
    rejectedCount: events.length - accepted.length,
  };
}

export const DOCUMENT_FRAME_VERSION = 3

export interface DocumentFrameMeta {
  v: typeof DOCUMENT_FRAME_VERSION
  from: number
  to: number
  insertedText: string
  cursorPosition: number
  selectionLength: number
  textLength: number
  baseText?: string
}

export interface AppliedDocumentFrame {
  text: string
  cursorPosition: number
  selectionLength: number
  valid: boolean
}

export interface DocumentReplayEvent {
  seq?: number
  timestamp: number
  type: string
  meta?: unknown
}

export function htmlToPlainText(html: string): string {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n$/, '')
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

function keepCodePointBoundary(text: string, offset: number): number {
  if (
    offset > 0 &&
    offset < text.length &&
    isHighSurrogate(text.charCodeAt(offset - 1)) &&
    isLowSurrogate(text.charCodeAt(offset))
  ) {
    return offset - 1
  }
  return offset
}

/**
 * Create one compact replacement patch from two authoritative editor states.
 * Offsets intentionally use JavaScript UTF-16 indices because ProseMirror text
 * offsets and String#slice use the same units.
 */
export function createDocumentFrame(
  previousText: string,
  nextText: string,
  cursorPosition: number,
  selectionLength: number,
  includeBase = false,
): DocumentFrameMeta {
  let prefix = 0
  const sharedLength = Math.min(previousText.length, nextText.length)
  while (prefix < sharedLength && previousText.charCodeAt(prefix) === nextText.charCodeAt(prefix)) {
    prefix++
  }
  prefix = keepCodePointBoundary(previousText, prefix)
  prefix = keepCodePointBoundary(nextText, prefix)

  let previousSuffix = previousText.length
  let nextSuffix = nextText.length
  while (
    previousSuffix > prefix &&
    nextSuffix > prefix &&
    previousText.charCodeAt(previousSuffix - 1) === nextText.charCodeAt(nextSuffix - 1)
  ) {
    previousSuffix--
    nextSuffix--
  }
  previousSuffix = keepCodePointBoundary(previousText, previousSuffix)
  nextSuffix = keepCodePointBoundary(nextText, nextSuffix)

  const safeCursor = Math.max(0, Math.min(nextText.length, Math.trunc(cursorPosition)))
  const safeSelection = Math.max(
    0,
    Math.min(nextText.length - safeCursor, Math.trunc(selectionLength)),
  )

  return {
    v: DOCUMENT_FRAME_VERSION,
    from: prefix,
    to: previousSuffix,
    insertedText: nextText.slice(prefix, nextSuffix),
    cursorPosition: safeCursor,
    selectionLength: safeSelection,
    textLength: nextText.length,
    ...(includeBase ? { baseText: previousText } : {}),
  }
}

export function isDocumentFrameMeta(value: unknown): value is DocumentFrameMeta {
  if (!value || typeof value !== 'object') return false
  const meta = value as Partial<DocumentFrameMeta>
  return (
    meta.v === DOCUMENT_FRAME_VERSION &&
    Number.isSafeInteger(meta.from) &&
    Number.isSafeInteger(meta.to) &&
    Number.isSafeInteger(meta.cursorPosition) &&
    Number.isSafeInteger(meta.selectionLength) &&
    Number.isSafeInteger(meta.textLength) &&
    typeof meta.insertedText === 'string' &&
    (meta.baseText === undefined || typeof meta.baseText === 'string')
  )
}

/**
 * Apply a recorded frame defensively. A frame carrying baseText is an explicit
 * recovery checkpoint and can safely restart reconstruction after a missing or
 * malformed older event.
 */
export function applyDocumentFrame(
  currentText: string,
  value: unknown,
): AppliedDocumentFrame {
  if (!isDocumentFrameMeta(value)) {
    return {
      text: currentText,
      cursorPosition: currentText.length,
      selectionLength: 0,
      valid: false,
    }
  }

  const source = value.baseText ?? currentText
  if (
    value.from < 0 ||
    value.to < value.from ||
    value.to > source.length ||
    value.cursorPosition < 0 ||
    value.selectionLength < 0 ||
    value.cursorPosition + value.selectionLength > value.textLength
  ) {
    return {
      text: source,
      cursorPosition: Math.min(source.length, Math.max(0, value.cursorPosition)),
      selectionLength: 0,
      valid: false,
    }
  }

  const text = source.slice(0, value.from) + value.insertedText + source.slice(value.to)
  if (text.length !== value.textLength) {
    return {
      text: source,
      cursorPosition: Math.min(source.length, Math.max(0, value.cursorPosition)),
      selectionLength: 0,
      valid: false,
    }
  }

  return {
    text,
    cursorPosition: value.cursorPosition,
    selectionLength: value.selectionLength,
    valid: true,
  }
}

export function replayDocumentFrames(
  events: DocumentReplayEvent[],
  thresholdTime: number,
): AppliedDocumentFrame | null {
  const orderedEvents = [...events].sort((a, b) => {
    const byTime = (a.timestamp || 0) - (b.timestamp || 0)
    return byTime || (a.seq || 0) - (b.seq || 0)
  })
  const firstFrame = orderedEvents.find(
    event => event.type === 'document_frame' && isDocumentFrameMeta(event.meta),
  )
  if (!firstFrame || !isDocumentFrameMeta(firstFrame.meta)) return null

  let text = firstFrame.meta.baseText ?? ''
  let cursorPosition = text.length
  let selectionLength = 0
  let valid = true

  for (const event of orderedEvents) {
    if (event.timestamp > thresholdTime) break
    if (event.type === 'document_frame') {
      const applied = applyDocumentFrame(text, event.meta)
      text = applied.text
      cursorPosition = applied.cursorPosition
      selectionLength = applied.selectionLength
      valid = applied.valid
    } else if (
      event.type === 'snapshot' &&
      event.meta &&
      typeof event.meta === 'object' &&
      typeof (event.meta as { text?: unknown }).text === 'string'
    ) {
      const snapshotText = (event.meta as { text: string }).text
      if (snapshotText !== text) {
        text = snapshotText
        cursorPosition = text.length
        selectionLength = 0
      }
      valid = true
    }
  }

  return { text, cursorPosition, selectionLength, valid }
}

/**
 * Keystroke Capture Composable
 * 
 * Captures all keyboard events with:
 * - IME composition filtering (Korean input)
 * - IKI (Inter-Keystroke Interval) computation
 * - SHA-256 hash chaining
 * - In-memory buffering with periodic batch flush
 * - toolbar_action virtual event injection
 */

import { ref, onUnmounted } from 'vue'

export interface TelemetryEvent {
  seq: number
  timestamp: number
  iki: number
  type: 'keydown' | 'keyup' | 'paste' | 'blur' | 'focus' | 'toolbar_action'
  meta: {
    key?: string
    cursorPosition?: number
    pasteLength?: number
    actionType?: string
  }
  currentHash: string
}

// Browser-compatible SHA-256
async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(message)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function useKeystrokeCapture(onFlush: (events: TelemetryEvent[]) => void) {
  const buffer = ref<TelemetryEvent[]>([])
  const sequenceNum = ref(0)
  let lastKeyTime = 0
  let lastHash = '0'.repeat(64) // Initial hash
  let isComposing = false
  let flushTimer: ReturnType<typeof setInterval> | null = null
  let blurStartTime: number | null = null

  const FLUSH_INTERVAL = 5000 // 5 seconds
  const FLUSH_THRESHOLD = 50  // or 50 events

  // Start periodic flush
  flushTimer = setInterval(() => {
    flushBuffer()
  }, FLUSH_INTERVAL)

  async function addEvent(
    type: TelemetryEvent['type'],
    meta: TelemetryEvent['meta']
  ) {
    const now = Date.now()
    const iki = lastKeyTime > 0 ? now - lastKeyTime : 0
    if (type === 'keydown' || type === 'keyup') {
      lastKeyTime = now
    }

    const event: Omit<TelemetryEvent, 'currentHash'> = {
      seq: sequenceNum.value++,
      timestamp: now,
      iki,
      type,
      meta,
    }

    // Compute hash chain
    const payload = lastHash + JSON.stringify(event)
    const hash = await sha256(payload)
    lastHash = hash

    const fullEvent: TelemetryEvent = { ...event, currentHash: hash }
    buffer.value.push(fullEvent)

    // Flush if threshold reached
    if (buffer.value.length >= FLUSH_THRESHOLD) {
      flushBuffer()
    }
  }

  function flushBuffer() {
    if (buffer.value.length === 0) return
    const batch = [...buffer.value]
    buffer.value = []
    onFlush(batch)
  }

  // ── Keyboard event handlers ──

  function handleKeyDown(e: KeyboardEvent, cursorPos: number) {
    // IME composition filter: ignore during composition
    if (isComposing || e.isComposing) return
    // Ignore modifier-only keys
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return

    addEvent('keydown', {
      key: e.key,
      cursorPosition: cursorPos,
    })
  }

  function handleKeyUp(e: KeyboardEvent, cursorPos: number) {
    if (isComposing || e.isComposing) return
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return

    addEvent('keyup', {
      key: e.key,
      cursorPosition: cursorPos,
    })
  }

  function handleCompositionStart() {
    isComposing = true
  }

  function handleCompositionEnd(e: CompositionEvent, cursorPos: number) {
    isComposing = false
    // Record the completed composition as a single keydown
    if (e.data) {
      addEvent('keydown', {
        key: e.data,
        cursorPosition: cursorPos,
      })
    }
  }

  function handlePaste(pasteLength: number, cursorPos: number, isCB: boolean = false) {
    addEvent('paste', {
      pasteLength,
      cursorPosition: cursorPos,
      actionType: isCB ? 'CB' : undefined,
    })
  }

  function handleBlur() {
    blurStartTime = Date.now()
    addEvent('blur', { cursorPosition: 0 })
  }

  function handleFocus() {
    addEvent('focus', { cursorPosition: 0 })
    blurStartTime = null
  }

  function handleToolbarAction(actionType: string, cursorPos: number) {
    addEvent('toolbar_action', {
      actionType,
      cursorPosition: cursorPos,
    })
  }

  // ── Cleanup ──
  function forceFlush() {
    flushBuffer()
  }

  onUnmounted(() => {
    if (flushTimer) clearInterval(flushTimer)
    flushBuffer()
  })

  return {
    buffer,
    handleKeyDown,
    handleKeyUp,
    handleCompositionStart,
    handleCompositionEnd,
    handlePaste,
    handleBlur,
    handleFocus,
    handleToolbarAction,
    forceFlush,
    flushBuffer,
  }
}

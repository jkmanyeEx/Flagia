<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { marked } from 'marked'
import RichTextEditor from '../components/RichTextEditor.vue'
import { useAuth } from '../composables/useAuth'
import { api } from '../composables/useApi'
import { resolveApiBase, resolveWsUrl } from '../composables/apiHost'

const API = resolveApiBase()
const WS_URL = resolveWsUrl()
const route = useRoute()
const router = useRouter()
const { user, token } = useAuth()

// State
const assignment = ref<any>(null)
const submission = ref<any>(null)
const sessionId = ref('')
const content = ref('')
const isLocked = ref(false)
const submitted = ref(false)
const loading = ref(true)
const wsConnected = ref(false)
const submitting = ref(false)
const submitOutcome = ref<'normal' | 'teacher' | 'timer' | 'forced-unknown'>('normal')
const submitError = ref('')

const showSubmitModal = ref(false)
const bypassLeaveGuard = ref(false)

// Timer
const timerSeconds = ref(0)
const timerDisplay = computed(() => {
  const m = Math.floor(timerSeconds.value / 60)
  const s = timerSeconds.value % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
})
const timerDanger = computed(() => {
  if (!assignment.value) return false
  const totalSec = assignment.value.time_limit * 60
  return timerSeconds.value <= Math.min(300, totalSec * 0.1)
})

// Split pane state removed since we are using single pane rich text editor
// Text stats
const wordCount = computed(() => {
  const text = stripHtml(content.value).trim()
  return countGraphemes(text)
})
const readingTime = computed(() => {
  const wpm = 200 // Korean characters per minute
  const time = Math.ceil(wordCount.value / wpm)
  return time
})

// Rendered html (Not needed for rich text editor, but kept for compatibility if needed elsewhere, though we now edit HTML directly)
const renderedHtml = computed(() => content.value)

// Whether the assignment ships a guideline template. When present we show it in a
// read-only left pane beside the editor; when absent the editor is full-width.
const hasTemplate = computed(() => !!stripHtml(assignment.value?.template_text || '').trim())

// ── Telemetry ──
let ws: WebSocket | null = null
let eventBuffer: any[] = []
let sequenceCounter = 0
let lastKeyTime = 0
let timerInterval: any = null
let flushInterval: any = null
let autoSaveInterval: any = null
let snapshotInterval: any = null
let lastSnapshotText = ''
let batchCounter = 0
const pendingBatchAcks = new Map<string, (saved: boolean) => void>()
const pendingFlushes = new Set<Promise<boolean>>()
const LIVE_UPDATE_INTERVAL_MS = 200
let liveUpdateTimer: ReturnType<typeof setTimeout> | null = null
let liveSessionReady = false
let liveRevision = 0
let lastLiveContent: string | null = null
let lastLiveSentAt = 0
let componentUnmounted = false

// Active-writing-time tracking. The countdown is a budget of *active* seconds
// (assignment.time_limit minutes) that persists across sessions: leaving the
// site pauses it, reopening resumes it. baseSpentSec is the time already used
// in prior sessions (loaded from the server); sessionStartMs anchors this
// session's elapsed time to wall-clock so background-tab throttling can't drift it.
let baseSpentSec = 0
let sessionStartMs = 0

function currentSpentSec(): number {
  if (!sessionStartMs) return baseSpentSec
  return baseSpentSec + (Date.now() - sessionStartMs) / 1000
}

function computeIKI() {
  const now = Date.now()
  const iki = lastKeyTime ? now - lastKeyTime : 0
  lastKeyTime = now
  return iki
}

async function hashSHA256(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

async function pushEvent(type: string, meta: any = {}) {
  const hash = await hashSHA256(content.value.slice(0, 100))
  eventBuffer.push({
    seq: ++sequenceCounter,
    timestamp: Date.now(),
    iki: computeIKI(),
    type,
    meta,
    currentHash: hash,
  })
}

// ── Plain-text snapshots (root fix for Korean/IME replay) ──
// Reconstructing what was on screen from raw keystrokes is unreliable for
// composed scripts (Hangul jamo combine into syllables via the IME, so the
// keystroke stream doesn't map 1:1 to characters). Instead we periodically
// record the editor's actual plain text. The replay prefers these snapshots
// when present and falls back to the keystroke automaton for old submissions.
// The engine ignores 'snapshot' events entirely, so this has no scoring impact.
// Count user-perceived characters (graphemes) so a multi-codepoint emoji counts
// as 1 — not 2+ as String.length (which counts UTF-16 code units) would report.
const _graphemeSeg = typeof Intl !== 'undefined' && (Intl as any).Segmenter
  ? new (Intl as any).Segmenter('ko', { granularity: 'grapheme' })
  : null
function countGraphemes(text: string): number {
  if (!text) return 0
  if (_graphemeSeg) {
    let n = 0
    for (const _ of _graphemeSeg.segment(text)) n++
    return n
  }
  return [...text].length // fallback: code points (still fixes surrogate pairs)
}

function stripHtml(html: string): string {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function captureSnapshot(force = false) {
  if ((!force && isLocked.value) || submitted.value) return
  const text = stripHtml(content.value)
  if (text === lastSnapshotText) return // only on change
  lastSnapshotText = text
  // Snapshots don't represent typing rhythm, so iki is irrelevant — set 0.
  eventBuffer.push({
    seq: ++sequenceCounter,
    timestamp: Date.now(),
    iki: 0,
    type: 'snapshot',
    meta: { text },
    currentHash: '',
  })
}

function clearLiveUpdateTimer() {
  if (!liveUpdateTimer) return
  clearTimeout(liveUpdateTimer)
  liveUpdateTimer = null
}

function sendLiveContent(force = false) {
  clearLiveUpdateTimer()
  if (
    !liveSessionReady ||
    !ws ||
    ws.readyState !== WebSocket.OPEN ||
    !submission.value ||
    submitted.value ||
    isLocked.value
  ) {
    return false
  }

  const text = stripHtml(content.value)
  if (!force && text === lastLiveContent) return false

  const nextRevision = liveRevision + 1
  const sentAt = Date.now()
  try {
    ws.send(JSON.stringify({
      type: 'live_content_update',
      payload: {
        submissionId: submission.value.id,
        assignmentId: String(route.params.assignmentId),
        content: text,
        revision: nextRevision,
        sentAt,
      },
    }))
    liveRevision = nextRevision
    lastLiveContent = text
    lastLiveSentAt = sentAt
    return true
  } catch {
    return false
  }
}

// Leading/trailing throttle: the full current document is relayed at most once
// per 200ms, and the final change in a burst is always scheduled.
function scheduleLiveContentUpdate() {
  if (
    !liveSessionReady ||
    submitted.value ||
    isLocked.value ||
    !ws ||
    ws.readyState !== WebSocket.OPEN
  ) {
    return
  }

  const wait = Math.max(0, LIVE_UPDATE_INTERVAL_MS - (Date.now() - lastLiveSentAt))
  if (wait === 0) {
    sendLiveContent()
    return
  }
  if (!liveUpdateTimer) {
    liveUpdateTimer = setTimeout(() => {
      liveUpdateTimer = null
      sendLiveContent()
    }, wait)
  }
}

watch(content, scheduleLiveContentUpdate)

function flushEvents(): Promise<boolean> {
  if (eventBuffer.length === 0) {
    if (pendingFlushes.size === 0) return Promise.resolve(true)
    return Promise.all([...pendingFlushes]).then(results => results.every(Boolean))
  }
  if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId.value) return Promise.resolve(false)
  const batch = [...eventBuffer]
  eventBuffer = []
  const batchId = `${sessionId.value}-${++batchCounter}`
  ws.send(JSON.stringify({
    type: 'event_batch',
    payload: {
      events: batch,
      batchId,
    }
  }))
  const pending = new Promise<boolean>(resolve => {
    const timeout = setTimeout(() => {
      pendingBatchAcks.delete(batchId)
      resolve(false)
    }, 1200)
    pendingBatchAcks.set(batchId, saved => {
      clearTimeout(timeout)
      resolve(saved)
    })
  })
  pendingFlushes.add(pending)
  void pending.finally(() => pendingFlushes.delete(pending))
  return pending
}

// ── WebSocket ──
let reconnectTimer: any = null

function connectWS() {
  if (!token.value || componentUnmounted) return
  if (ws && ws.readyState === WebSocket.OPEN) return

  liveSessionReady = false
  liveRevision = 0
  lastLiveContent = null
  lastLiveSentAt = 0
  clearLiveUpdateTimer()
  ws = new WebSocket(WS_URL)
  ws.onopen = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    ws?.send(JSON.stringify({
      type: 'auth',
      payload: { token: token.value }
    }))
  }
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      if (msg.type === 'auth_ok') {
        wsConnected.value = true
        ws?.send(JSON.stringify({
          type: 'join_session',
          payload: {
            submissionId: submission.value?.id,
            assignmentId: route.params.assignmentId
          }
        }))
      } else if (msg.type === 'session_ready') {
        sessionId.value = msg.payload.sessionId
        liveSessionReady = true
        // A new connection has a new revision sequence. Send the complete
        // current document once so teachers recover any changes made offline.
        sendLiveContent(true)
        // Drain anything that buffered while (re)connecting so a brief WS drop
        // (deploy/network) doesn't strand keystrokes.
        flushEvents()
      } else if (msg.type === 'batch_ack' && msg.payload?.batchId) {
        const resolve = pendingBatchAcks.get(msg.payload.batchId)
        if (resolve) {
          pendingBatchAcks.delete(msg.payload.batchId)
          resolve(true)
        }
      } else if (msg.type === 'force_close' || msg.type === 'submit_required') {
        handleSessionEnd(msg.type === 'force_close' ? 'teacher' : 'timer')
      }
    } catch { /* noop */ }
  }
  ws.onclose = () => {
    wsConnected.value = false
    liveSessionReady = false
    sessionId.value = ''
    clearLiveUpdateTimer()
    if (!submitted.value && !componentUnmounted) {
      reconnectTimer = setTimeout(connectWS, 3000)
    }
  }
  ws.onerror = () => {
    wsConnected.value = false
  }
}

// ── Keyboard handlers ──
function handleKeydown(e: KeyboardEvent, selection?: { cursor: number; selectionLength: number }) {
  if (isLocked.value) return
  pushEvent('keydown', {
    key: e.key,
    cursorPosition: selection?.cursor ?? 0,
    selectionLength: selection?.selectionLength ?? 0,
    // Capture modifier state so the replay can distinguish a shortcut
    // (e.g. Ctrl/Cmd+B) from a literal character keystroke.
    mod: e.ctrlKey || e.metaKey || e.altKey,
    v: 2,
  })
}

// Snippets the student copied/cut from THIS page (editor or template pane) this
// session. Pasting one of these back in is legitimate (moving/duplicating their
// own text or quoting the provided template), so such pastes are tagged
// `internal` and excluded from the external-content score by the engine.
let copiedSnippets: string[] = []
function normalizeClip(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim()
}
function handleCopyCut() {
  const sel = normalizeClip(window.getSelection?.()?.toString() ?? '')
  if (sel.length < 2) return
  copiedSnippets.push(sel)
  if (copiedSnippets.length > 50) copiedSnippets.shift() // bound memory
}

function handlePaste(e: ClipboardEvent, selection?: { cursor: number; selectionLength: number }) {
  if (isLocked.value) { e.preventDefault(); return }
  const text = e.clipboardData?.getData('text') || ''
  // Legal if the pasted text was copied from somewhere on this page this session.
  const norm = normalizeClip(text)
  const internal = norm.length >= 2 && copiedSnippets.some(
    s => s === norm || s.includes(norm) || norm.includes(s)
  )
  pushEvent('paste', {
    pasteLength: text.length,
    pasteContent: text,
    cursorPosition: selection?.cursor ?? 0,
    selectionLength: selection?.selectionLength ?? 0,
    internal,
    v: 2,
  })
}

// "Editor leave" means leaving the browser tab/window (e.g. to look something
// up or copy from an AI tool) — NOT losing focus from the contenteditable.
// Clicking a toolbar button or the submit button blurs the editor element but
// keeps the tab focused, so those must not count. We therefore track the tab
// (document.visibilitychange) and the window (window blur/focus) instead of
// the editor's own @blur/@focus.
let windowBlurred = false
let tabLeft = false

function pauseActiveTimer() {
  if (!sessionStartMs) return
  baseSpentSec += (Date.now() - sessionStartMs) / 1000
  sessionStartMs = 0
}

function resumeActiveTimer() {
  if (sessionStartMs) return
  sessionStartMs = Date.now()
}

function handleWindowBlur() {
  if (isLocked.value || submitting.value) return
  if (tabLeft) return
  if (windowBlurred) return
  windowBlurred = true
  pushEvent('blur')
}
function handleWindowFocus() {
  if (tabLeft) return
  if (!windowBlurred) return
  windowBlurred = false
  pushEvent('focus')
}
function handleVisibility() {
  if (isLocked.value || submitting.value) return
  if (document.visibilityState === 'hidden') {
    if (!tabLeft) {
      if (windowBlurred) {
        windowBlurred = false
        pushEvent('focus')
      }
      tabLeft = true
      pushEvent('leave')
      pauseActiveTimer()
    }
  } else {
    if (tabLeft) {
      tabLeft = false
      pushEvent('reconnect')
      resumeActiveTimer()
      if (document.hasFocus()) {
        windowBlurred = false
      } else {
        windowBlurred = true
        pushEvent('blur')
      }
    }
  }
}

// ── Toolbar actions ──
// Handled by RichTextEditor natively now

// ── Timer ──
function startTimer() {
  if (!assignment.value) return
  // Resume from time already spent in earlier sessions instead of resetting.
  baseSpentSec = Math.max(0, Number(submission.value?.time_spent_sec) || 0)
  sessionStartMs = Date.now()
  tickTimer()
  timerInterval = setInterval(tickTimer, 1000)
}

function tickTimer() {
  const totalSec = (assignment.value?.time_limit || 0) * 60
  const remaining = Math.max(0, totalSec - currentSpentSec())
  timerSeconds.value = Math.ceil(remaining)
  if (remaining <= 0) {
    clearInterval(timerInterval)
    handleSessionEnd('timer')
  }
}

async function handleSessionEnd(reason: 'teacher' | 'timer') {
  if (isLocked.value || submitted.value || submitting.value) return
  submitOutcome.value = reason
  sendLiveContent()
  isLocked.value = true
  showSubmitModal.value = false
  clearInterval(timerInterval)
  clearInterval(autoSaveInterval)
  clearInterval(snapshotInterval)
  // captureSnapshot normally skips a locked editor. Force mode records the
  // exact document the student saw at the moment the session was ended.
  captureSnapshot(true)
  await flushEvents()
  // Persist the same latest document as a draft before finalization. If the
  // final request is interrupted, the server-side fallback can still submit it.
  await saveDraft()
  await submitEssay(true, reason)
}

// ── Submit ──
async function submitEssay(forceClose = false, reason: 'teacher' | 'timer' | 'normal' = 'normal') {
  if (submitting.value) return
  submitting.value = true
  submitError.value = ''
  const wasLocked = isLocked.value
  sendLiveContent()
  isLocked.value = true
  captureSnapshot(true)
  await flushEvents()
  
  try {
    const res = await fetch(`${API}/api/submissions/${submission.value.id}/submit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
      body: JSON.stringify({ finalMarkdown: content.value, forceClose }),
    })
    if (res.ok) {
      const result = await res.json().catch(() => ({}))
      submitted.value = true
      isLocked.value = true
      submission.value.status = result.status || (forceClose ? 'FORCE_CLOSED' : 'SUBMITTED')
      submitOutcome.value = submission.value.status === 'FORCE_CLOSED'
        ? (reason === 'normal' ? 'forced-unknown' : reason)
        : 'normal'
      clearInterval(timerInterval)
      clearInterval(flushInterval)
      clearInterval(autoSaveInterval)
      clearInterval(snapshotInterval)
      ws?.close()
    } else {
      const error = await res.json().catch(() => ({}))
      throw new Error(error.error || '제출에 실패했습니다')
    }
  } catch (err) {
    console.error('Submit error:', err)
    submitError.value = err instanceof Error ? err.message : '제출 처리 중 오류가 발생했습니다'
    // A teacher/timer-closed editor must remain locked while the server fallback
    // runs. Re-read the existing submission shortly afterwards so a transient
    // HTTP disconnect still reaches the correct completion screen.
    if (forceClose) {
      setTimeout(refreshFinalState, 3200)
    } else {
      isLocked.value = wasLocked
    }
  } finally {
    submitting.value = false
  }
}

async function refreshFinalState() {
  if (!submission.value || submitted.value) return
  try {
    const res = await fetch(`${API}/api/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
      body: JSON.stringify({ assignmentId: route.params.assignmentId }),
    })
    if (!res.ok) return
    const latest = await res.json()
    if (latest.status === 'FORCE_CLOSED' || latest.status === 'SUBMITTED') {
      submission.value = latest
      content.value = latest.final_markdown || content.value
      submitted.value = true
      isLocked.value = true
      submitOutcome.value = latest.status === 'FORCE_CLOSED'
        ? (submitOutcome.value === 'normal' ? 'forced-unknown' : submitOutcome.value)
        : 'normal'
      submitError.value = ''
      ws?.close()
    }
  } catch {
    // Keep the editor locked; reloading the page will read the final server state.
  }
}

// ── Beacon draft-save on window close ──
// Every assignment is resumable, so closing the window never submits — this
// just persists the latest draft (the 30s auto-save may not have run yet).
// The "left the site" timestamp is recorded server-side as a `leave` event
// when the WebSocket disconnects, so the disconnected interval can be excluded
// from writing-time analysis.
function beaconSubmit() {
  if (submitted.value || !submission.value) return
  sendLiveContent()
  // Include any keystroke events that haven't been flushed over the WS yet, so
  // closing the tab mid-write doesn't lose the tail of the writing process.
  captureSnapshot()
  const pending = eventBuffer.splice(0)
  const data = JSON.stringify({
    finalMarkdown: content.value,
    timeSpentSec: Math.round(currentSpentSec()),
    events: pending,
  })
  navigator.sendBeacon(`${API}/api/submissions/${submission.value.id}/beacon`, new Blob([data], { type: 'application/json' }))
}

// Persist the current content as a draft without submitting. Used by the
// periodic auto-save, the leave guard, and the "save & back to list" action.
async function saveDraft() {
  if (!submission.value || submitted.value) return
  try {
    await fetch(`${API}/api/submissions/${submission.value.id}/draft`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
      body: JSON.stringify({ markdown: content.value, timeSpentSec: Math.round(currentSpentSec()) }),
    })
  } catch { /* noop */ }
}

// ── Split pane drag ──
// Removed

// ── Lifecycle ──
onMounted(async () => {
  try {
    // Fetch assignment
    const aRes = await fetch(`${API}/api/assignments/${route.params.assignmentId}`, {
      headers: { Authorization: `Bearer ${token.value}` },
    })
    if (!aRes.ok) throw new Error('Assignment not found')
    assignment.value = await aRes.json()

    // Create or fetch submission
    const sRes = await fetch(`${API}/api/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
      body: JSON.stringify({ assignmentId: route.params.assignmentId }),
    })
    if (!sRes.ok) throw new Error('Submission error')
    submission.value = await sRes.json()

    // Check if already submitted
    if (submission.value.status !== 'IN_PROGRESS') {
      isLocked.value = true
      submitted.value = true
      submitOutcome.value = submission.value.status === 'FORCE_CLOSED' ? 'forced-unknown' : 'normal'
      content.value = submission.value.final_markdown || ''
      loading.value = false
      return
    }

    // Set initial content. The template is shown in the read-only left pane, so
    // the writing field starts EMPTY (only a saved draft repopulates it) rather
    // than being pre-filled with the template.
    content.value = submission.value.final_markdown || ''

    // Connect WS
    connectWS()
    startTimer()

    // Periodic flush (every 2s) — frequent so a WS drop strands as little as possible
    flushInterval = setInterval(flushEvents, 2000)

    // Auto-save draft + elapsed time (every 15s)
    autoSaveInterval = setInterval(saveDraft, 15000)

    // Plain-text snapshot for accurate replay (every 2s, only on change)
    lastSnapshotText = stripHtml(content.value)
    snapshotInterval = setInterval(captureSnapshot, 2000)
  } catch (err) {
    console.error('Init error:', err)
  } finally {
    loading.value = false
  }

  window.addEventListener('beforeunload', beaconSubmit)
  window.addEventListener('blur', handleWindowBlur)
  window.addEventListener('focus', handleWindowFocus)
  document.addEventListener('visibilitychange', handleVisibility)
  document.addEventListener('copy', handleCopyCut)
  document.addEventListener('cut', handleCopyCut)
})

onBeforeUnmount(() => {
  componentUnmounted = true
  if (reconnectTimer) clearTimeout(reconnectTimer)
  clearInterval(timerInterval)
  clearInterval(flushInterval)
  clearInterval(autoSaveInterval)
  clearInterval(snapshotInterval)
  sendLiveContent()
  clearLiveUpdateTimer()
  captureSnapshot()
  flushEvents()
  ws?.close()
  window.removeEventListener('beforeunload', beaconSubmit)
  window.removeEventListener('blur', handleWindowBlur)
  window.removeEventListener('focus', handleWindowFocus)
  document.removeEventListener('visibilitychange', handleVisibility)
  document.removeEventListener('copy', handleCopyCut)
  document.removeEventListener('cut', handleCopyCut)
})

onBeforeRouteLeave(() => {
  if (bypassLeaveGuard.value) return true
  // Every assignment is resumable — leaving is always allowed. Silently persist
  // the draft so the student can come back and continue where they left off.
  if (!submitted.value) saveDraft()
  return true
})

async function confirmSubmit() {
  await submitEssay(false, 'normal')
  showSubmitModal.value = false
}
</script>

<template>
  <!-- Loading -->
  <div v-if="loading" class="min-h-screen flex items-center justify-center bg-background">
    <div class="flex flex-col items-center gap-3">
      <div class="w-10 h-10 border-3 border-primary border-t-transparent rounded-full animate-spin"></div>
      <span class="text-sm text-text-secondary">에디터를 불러오는 중...</span>
    </div>
  </div>

  <!-- Submitted overlay -->
  <div v-else-if="submitted" class="min-h-screen bg-background flex items-center justify-center p-6">
    <div class="card p-10 max-w-md text-center">
      <div class="text-5xl mb-4">{{ submitOutcome === 'teacher' ? '🔒' : '✅' }}</div>
      <h2 class="text-xl font-bold text-text-primary mb-2">
        {{ submitOutcome === 'teacher'
          ? '강제 종료되어 자동 제출되었습니다'
          : submitOutcome === 'timer'
            ? '시간이 만료되어 자동 제출되었습니다'
            : submitOutcome === 'forced-unknown'
              ? '자동 제출되었습니다'
              : '제출 완료' }}
      </h2>
      <p class="text-sm text-text-secondary mb-2">
        <template v-if="submitOutcome === 'teacher'">
          교사에 의해 작성이 종료되었습니다. <strong>{{ assignment?.title }}</strong>의 최신 내용이 안전하게 제출되었습니다.
        </template>
        <template v-else>
          <strong>{{ assignment?.title }}</strong>에 대한 글이 성공적으로 제출되었습니다.
        </template>
      </p>
      <p class="text-xs text-text-muted mb-6">
        Flagia 분석 엔진이 작성 과정을 분석하고 있습니다.
      </p>
      
      <div class="flex flex-col gap-2">
        <button v-if="submission?.id" @click="router.push(`/analysis/${submission.id}`)" class="btn btn-primary w-full">
          분석 결과 보기
        </button>
        <button @click="router.push('/student')" class="btn btn-outline w-full">
          과제 목록으로
        </button>
      </div>
    </div>
  </div>

  <!-- Editor -->
  <div v-else class="h-screen flex flex-col bg-background">
    <!-- Top Bar -->
    <div class="flex items-center justify-between px-4 py-2.5 bg-white border-b border-border">
      <div class="flex items-center gap-3">
        <button @click="router.push('/student')" class="btn btn-ghost btn-xs">
          ← 뒤로
        </button>
        <div class="w-px h-5 bg-border"></div>
        <h2 class="text-sm font-semibold text-text-primary truncate max-w-xs">
          {{ assignment?.title }}
        </h2>
      </div>

      <div class="flex items-center gap-4">
        <!-- Connection status -->
        <div class="flex items-center gap-1.5">
          <span class="status-dot" :class="wsConnected ? 'connected' : 'disconnected'"></span>
          <span class="text-xs text-text-muted">{{ wsConnected ? '연결됨' : '연결 끊김' }}</span>
        </div>

        <!-- Timer -->
        <div class="timer" :class="{ 'timer-danger': timerDanger }">
          {{ timerDisplay }}
        </div>

        <!-- Submit -->
        <button @click="showSubmitModal = true" class="btn btn-primary btn-sm" :disabled="isLocked || submitting || wordCount === 0">
          <svg v-if="submitting" class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          {{ submitting ? '제출 중...' : isLocked ? '작성 종료됨' : '제출하기' }}
        </button>
      </div>
    </div>

    <div v-if="submitError" class="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {{ submitError }}
    </div>

    <!-- Editor area: read-only template pane (left, only when a template exists) + editor (right) -->
    <div class="flex-1 p-4 lg:px-8 pb-8 overflow-hidden bg-background">
      <div class="max-w-6xl mx-auto h-full flex flex-col lg:flex-row gap-4">
        <!-- Template pane (read-only reference) — gray to distinguish from the
             white editor; no header so its top aligns with the editor's. -->
        <div v-if="hasTemplate" class="flex flex-col min-h-0 shrink-0 h-44 lg:h-full lg:w-1/2">
          <div class="flex-1 min-h-0 overflow-y-auto border border-border rounded-lg p-5"
               style="box-shadow: 0 4px 20px rgba(0,0,0,0.05); background: #f3f4f6;">
            <div class="markdown-body ProseMirror" v-html="assignment?.template_text"></div>
          </div>
        </div>

        <!-- Editor pane -->
        <div class="flex-1 flex flex-col min-h-0">
          <div class="flex-1 min-h-0" style="box-shadow: 0 4px 20px rgba(0,0,0,0.05); border-radius: 0.5rem; overflow: hidden;">
            <RichTextEditor
              v-model="content"
              :disabled="isLocked"
              placeholder="여기에 글을 작성하세요..."
              @keydown="(e, selection) => handleKeydown(e, selection)"
              @paste="(e, selection) => handlePaste(e, selection)"
            />
          </div>

          <!-- Text stats & limit warning -->
          <div class="mt-3 flex items-center justify-between">
            <div class="flex items-center gap-3 text-xs text-text-muted">
              <span>{{ wordCount.toLocaleString() }}자</span>
              <span v-if="assignment?.text_limit" :class="wordCount > assignment.text_limit ? 'text-danger font-semibold' : ''">
                / {{ assignment.text_limit.toLocaleString() }}
              </span>
              <span>·</span>
              <span>{{ readingTime }}분 읽기</span>
            </div>
            <div v-if="assignment?.text_limit && wordCount > assignment.text_limit" class="text-xs text-danger font-medium flex items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              제한 {{ (wordCount - assignment.text_limit).toLocaleString() }}자 초과
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Submit Confirmation Modal -->
    <div v-if="showSubmitModal" class="modal-overlay" @click.self="!submitting && (showSubmitModal = false)">
      <div class="modal-content max-w-sm mx-4 p-6 text-center">
        <div class="text-4xl mb-4">📝</div>
        <h3 class="text-lg font-bold mb-2">글 제출하기</h3>
        <p class="text-sm text-text-secondary mb-6">글을 제출하시겠습니까?<br>제출 후에는 더 이상 수정할 수 없습니다.</p>
        <div class="flex gap-2">
          <button @click="showSubmitModal = false" class="btn btn-outline flex-1" :disabled="submitting">취소</button>
          <button @click="confirmSubmit" class="btn btn-primary flex-1" :disabled="submitting">
            <svg v-if="submitting" class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            {{ submitting ? '제출 중...' : '제출' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

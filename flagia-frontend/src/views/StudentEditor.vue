<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { marked } from 'marked'
import RichTextEditor from '../components/RichTextEditor.vue'
import { useAuth } from '../composables/useAuth'
import { api } from '../composables/useApi'

function resolveApiBase(): string {
  if (import.meta.env.DEV) return ''
  const host = window.location.hostname
  if (host === 'flagia.devmeko.xyz') return 'https://flagiaapi.devmeko.xyz'
  return `${window.location.protocol}//${host}:3502`
}

const API = resolveApiBase()
const WS_URL = import.meta.env.PROD
  ? (window.location.hostname === 'flagia.devmeko.xyz' ? 'wss://flagiaapi.devmeko.xyz/ws' : `ws://${window.location.hostname}:3502/ws`)
  : 'ws://localhost:3502/ws'
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

const showLeaveModal = ref(false)
const showSubmitModal = ref(false)
const pendingRoute = ref<string | null>(null)
const bypassLeaveGuard = ref(false)
const initialContent = ref('')

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
  const text = content.value.trim()
  return text.length
})
const readingTime = computed(() => {
  const wpm = 200 // Korean characters per minute
  const time = Math.ceil(wordCount.value / wpm)
  return time
})

// Rendered html (Not needed for rich text editor, but kept for compatibility if needed elsewhere, though we now edit HTML directly)
const renderedHtml = computed(() => content.value)

// ── Telemetry ──
let ws: WebSocket | null = null
let eventBuffer: any[] = []
let sequenceCounter = 0
let lastKeyTime = 0
let timerInterval: any = null
let flushInterval: any = null
let autoSaveInterval: any = null

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

function flushEvents() {
  if (eventBuffer.length === 0 || !ws || ws.readyState !== WebSocket.OPEN || !sessionId.value) return
  const batch = [...eventBuffer]
  eventBuffer = []
  ws.send(JSON.stringify({
    type: 'event_batch',
    payload: {
      events: batch
    }
  }))
}

// ── WebSocket ──
let reconnectTimer: any = null

function connectWS() {
  if (!token.value) return
  if (ws && ws.readyState === WebSocket.OPEN) return

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
      } else if (msg.type === 'force_close' || msg.type === 'submit_required') {
        handleTimeExpired()
      }
    } catch { /* noop */ }
  }
  ws.onclose = () => {
    wsConnected.value = false
    reconnectTimer = setTimeout(connectWS, 3000)
  }
  ws.onerror = () => {
    wsConnected.value = false
  }
}

// ── Keyboard handlers ──
function handleKeydown(e: KeyboardEvent, cursor?: number) {
  if (isLocked.value) return
  pushEvent('keydown', {
    key: e.key,
    cursorPosition: cursor ?? 0,
  })
}

function handlePaste(e: ClipboardEvent, cursor?: number) {
  if (isLocked.value) { e.preventDefault(); return }
  const text = e.clipboardData?.getData('text') || ''
  pushEvent('paste', { 
    pasteLength: text.length,
    pasteContent: text,
    cursorPosition: cursor ?? 0
  })
}

function handleBlur() { if (submitting.value) return; pushEvent('blur') }
function handleFocus() { pushEvent('focus') }

// ── Toolbar actions ──
// Handled by RichTextEditor natively now

// ── Timer ──
function startTimer() {
  if (!assignment.value) return
  timerSeconds.value = assignment.value.time_limit * 60
  timerInterval = setInterval(() => {
    if (timerSeconds.value <= 0) {
      clearInterval(timerInterval)
      handleTimeExpired()
      return
    }
    timerSeconds.value--
  }, 1000)
}

function handleTimeExpired() {
  if (isLocked.value) return
  isLocked.value = true
  flushEvents()
  submitEssay(true)
}

// ── Submit ──
async function submitEssay(forceClose = false) {
  if (submitting.value) return
  submitting.value = true
  flushEvents()
  
  try {
    const res = await fetch(`${API}/api/submissions/${submission.value.id}/submit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
      body: JSON.stringify({ finalMarkdown: content.value, forceClose }),
    })
    if (res.ok) {
      submitted.value = true
      isLocked.value = true
      clearInterval(timerInterval)
      clearInterval(flushInterval)
    }
  } catch (err) {
    console.error('Submit error:', err)
  } finally {
    submitting.value = false
  }
}

// ── Beacon fallback ──
function beaconSubmit() {
  if (submitted.value || !submission.value) return
  const data = JSON.stringify({ finalMarkdown: content.value })
  navigator.sendBeacon(`${API}/api/submissions/${submission.value.id}/beacon`, new Blob([data], { type: 'application/json' }))
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
      content.value = submission.value.final_markdown || ''
      loading.value = false
      return
    }

    // Set initial content
    content.value = submission.value.final_markdown || assignment.value.template_text || ''
    initialContent.value = content.value

    // Connect WS
    connectWS()
    startTimer()

    // Periodic flush (every 5s)
    flushInterval = setInterval(flushEvents, 5000)

    // Auto-save draft (every 30s)
    autoSaveInterval = setInterval(() => {
      fetch(`${API}/api/submissions/${submission.value.id}/draft`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
        body: JSON.stringify({ markdown: content.value }),
      }).catch(() => {})
    }, 30000)
  } catch (err) {
    console.error('Init error:', err)
  } finally {
    loading.value = false
  }

  window.addEventListener('beforeunload', beaconSubmit)
})

onBeforeUnmount(() => {
  clearInterval(timerInterval)
  clearInterval(flushInterval)
  clearInterval(autoSaveInterval)
  flushEvents()
  ws?.close()
  window.removeEventListener('beforeunload', beaconSubmit)
})

const hasUnsavedChanges = computed(() => {
  if (submitted.value) return false
  return content.value !== initialContent.value
})

onBeforeRouteLeave((to) => {
  if (bypassLeaveGuard.value) return true
  if (hasUnsavedChanges.value) {
    showLeaveModal.value = true
    pendingRoute.value = to.fullPath
    return false
  }
  return true
})

function confirmLeave() {
  showLeaveModal.value = false
  bypassLeaveGuard.value = true
  if (pendingRoute.value) {
    router.push(pendingRoute.value)
  } else {
    router.push('/student')
  }
}

async function confirmSubmit() {
  await submitEssay(false)
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
      <div class="text-5xl mb-4">✅</div>
      <h2 class="text-xl font-bold text-text-primary mb-2">제출 완료</h2>
      <p class="text-sm text-text-secondary mb-2">
        <strong>{{ assignment?.title }}</strong>에 대한 글이 성공적으로 제출되었습니다.
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
        <button @click="showSubmitModal = true" class="btn btn-primary btn-sm" :disabled="submitting || wordCount === 0">
          <svg v-if="submitting" class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
          {{ submitting ? '제출 중...' : '제출하기' }}
        </button>
      </div>
    </div>

    <!-- Split Pane Editor Removed, Single Pane Rich Text Editor instead -->
    <div class="flex-1 p-4 lg:px-8 pb-8 overflow-hidden bg-background">
      <div class="max-w-4xl mx-auto h-full" style="box-shadow: 0 4px 20px rgba(0,0,0,0.05); border-radius: 0.5rem;">
        <RichTextEditor
          v-model="content"
          :disabled="isLocked"
          placeholder="여기에 글을 작성하세요..."
          @keydown="handleKeydown"
          @paste="handlePaste"
          @blur="handleBlur"
          @focus="handleFocus"
        />
        
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

    <!-- Leaving Confirmation Modal -->
    <div v-if="showLeaveModal" class="modal-overlay" @click.self="showLeaveModal = false">
      <div class="modal-content max-w-sm mx-4 p-6 text-center">
        <div class="text-4xl mb-4">⚠️</div>
        <h3 class="text-lg font-bold mb-2">작성 취소</h3>
        <p class="text-sm text-text-secondary mb-6">아직 제출하지 않은 내용이 있습니다.<br>정말 나가시겠습니까? 작성 중인 내용은 저장되지 않을 수 있습니다.</p>
        <div class="flex gap-2">
          <button @click="showLeaveModal = false" class="btn btn-outline flex-1">계속 작성</button>
          <button @click="confirmLeave" class="btn btn-primary flex-1">나가기</button>
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

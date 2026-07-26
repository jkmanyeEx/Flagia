<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'
import RichTextEditor from '../components/RichTextEditor.vue'

import { resolveApiBase, resolveWsUrl } from '../composables/apiHost'
import { translateError } from '../i18n'

const API = resolveApiBase()
const WS_URL = resolveWsUrl()
const router = useRouter()
const route = useRoute()
const { t, locale } = useI18n()
const { user, token, isAdmin } = useAuth()

// Admin sees every assignment (scope=all); teachers always get only their own
// regardless of the param. `owns()` decides whether action controls are shown.
const listUrl = `${API}/api/assignments?scope=all`
function owns(a: any) { return a?.teacher_id === user.value?.id }
// Admin was personally invited to this assignment (has a submission of their own).
function invited(a: any) { return !!a?.my_submission_id }

// State
const assignments = ref<any[]>([])
const selectedAssignment = ref<any>(null)
const submissions = ref<any[]>([])
const loading = ref(true)
const loadingSubs = ref(false)
const showCreateModal = ref(false)
const showDetailModal = ref(false)
const showDeleteModal = ref(false)
const assignmentToDelete = ref<string | null>(null)
const detailSubmission = ref<any>(null)
// Live monitoring: the student's current plain text, streamed while a teacher
// watches an in-progress submission.
const liveContent = ref<string | null>(null)
const isLiveWatching = ref(false)
const liveSocketAuthenticated = ref(false)
const liveStatusText = computed(() => {
  if (!isLiveWatching.value) return ''
  if (!liveSocketAuthenticated.value) return t('runtime.m_18ac45c75561')
  if (liveContent.value === null || liveContent.value.length === 0) return t('runtime.m_8d02e4577452')
  return t('runtime.m_5120bfaf81eb')
})
let latestLiveSentAt = 0
let latestLiveRevision = 0
let latestSnapshotSentAt = 0
let hasReceivedLiveUpdate = false
const showDeleteSubModal = ref(false)
const subToDelete = ref<any>(null)
const deletingSub = ref(false)
const showForceSubmitModal = ref(false)
const forceSubmitting = ref(false)
const forceSubmitRequestId = ref<string | null>(null)
const forceSubmitResult = ref<any>(null)
const forceSubmitMessage = ref('')
const forceSubmitIsError = ref(false)
let forceSubmitTimeout: ReturnType<typeof setTimeout> | null = null

// Create form
const form = ref({
  title: '',
  dueDate: '',
  timeLimit: 60,
  textLimit: 3000,
  maxScore: 100,
  templateText: '',
  mode: 'STANDARD',
})
const creating = ref(false)
const copySuccess = ref(false)

// Template view/edit
const showTemplateModal = ref(false)
const templateDraft = ref('')
const savingTemplate = ref(false)
// Owner teachers and admins may edit; everyone else views read-only.
const canEditSelected = computed(() =>
  !!selectedAssignment.value && (owns(selectedAssignment.value) || isAdmin.value)
)

function openTemplate() {
  templateDraft.value = selectedAssignment.value?.template_text || ''
  showTemplateModal.value = true
}

async function saveTemplate() {
  if (!selectedAssignment.value) return
  savingTemplate.value = true
  try {
    const res = await fetch(`${API}/api/assignments/${selectedAssignment.value.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
      body: JSON.stringify({ templateText: templateDraft.value }),
    })
    if (res.ok) {
      const updated = await res.json()
      selectedAssignment.value.template_text = updated.template_text
      const idx = assignments.value.findIndex(a => a.id === updated.id)
      if (idx >= 0) assignments.value[idx].template_text = updated.template_text
      showTemplateModal.value = false
    } else {
      const e = await res.json().catch(() => ({}))
      alert(translateError(e.code, e.error || t('runtime.m_e9ae0e983fce')))
    }
  } catch {
    alert(t('runtime.m_15435024be8c'))
  } finally {
    savingTemplate.value = false
  }
}

// Stats
const totalSubmissions = computed(() => submissions.value.length)
const submittedCount = computed(() =>
  submissions.value.filter(s => s.status === 'SUBMITTED' || s.status === 'FORCE_CLOSED').length
)
const avgScore = computed(() => {
  const scored = submissions.value.filter(s => s.flagia_score != null)
  if (scored.length === 0) return null
  const sum = scored.reduce((a, s) => a + Number(s.flagia_score), 0)
  return (sum / scored.length).toFixed(1)
})
const flaggedCount = computed(() =>
  submissions.value.filter(s => s.flag_status === 'AMBER' || s.flag_status === 'RED').length
)
const inProgressCount = computed(() =>
  submissions.value.filter(s => s.status === 'IN_PROGRESS').length
)
const canForceSubmitSelected = computed(() =>
  !!selectedAssignment.value && (owns(selectedAssignment.value) || isAdmin.value)
)

// Socket
let socket: WebSocket | null = null
let socketReconnectTimer: ReturnType<typeof setTimeout> | null = null
let socketUnmounted = false

function resetLiveOrdering(clearContent = false) {
  latestLiveSentAt = 0
  latestLiveRevision = 0
  latestSnapshotSentAt = 0
  hasReceivedLiveUpdate = false
  if (clearContent) liveContent.value = null
}

function connectWS() {
  if (!token.value) return
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return
  const currentSocket = new WebSocket(WS_URL)
  socket = currentSocket
  currentSocket.onopen = () => {
    currentSocket.send(JSON.stringify({
      type: 'auth',
      payload: { token: token.value }
    }))
  }
  currentSocket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      const { type, payload } = msg
      if (type === 'auth_ok') {
        liveSocketAuthenticated.value = true
        if (selectedAssignment.value) {
          currentSocket.send(JSON.stringify({
            type: 'teacher_join',
            payload: { assignmentId: selectedAssignment.value.id }
          }))
        }
        // Resume live-watch after a reconnect if the detail modal is still open.
        if (isLiveWatching.value && detailSubmission.value) {
          // The server immediately follows this with the latest DB snapshot.
          // Reset source priority so changes made while this socket was offline
          // can seed the view before new live updates resume.
          resetLiveOrdering()
          currentSocket.send(JSON.stringify({
            type: 'watch_submission',
            payload: { submissionId: detailSubmission.value.id }
          }))
        }
      } else if (type === 'submissions_update') {
        if (selectedAssignment.value && payload.assignmentId === selectedAssignment.value.id) {
          fetchSubmissionsSilently()
        }
      } else if (type === 'assignments_update') {
        fetchAssignmentsSilently()
      } else if (type === 'submission_content_update') {
        if (
          !isLiveWatching.value ||
          !detailSubmission.value ||
          payload?.submissionId !== detailSubmission.value.id ||
          typeof payload.content !== 'string' ||
          !Number.isFinite(payload.sentAt)
        ) return

        if (payload.source === 'live') {
          if (!Number.isSafeInteger(payload.revision) || payload.revision <= 0) return
          if (
            payload.sentAt < latestLiveSentAt ||
            (payload.sentAt === latestLiveSentAt && payload.revision <= latestLiveRevision)
          ) return
          latestLiveSentAt = payload.sentAt
          latestLiveRevision = payload.revision
          hasReceivedLiveUpdate = true
          liveContent.value = payload.content
        } else if (payload.source === 'snapshot') {
          // Once live data has arrived, delayed 2s snapshots are fallback-only
          // and must never roll the teacher's view back.
          if (hasReceivedLiveUpdate || payload.sentAt < latestSnapshotSentAt) return
          latestSnapshotSentAt = payload.sentAt
          liveContent.value = payload.content
        }
      } else if (type === 'force_submit_ack') {
        if (payload.requestId !== forceSubmitRequestId.value) return
        finishForceSubmitRequest()
        showForceSubmitModal.value = false
        forceSubmitResult.value = payload
        forceSubmitIsError.value = payload.failedCount > 0
        if (payload.targetCount === 0) {
          forceSubmitMessage.value = t('runtime.m_76597dada5a0')
        } else if (payload.failedCount > 0) {
          forceSubmitMessage.value = t('teacher.forceSummary', {
            closed: payload.forceClosedCount,
            failed: payload.failedCount,
          })
        } else {
          forceSubmitMessage.value = t('teacher.forceEnded', { count: payload.forceClosedCount })
        }
        fetchSubmissionsSilently()
      } else if (type === 'force_submit_error') {
        if (payload.requestId !== forceSubmitRequestId.value) return
        finishForceSubmitRequest()
        forceSubmitIsError.value = true
        forceSubmitMessage.value = translateError(payload.code, payload.error || t('runtime.m_70c0a59be9af'))
      }
    } catch (err) {
      console.error('WS message error:', err)
    }
  }
  currentSocket.onclose = () => {
    if (socket === currentSocket) socket = null
    liveSocketAuthenticated.value = false
    if (socketUnmounted) return
    if (socketReconnectTimer) clearTimeout(socketReconnectTimer)
    socketReconnectTimer = setTimeout(connectWS, 3000)
  }
  currentSocket.onerror = () => {
    liveSocketAuthenticated.value = false
  }
}

async function fetchSubmissionsSilently() {
  const a = selectedAssignment.value
  if (!a) return
  try {
    const res = await fetch(`${API}/api/assignments/${a.id}/submissions`, {
      headers: { Authorization: `Bearer ${token.value}` },
    })
    if (res.ok) {
      const nextSubmissions = await res.json()
      submissions.value = nextSubmissions
      if (detailSubmission.value) {
        const updated = nextSubmissions.find((sub: any) => sub.id === detailSubmission.value.id)
        if (updated) {
          if (detailSubmission.value.status === 'IN_PROGRESS' && updated.status !== 'IN_PROGRESS') {
            stopWatching()
            resetLiveOrdering(true)
          }
          detailSubmission.value = updated
        }
      }
    }
  } catch { /* noop */ }
}

async function fetchAssignmentsSilently() {
  try {
    const res = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${token.value}` },
    })
    if (res.ok) {
      const list = await res.json()
      assignments.value = list
      if (selectedAssignment.value) {
        const found = list.find((item: any) => item.id === selectedAssignment.value.id)
        if (found) {
          selectedAssignment.value = found
        } else {
          selectedAssignment.value = null
          submissions.value = []
        }
      }
    }
  } catch { /* noop */ }
}

let refreshInterval: any = null

onMounted(async () => {
  try {
    const res = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${token.value}` },
    })
    if (res.ok) {
      assignments.value = await res.json()
    }
  } catch { /* noop */ } finally { loading.value = false }
  connectWS()

  // Polling fallback: auto-refresh submissions or assignments list every 5 seconds
  refreshInterval = setInterval(() => {
    if (selectedAssignment.value) {
      fetchSubmissionsSilently()
    } else {
      fetchAssignmentsSilently()
    }
  }, 5000)

  // Returning from an analysis report? Re-open that assignment's submissions.
  const aid = route.query.assignment as string | undefined
  if (aid) {
    const target = assignments.value.find((a: any) => a.id === aid)
    if (target) selectAssignment(target)
  }
})

onUnmounted(() => {
  socketUnmounted = true
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }
  if (socket) {
    const s = socket
    socket = null
    s.close()
  }
  if (socketReconnectTimer) clearTimeout(socketReconnectTimer)
  if (forceSubmitTimeout) clearTimeout(forceSubmitTimeout)
})

async function selectAssignment(a: any) {
  // Teachers only ever see their own; admins may open any assignment.
  if (!owns(a) && !isAdmin.value) return
  selectedAssignment.value = a
  forceSubmitResult.value = null
  forceSubmitMessage.value = ''
  loadingSubs.value = true
  try {
    const res = await fetch(`${API}/api/assignments/${a.id}/submissions`, {
      headers: { Authorization: `Bearer ${token.value}` },
    })
    if (res.ok) submissions.value = await res.json()
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'teacher_join',
        payload: { assignmentId: a.id }
      }))
    }
  } catch { /* noop */ } finally { loadingSubs.value = false }
}

function backToList() {
  selectedAssignment.value = null
  submissions.value = []
  forceSubmitResult.value = null
  forceSubmitMessage.value = ''
}

function finishForceSubmitRequest() {
  forceSubmitting.value = false
  forceSubmitRequestId.value = null
  if (forceSubmitTimeout) {
    clearTimeout(forceSubmitTimeout)
    forceSubmitTimeout = null
  }
}

function openForceSubmitModal() {
  if (!canForceSubmitSelected.value || inProgressCount.value === 0 || forceSubmitting.value) return
  showForceSubmitModal.value = true
}

function executeForceSubmit() {
  if (
    !selectedAssignment.value ||
    !canForceSubmitSelected.value ||
    inProgressCount.value === 0 ||
    forceSubmitting.value
  ) return

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    forceSubmitIsError.value = true
    forceSubmitMessage.value = t('runtime.m_2696b7faeb27')
    return
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  forceSubmitting.value = true
  forceSubmitRequestId.value = requestId
  forceSubmitMessage.value = ''
  forceSubmitResult.value = null
  socket.send(JSON.stringify({
    type: 'force_submit',
    payload: { assignmentId: selectedAssignment.value.id, requestId },
  }))

  forceSubmitTimeout = setTimeout(() => {
    if (forceSubmitRequestId.value !== requestId) return
    finishForceSubmitRequest()
    forceSubmitIsError.value = true
    forceSubmitMessage.value = t('runtime.m_8caed1acf85e')
    fetchSubmissionsSilently()
  }, 120000)
}

async function createAssignment() {
  creating.value = true
  try {
    const res = await fetch(`${API}/api/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
      body: JSON.stringify({
        title: form.value.title,
        dueDate: form.value.dueDate,
        timeLimit: form.value.timeLimit,
        textLimit: form.value.textLimit,
        maxScore: form.value.maxScore,
        templateText: form.value.templateText,
        mode: form.value.mode,
      }),
    })
    if (res.ok) {
      const newA = await res.json()
      assignments.value.unshift(newA)
      showCreateModal.value = false
      form.value = { title: '', dueDate: '', timeLimit: 60, textLimit: 3000, maxScore: 100, templateText: '', mode: 'STANDARD' }
      selectAssignment(newA)
    }
  } catch { /* noop */ } finally { creating.value = false }
}

function confirmDelete(id: string) {
  assignmentToDelete.value = id
  showDeleteModal.value = true
}

async function executeDelete() {
  const id = assignmentToDelete.value
  if (!id) return
  try {
    await fetch(`${API}/api/assignments/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token.value}` },
    })
    assignments.value = assignments.value.filter(a => a.id !== id)
    if (selectedAssignment.value?.id === id) {
      selectedAssignment.value = null
      submissions.value = []
    }
  } catch { /* noop */ } finally {
    showDeleteModal.value = false
    assignmentToDelete.value = null
  }
}

function confirmDeleteSub(sub: any) {
  subToDelete.value = sub
  showDeleteSubModal.value = true
}

async function executeDeleteSub() {
  const sub = subToDelete.value
  if (!sub) return
  deletingSub.value = true
  try {
    const res = await fetch(`${API}/api/submissions/${sub.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token.value}` },
    })
    if (res.ok) {
      stopWatching()
      resetLiveOrdering(true)
      showDetailModal.value = false
      showDeleteSubModal.value = false
      subToDelete.value = null
      await fetchSubmissionsSilently()
    } else {
      const e = await res.json().catch(() => ({}))
      alert(translateError(e.code, e.error || t('runtime.m_21a3d0a17793')))
    }
  } catch (err) {
    alert(t('runtime.m_a50176d48a3d'))
  } finally {
    deletingSub.value = false
  }
}

function openDetail(sub: any) {
  stopWatching()
  detailSubmission.value = sub
  resetLiveOrdering(true)
  showDetailModal.value = true
  // Live-watch in-progress writing in real time.
  if (sub.status === 'IN_PROGRESS') {
    isLiveWatching.value = true
    if (socket && socket.readyState === WebSocket.OPEN && liveSocketAuthenticated.value) {
      socket.send(JSON.stringify({ type: 'watch_submission', payload: { submissionId: sub.id } }))
    }
  }
}

function stopWatching() {
  if (isLiveWatching.value && detailSubmission.value && socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'unwatch_submission', payload: { submissionId: detailSubmission.value.id } }))
  }
  isLiveWatching.value = false
  resetLiveOrdering()
}

function closeDetail() {
  stopWatching()
  showDetailModal.value = false
  resetLiveOrdering(true)
}

function goToAnalysis(submissionId: string) {
  router.push(`/analysis/${submissionId}`)
}

function exportCSV() {
  if (submissions.value.length === 0) return
  const headers = [t('runtime.m_f58cba353bd8'), t('runtime.m_3c37764a2b97'), t('runtime.m_2926977ba7c9'), t('runtime.m_a7f1d63de443'), t('runtime.m_8bd39bb74e2f'), t('runtime.m_9b0b88cf6e02')]
  const rows = submissions.value.map(s => [
    s.student_name, s.student_email, s.status,
    s.flagia_score != null ? Number(s.flagia_score).toFixed(1) : '-',
    s.flag_status || '-',
    s.submitted_at ? new Date(s.submitted_at).toLocaleString(locale.value === 'ko' ? 'ko-KR' : 'en-US') : '-',
  ])
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${selectedAssignment.value?.title || 'flagia'}_submissions.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function copyJoinCode(code: string) {
  if (!code) return
  navigator.clipboard.writeText(code).then(() => {
    copySuccess.value = true
    setTimeout(() => { copySuccess.value = false }, 2000)
  })
}

function getModeLabel(mode: string) {
  return { STRICT: t('runtime.m_cb092501bb93'), STANDARD: t('runtime.m_989b51aff08d'), RESEARCH: t('runtime.m_02e00a021a7f'), CREATIVE: t('runtime.m_6285a6f51651') }[mode] || mode
}
function formatDate(d: string) {
  return new Date(d).toLocaleDateString(locale.value === 'ko' ? 'ko-KR' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function getGaugeColor(flag: string) {
  return { GREEN: '#16A34A', AMBER: '#D97706', RED: '#DC2626' }[flag] || '#9CA3AF'
}
function getGaugeCircumference() { return 2 * Math.PI * 18 }
function getGaugeOffset(score: number) {
  const c = getGaugeCircumference()
  return c - (score / 100) * c
}
</script>

<template>
  <div class="w-full max-w-7xl mx-auto px-6 py-8">
    
    <!-- View 1: Assignments List -->
    <div v-if="!selectedAssignment">
      <div class="flex items-center justify-between mb-8">
        <div>
          <h1 class="text-2xl font-bold text-text-primary">{{ isAdmin ? t('runtime.m_d845259c792c') : t('runtime.m_fb8617af8144') }}</h1>
          <p class="text-sm text-text-secondary mt-1">
            {{ isAdmin
              ? t('runtime.m_cf9c057ee299')
              : t('runtime.m_7aeaf5b33395') }}
          </p>
        </div>
        <button @click="showCreateModal = true" class="btn btn-primary"> {{ $t('auto.m_06a220c539c4') }} </button>
      </div>

      <div class="card overflow-hidden">
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ $t('auto.m_16b94a5fa45e') }}</th>
              <th>{{ $t('auto.m_37cac543c064') }}</th>
              <th>{{ $t('auto.m_7484df028355') }}</th>
              <th>{{ $t('auto.m_c14a567ea996') }}</th>
              <th class="text-right">{{ $t('auto.m_c29fba5a7caf') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="5" class="text-center py-8 text-text-muted">{{ $t('auto.m_06e61b86cbda') }}</td>
            </tr>
            <tr v-else-if="assignments.length === 0">
              <td colspan="5" class="text-center py-12 text-text-muted">{{ $t('auto.m_dcd5f085dee3') }}</td>
            </tr>
            <tr v-else v-for="a in assignments" :key="a.id"
                @click="selectAssignment(a)"
                class="cursor-pointer hover:bg-background">
              <td>
                <div class="font-medium text-text-primary">{{ a.title }}</div>
                <div v-if="isAdmin && a.teacher_name" class="text-xs text-text-muted mt-0.5 flex items-center gap-1.5">
                  <span>👤 {{ a.teacher_name }}</span>
                  <span v-if="owns(a)" class="badge badge-green text-[10px]">{{ $t('auto.m_a2c25143883d') }}</span>
                  <span v-else-if="invited(a)" class="badge badge-amber text-[10px]">{{ $t('auto.m_5df8dd738eb1') }}</span>
                  <span v-else class="badge text-[10px] bg-background text-text-muted">{{ $t('auto.m_1bcb8a0449c6') }}</span>
                </div>
              </td>
              <td>
                <span class="font-mono bg-background px-2 py-1 rounded border border-border text-xs">{{ a.join_code }}</span>
              </td>
              <td class="text-text-secondary text-sm">
                {{ formatDate(a.due_date) }}
              </td>
              <td>
                <div class="flex items-center gap-2">
                  <span class="badge badge-green text-xs">{{ getModeLabel(a.mode) }}</span>
                  <span class="text-xs text-text-muted">{{ a.time_limit }}{{ $t('auto.m_0b877b721418') }}</span>
                </div>
              </td>
              <td class="text-right">
                <button v-if="owns(a) || isAdmin" @click.stop="confirmDelete(a.id)" class="btn btn-ghost text-danger btn-xs">{{ $t('auto.m_fc81e222b97c') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- View 2: Assignment Detail & Submissions -->
    <div v-else>
      <div class="mb-6 flex items-center gap-4">
        <button @click="backToList" class="btn btn-ghost px-2 py-1 flex items-center gap-2 text-text-secondary">
          <span>←</span> {{ $t('auto.m_6305eb231276') }} </button>
      </div>
      
      <!-- Stats -->
      <div class="grid grid-cols-4 gap-4 mb-6">
        <div class="stat-card">
          <div class="stat-label">{{ $t('auto.m_f90ccb90f3c9') }}</div>
          <div class="stat-value text-text-primary">{{ totalSubmissions }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">{{ $t('auto.m_2349d1875e73') }}</div>
          <div class="stat-value text-flag-green">{{ submittedCount }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">{{ $t('auto.m_12130facb243') }}</div>
          <div class="stat-value text-primary">{{ avgScore || '-' }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">{{ $t('auto.m_960042ef025d') }}</div>
          <div class="stat-value text-flag-amber">{{ flaggedCount }}</div>
        </div>
      </div>

      <!-- Assignment Header -->
      <div class="card p-6 mb-6 flex items-center justify-between">
        <div>
          <div class="flex items-center gap-3 mb-2">
            <h2 class="text-xl font-bold text-text-primary">{{ selectedAssignment.title }}</h2>
            <div class="bg-primary-light text-primary px-2.5 py-1 rounded flex items-center gap-2 cursor-pointer border border-primary/20 hover:bg-primary hover:text-white transition-colors" @click="copyJoinCode(selectedAssignment.join_code)">
              <span class="font-mono font-bold tracking-wider">{{ selectedAssignment.join_code }}</span>
              <span class="text-xs">{{ copySuccess ? t('runtime.m_bd5bd14ccbd6') : t('runtime.m_e1ac63f18ec7') }}</span>
            </div>
          </div>
          <div class="flex items-center gap-4 text-sm text-text-muted">
            <span>📅 {{ formatDate(selectedAssignment.due_date) }}</span>
            <span>⏱ {{ selectedAssignment.time_limit }}{{ $t('auto.m_0b877b721418') }}</span>
            <span>📏 {{ selectedAssignment.text_limit?.toLocaleString() }}{{ $t('auto.m_a862646b2e3b') }}</span>
            <span class="badge badge-green py-0.5">{{ getModeLabel(selectedAssignment.mode) }}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <button @click="openTemplate" class="btn btn-outline"> {{ $t('auto.m_90282a88c01a') }} {{ canEditSelected ? t('runtime.m_b2cca0411a6a') : t('runtime.m_58d6978a3e34') }}
          </button>
          <button v-if="submissions.length > 0" @click="exportCSV" class="btn btn-outline"> {{ $t('auto.m_8af400019b6d') }} </button>
        </div>
      </div>

      <!-- Submissions Table -->
      <div class="card overflow-hidden">
        <div class="p-4 border-b border-border bg-background/50 flex items-center justify-between gap-4">
          <div>
            <h3 class="font-semibold text-text-primary">{{ $t('auto.m_df5f423a751e') }}</h3>
            <p v-if="canForceSubmitSelected" class="text-xs text-text-muted mt-1"> {{ $t('auto.m_8b9a1646afa1') }} <strong class="text-text-primary">{{ inProgressCount }}{{ $t('auto.m_5a62fd50d243') }}</strong>
            </p>
          </div>
          <button
            v-if="canForceSubmitSelected"
            @click="openForceSubmitModal"
            class="btn btn-danger btn-sm flex-shrink-0"
            :disabled="inProgressCount === 0 || forceSubmitting"
          >
            <svg v-if="forceSubmitting" class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            {{ forceSubmitting ? t('runtime.m_8d39965590b7') : t('runtime.m_cdcb0eeafe8c') }}
          </button>
        </div>

        <div
          v-if="forceSubmitMessage"
          class="px-4 py-3 border-b text-sm"
          :class="forceSubmitIsError
            ? 'bg-red-50 border-red-200 text-red-700'
            : 'bg-green-50 border-green-200 text-green-700'"
        >
          <div class="font-medium">{{ forceSubmitMessage }}</div>
          <div v-if="forceSubmitResult" class="text-xs mt-1 opacity-80"> {{ $t('auto.m_61df3c30cb0f') }} {{ forceSubmitResult.targetCount }}{{ $t('auto.m_7be13031fd7c') }} {{ forceSubmitResult.deliveredCount }}{{ $t('auto.m_c5b781e824a2') }} {{ forceSubmitResult.alreadySubmittedCount }}{{ $t('auto.m_78c60662c4e9') }} {{ forceSubmitResult.forceClosedCount }}{{ $t('auto.m_5a62fd50d243') }} <span v-if="forceSubmitResult.analysisFailedCount"> {{ $t('auto.m_bac4b3b97869') }} {{ forceSubmitResult.analysisFailedCount }}{{ $t('auto.m_5a62fd50d243') }} </span>
          </div>
          <div v-if="forceSubmitResult?.errors?.length" class="text-xs mt-1">
            {{ forceSubmitResult.errors.join(' · ') }}
          </div>
        </div>
        
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ $t('auto.m_d8f324428d3c') }}</th>
              <th>{{ $t('auto.m_2926977ba7c9') }}</th>
              <th>{{ $t('auto.m_d3bb3576294c') }}</th>
              <th>{{ $t('auto.m_9b0b88cf6e02') }}</th>
              <th>{{ $t('auto.m_acd8d777b590') }}</th>
              <th>{{ $t('auto.m_d5ce088d01e0') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loadingSubs">
              <td colspan="6" class="text-center py-8 text-text-muted">{{ $t('auto.m_06e61b86cbda') }}</td>
            </tr>
            <tr v-else-if="submissions.length === 0">
              <td colspan="6" class="text-center py-12 text-text-muted">{{ $t('auto.m_b6f303b62889') }}</td>
            </tr>
            <tr v-else v-for="sub in submissions" :key="sub.id" @click="openDetail(sub)" class="cursor-pointer hover:bg-background">
              <td>
                <div class="flex items-center gap-2.5">
                  <div class="w-8 h-8 rounded-full bg-primary-light flex items-center justify-center text-sm font-semibold text-primary">
                    {{ sub.student_name?.charAt(0) || '?' }}
                  </div>
                  <div>
                    <div class="text-sm font-medium text-text-primary">{{ sub.student_name }}</div>
                    <div class="text-xs text-text-muted">{{ sub.student_email }}</div>
                  </div>
                </div>
              </td>
              <td>
                <span class="badge text-xs" :class="{
                  'badge-green': sub.status === 'SUBMITTED',
                  'badge-amber': sub.status === 'FORCE_CLOSED',
                  'bg-primary-light text-primary': sub.status === 'IN_PROGRESS',
                  'bg-background text-text-muted': sub.status === 'ASSIGNED',
                }">
                  {{ sub.status === 'SUBMITTED' ? t('runtime.m_2349d1875e73') : sub.status === 'FORCE_CLOSED' ? t('runtime.m_f8421db5e1f3') : sub.status === 'IN_PROGRESS' ? t('runtime.m_5d31848228b8') : t('runtime.m_bcfe1cbb9cd3') }}
                </span>
              </td>
              <!-- Graded score (teacher's grade) — the primary, prominent value -->
              <td>
                <div v-if="sub.score != null" class="font-bold text-lg text-text-primary">
                  {{ Number(sub.score) }}<span class="text-xs font-normal text-text-muted"> / {{ selectedAssignment?.max_score || 100 }}</span>
                </div>
                <span v-else class="text-xs text-text-muted">{{ $t('auto.m_9d93f3f28137') }}</span>
              </td>
              <td class="text-sm text-text-muted">
                {{ sub.submitted_at ? formatDate(sub.submitted_at) : '-' }}
              </td>
              <!-- Flagia integrity score — secondary/subtle, with flag dot -->
              <td>
                <div v-if="sub.flagia_score != null" class="flex items-center gap-1.5 text-sm">
                  <span class="inline-block w-2 h-2 rounded-full" :style="{ background: getGaugeColor(sub.flag_status) }"></span>
                  <span class="font-mono text-text-secondary">{{ Number(sub.flagia_score).toFixed(0) }}</span>
                </div>
                <span v-else class="text-text-muted text-sm">-</span>
              </td>
              <td>
                <button v-if="sub.flagia_score != null" @click.stop="goToAnalysis(sub.id)" class="btn btn-ghost btn-sm text-primary"> {{ $t('auto.m_5af082f8c110') }} </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Detail Modal -->
    <div v-if="showDetailModal && detailSubmission" class="modal-overlay" @click.self="closeDetail">
      <div class="modal-content max-w-3xl mx-4 p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="text-xl font-bold flex items-center gap-2">
              {{ detailSubmission.student_name }}{{ $t('auto.m_c64e9dfe5d92') }} <span v-if="isLiveWatching" class="inline-flex items-center gap-1 text-xs font-semibold text-flag-red">
                <span class="live-dot"></span> {{ liveStatusText }}
              </span>
            </h3>
            <p class="text-sm text-text-muted">{{ detailSubmission.student_email }}</p>
          </div>
          <button @click="closeDetail" class="btn btn-ghost btn-xs">✕</button>
        </div>

        <div v-if="detailSubmission.flagia_score != null" class="flex items-center gap-4 mb-6 p-4 rounded-xl bg-background border border-border">
          <div class="font-bold text-3xl" :style="{ color: getGaugeColor(detailSubmission.flag_status) }">
            {{ Number(detailSubmission.flagia_score).toFixed(1) }}
          </div>
          <span class="badge" :class="{
            'badge-green': detailSubmission.flag_status === 'GREEN',
            'badge-amber': detailSubmission.flag_status === 'AMBER',
            'badge-red': detailSubmission.flag_status === 'RED',
          }">
            {{ detailSubmission.flag_status }}
          </span>
          <button @click="goToAnalysis(detailSubmission.id); closeDetail()" class="btn btn-primary ml-auto"> {{ $t('auto.m_c9f2e030e2fb') }} </button>
        </div>

        <h4 class="text-sm font-semibold mb-2">{{ isLiveWatching ? t('runtime.m_ef88186df538') : t('runtime.m_3c42d2d43284') }}</h4>
        <!-- Live view: stream the student's current plain text as they write -->
        <div v-if="isLiveWatching" class="border border-flag-red/30 rounded-lg p-6 max-h-[45vh] overflow-y-auto bg-white shadow-inner mb-6">
          <div v-if="liveContent" class="whitespace-pre-wrap text-text-primary leading-relaxed">{{ liveContent }}</div>
          <div v-else class="text-text-muted text-sm">{{ $t('auto.m_1ac3e72bec9f') }}</div>
        </div>
        <div v-else class="border border-border rounded-lg p-6 max-h-[45vh] overflow-y-auto bg-white shadow-inner mb-6">
          <div class="markdown-body ProseMirror" v-html="detailSubmission.final_markdown || t('common.noContent')"></div>
        </div>

        <div class="flex justify-between items-center pt-4 border-t border-border">
          <button @click="confirmDeleteSub(detailSubmission)" class="btn btn-danger btn-sm"> {{ $t('auto.m_ced3aeff4cc4') }} </button>
          <button @click="closeDetail" class="btn btn-outline btn-sm"> {{ $t('auto.m_94b7dba15907') }} </button>
        </div>
      </div>
    </div>

    <!-- Template View / Edit Modal -->
    <div v-if="showTemplateModal && selectedAssignment" class="modal-overlay" @click.self="showTemplateModal = false">
      <div class="modal-content max-w-2xl mx-4 p-6 max-h-[90vh] overflow-y-auto flex flex-col">
        <div class="flex items-start justify-between mb-4 flex-shrink-0">
          <div>
            <h3 class="text-xl font-bold">{{ $t('auto.m_d329efb8767d') }}</h3>
            <p class="text-xs text-text-muted mt-0.5">{{ selectedAssignment.title }} {{ $t('auto.m_6e61fab67a11') }}</p>
          </div>
          <button @click="showTemplateModal = false" class="btn btn-ghost btn-xs">✕</button>
        </div>

        <!-- Editable (owner / admin) -->
        <div v-if="canEditSelected" class="flex flex-col flex-1">
          <div class="relative" style="height: 360px;">
            <RichTextEditor v-model="templateDraft" :placeholder="$t('auto.m_bb7de9480191')" />
          </div>
          <p class="text-xs text-text-muted mt-2"> {{ $t('auto.m_da8f764c8b85') }} </p>
          <div class="flex justify-end gap-3 pt-4 mt-2 border-t border-border">
            <button type="button" @click="showTemplateModal = false" class="btn btn-outline">{{ $t('auto.m_94b7dba15907') }}</button>
            <button type="button" @click="saveTemplate" class="btn btn-primary" :disabled="savingTemplate">
              {{ savingTemplate ? t('runtime.m_5d687060860a') : t('runtime.m_36a3bfccdf49') }}
            </button>
          </div>
        </div>

        <!-- Read-only view -->
        <div v-else class="flex flex-col flex-1">
          <div class="border border-border rounded-lg p-6 max-h-[60vh] overflow-y-auto bg-white shadow-inner">
            <div class="markdown-body ProseMirror" v-html="selectedAssignment.template_text || t('common.noTemplate')"></div>
          </div>
          <div class="flex justify-end pt-4 mt-2 border-t border-border">
            <button type="button" @click="showTemplateModal = false" class="btn btn-outline">{{ $t('auto.m_94b7dba15907') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Assignment Modal -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="modal-content max-w-2xl mx-4 p-6 max-h-[90vh] overflow-y-auto flex flex-col">
        <div class="flex items-center justify-between mb-5 flex-shrink-0">
          <h3 class="text-xl font-bold">{{ $t('auto.m_8c5ef35b4d30') }}</h3>
          <button @click="showCreateModal = false" class="btn btn-ghost btn-xs">✕</button>
        </div>

        <form @submit.prevent="createAssignment" class="flex flex-col gap-5 flex-1">
          <div>
            <label class="label">{{ $t('auto.m_16b94a5fa45e') }}</label>
            <input v-model="form.title" class="input" :placeholder="$t('auto.m_725b776cbbc1')" required />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label">{{ $t('auto.m_7484df028355') }}</label>
              <input v-model="form.dueDate" type="datetime-local" class="input" required />
            </div>
            <div>
              <label class="label">{{ $t('auto.m_abda63b055e7') }}</label>
              <input v-model.number="form.timeLimit" type="number" class="input" min="10" max="300" />
            </div>
          </div>

          <div>
            <label class="label">{{ $t('auto.m_fd55bbb0e0a3') }}</label>
            <input v-model.number="form.textLimit" type="number" class="input" min="100" max="50000" />
          </div>

          <div>
            <label class="label">{{ $t('auto.m_05622b077f57') }}</label>
            <input v-model.number="form.maxScore" type="number" class="input" min="1" max="1000" placeholder="100" />
          </div>

          <div>
            <label class="label">{{ $t('auto.m_946ae8af7bb0') }}</label>
            <div class="grid grid-cols-2 gap-3 mt-1">
              <div @click="form.mode = 'STRICT'" class="mode-option" :class="{ selected: form.mode === 'STRICT' }">
                <div class="font-bold text-primary mb-1">{{ $t('auto.m_98ddc156a1da') }}</div>
                <div class="text-xs text-text-secondary leading-relaxed">{{ $t('auto.m_471ef6314b49') }}</div>
              </div>
              <div @click="form.mode = 'STANDARD'" class="mode-option" :class="{ selected: form.mode === 'STANDARD' }">
                <div class="font-bold text-primary mb-1">{{ $t('auto.m_52d6a7cd8410') }}</div>
                <div class="text-xs text-text-secondary leading-relaxed">{{ $t('auto.m_5c3c575b9d98') }}</div>
              </div>
              <div @click="form.mode = 'RESEARCH'" class="mode-option" :class="{ selected: form.mode === 'RESEARCH' }">
                <div class="font-bold text-primary mb-1">{{ $t('auto.m_eecc18749edb') }}</div>
                <div class="text-xs text-text-secondary leading-relaxed">{{ $t('auto.m_60672c56889a') }}</div>
              </div>
              <div @click="form.mode = 'CREATIVE'" class="mode-option" :class="{ selected: form.mode === 'CREATIVE' }">
                <div class="font-bold text-primary mb-1">{{ $t('auto.m_f59016e666f8') }}</div>
                <div class="text-xs text-text-secondary leading-relaxed">{{ $t('auto.m_3ba3791af32e') }}</div>
              </div>
            </div>
          </div>

          <div class="flex flex-col">
            <label class="label">{{ $t('auto.m_cafdf325afaa') }}</label>
            <!-- Fixed height + internal scroll: a long template won't grow the
                 modal or overlap the sticky footer. -->
            <div class="relative" style="height: 220px;">
              <RichTextEditor v-model="form.templateText" :placeholder="$t('auto.m_bb7de9480191')" />
            </div>
          </div>

          <div class="flex justify-end gap-3 pt-4 border-t border-border sticky bottom-0 -mx-6 px-6 pb-1" style="background: var(--color-surface);">
            <button type="button" @click="showCreateModal = false" class="btn btn-outline">{{ $t('auto.m_19b2d19bc141') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="creating">
              {{ creating ? t('runtime.m_56bc49b0ea17') : t('runtime.m_f269066f2596') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <div
      v-if="showForceSubmitModal && selectedAssignment"
      class="modal-overlay"
      @click.self="!forceSubmitting && (showForceSubmitModal = false)"
    >
      <div class="modal-content max-w-md mx-4 p-6">
        <div class="text-center">
          <div class="text-4xl mb-4">⚠️</div>
          <h3 class="text-lg font-bold mb-2">{{ $t('auto.m_9084ae153c26') }}</h3>
          <p class="text-sm text-text-secondary leading-relaxed"> {{ $t('auto.m_b5fe389ffc0a') }} {{ inProgressCount }}{{ $t('auto.m_b77a9f2e10f3') }} </p>
        </div>
        <div class="rounded-lg border border-red-200 bg-red-50 p-4 my-5">
          <div class="text-xs text-red-600 font-medium mb-1">{{ $t('auto.m_9501b92d4457') }}</div>
          <div class="font-semibold text-text-primary">{{ selectedAssignment.title }}</div>
          <div class="text-sm text-red-700 mt-1">{{ $t('auto.m_5d31848228b8') }} {{ inProgressCount }}{{ $t('auto.m_5a62fd50d243') }}</div>
        </div>
        <div class="flex gap-2">
          <button
            @click="showForceSubmitModal = false"
            class="btn btn-outline flex-1"
            :disabled="forceSubmitting"
          > {{ $t('auto.m_19b2d19bc141') }} </button>
          <button
            @click="executeForceSubmit"
            class="btn btn-danger flex-1"
            :disabled="forceSubmitting || inProgressCount === 0"
          >
            <svg v-if="forceSubmitting" class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            {{ forceSubmitting ? t('runtime.m_8d39965590b7') : t('runtime.m_2183e45132d2') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <div v-if="showDeleteModal" class="modal-overlay" @click.self="showDeleteModal = false">
      <div class="modal-content max-w-sm mx-4 p-6 text-center">
        <div class="text-4xl mb-4">🗑️</div>
        <h3 class="text-lg font-bold mb-2">{{ $t('auto.m_d43e543db9a2') }}</h3>
        <p class="text-sm text-text-secondary mb-6">{{ $t('auto.m_ba3c45021d9d') }}<br>{{ $t('auto.m_4e7508a15293') }}</p>
        <div class="flex gap-2">
          <button @click="showDeleteModal = false" class="btn btn-outline flex-1">{{ $t('auto.m_19b2d19bc141') }}</button>
          <button @click="executeDelete" class="btn bg-red-600 text-white hover:bg-red-700 flex-1 border-none">{{ $t('auto.m_fc81e222b97c') }}</button>
        </div>
      </div>
    </div>

    <!-- Delete Submission Confirmation Modal -->
    <div v-if="showDeleteSubModal" class="modal-overlay" @click.self="showDeleteSubModal = false">
      <div class="modal-content max-w-sm mx-4 p-6 text-center">
        <div class="text-4xl mb-4">🔄</div>
        <h3 class="text-lg font-bold mb-2">{{ $t('auto.m_7c2e6a580fc6') }}</h3>
        <p class="text-sm text-text-secondary mb-6">{{ $t('auto.m_7f81bb11971e') }}<br>{{ $t('auto.m_7c88ee6946c2') }}</p>
        <div class="flex gap-2">
          <button @click="showDeleteSubModal = false" class="btn btn-outline flex-1">{{ $t('auto.m_19b2d19bc141') }}</button>
          <button @click="executeDeleteSub" :disabled="deletingSub" class="btn bg-red-600 text-white hover:bg-red-700 flex-1 border-none">
            {{ deletingSub ? t('runtime.m_6a4e0f00f23f') : t('runtime.m_ff75b4ff2463') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import RichTextEditor from '../components/RichTextEditor.vue'

import { resolveApiBase, resolveWsUrl } from '../composables/apiHost'

const API = resolveApiBase()
const WS_URL = resolveWsUrl()
const router = useRouter()
const route = useRoute()
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
  if (!liveSocketAuthenticated.value) return '연결 복구 중'
  if (liveContent.value === null || liveContent.value.length === 0) return '학생의 입력을 기다리는 중'
  return '실시간 연결됨'
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
      alert(e.error || '템플릿 저장에 실패했습니다')
    }
  } catch {
    alert('템플릿 저장 중 오류가 발생했습니다')
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
          forceSubmitMessage.value = '현재 작성 중인 학생이 없습니다.'
        } else if (payload.failedCount > 0) {
          forceSubmitMessage.value =
            `세션 종료 ${payload.forceClosedCount}명, 실패 ${payload.failedCount}명입니다.`
        } else {
          forceSubmitMessage.value = `작성 중이던 ${payload.forceClosedCount}명의 세션을 종료했습니다.`
        }
        fetchSubmissionsSilently()
      } else if (type === 'force_submit_error') {
        if (payload.requestId !== forceSubmitRequestId.value) return
        finishForceSubmitRequest()
        forceSubmitIsError.value = true
        forceSubmitMessage.value = payload.error || '작성 세션 종료 요청에 실패했습니다.'
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
    forceSubmitMessage.value = '실시간 서버 연결이 끊겨 요청을 보낼 수 없습니다. 잠시 후 다시 시도해 주세요.'
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
    forceSubmitMessage.value = '서버 응답이 지연되고 있습니다. 제출 현황을 확인한 뒤 다시 시도해 주세요.'
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
      alert(e.error || '제출물 초기화에 실패했습니다')
    }
  } catch (err) {
    alert('제출물 초기화 중 오류가 발생했습니다')
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
  const headers = ['학생명', '이메일', '상태', 'Flagia 점수', '판정', '제출일시']
  const rows = submissions.value.map(s => [
    s.student_name, s.student_email, s.status,
    s.flagia_score != null ? Number(s.flagia_score).toFixed(1) : '-',
    s.flag_status || '-',
    s.submitted_at ? new Date(s.submitted_at).toLocaleString('ko-KR') : '-',
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
  return { STRICT: '엄격', STANDARD: '표준', RESEARCH: '연구', CREATIVE: '자유' }[mode] || mode
}
function formatDate(d: string) {
  return new Date(d).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
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
          <h1 class="text-2xl font-bold text-text-primary">{{ isAdmin ? '전체 과제 (관리자)' : '과제 관리' }}</h1>
          <p class="text-sm text-text-secondary mt-1">
            {{ isAdmin
              ? '관리자 권한으로 모든 과제를 열람하고 관리할 수 있습니다. 직접 만들거나 참여하지 않은 과제는 표시로 구분됩니다.'
              : '학생들에게 과제를 부여하고 분석 결과를 확인하세요.' }}
          </p>
        </div>
        <button @click="showCreateModal = true" class="btn btn-primary">
          + 새 과제 만들기
        </button>
      </div>

      <div class="card overflow-hidden">
        <table class="data-table">
          <thead>
            <tr>
              <th>과제 제목</th>
              <th>참여 코드</th>
              <th>마감일</th>
              <th>설정</th>
              <th class="text-right">관리</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="5" class="text-center py-8 text-text-muted">로딩 중...</td>
            </tr>
            <tr v-else-if="assignments.length === 0">
              <td colspan="5" class="text-center py-12 text-text-muted">생성된 과제가 없습니다.</td>
            </tr>
            <tr v-else v-for="a in assignments" :key="a.id"
                @click="selectAssignment(a)"
                class="cursor-pointer hover:bg-background">
              <td>
                <div class="font-medium text-text-primary">{{ a.title }}</div>
                <div v-if="isAdmin && a.teacher_name" class="text-xs text-text-muted mt-0.5 flex items-center gap-1.5">
                  <span>👤 {{ a.teacher_name }}</span>
                  <span v-if="owns(a)" class="badge badge-green text-[10px]">내 과제</span>
                  <span v-else-if="invited(a)" class="badge badge-amber text-[10px]">참여 중</span>
                  <span v-else class="badge text-[10px] bg-background text-text-muted">미소유·미참여</span>
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
                  <span class="text-xs text-text-muted">{{ a.time_limit }}분</span>
                </div>
              </td>
              <td class="text-right">
                <button v-if="owns(a) || isAdmin" @click.stop="confirmDelete(a.id)" class="btn btn-ghost text-danger btn-xs">삭제</button>
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
          <span>←</span> 목록으로
        </button>
      </div>
      
      <!-- Stats -->
      <div class="grid grid-cols-4 gap-4 mb-6">
        <div class="stat-card">
          <div class="stat-label">전체 제출</div>
          <div class="stat-value text-text-primary">{{ totalSubmissions }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">제출 완료</div>
          <div class="stat-value text-flag-green">{{ submittedCount }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">평균 점수</div>
          <div class="stat-value text-primary">{{ avgScore || '-' }}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">주의 필요</div>
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
              <span class="text-xs">{{ copySuccess ? '✅ 복사됨' : '📋 복사' }}</span>
            </div>
          </div>
          <div class="flex items-center gap-4 text-sm text-text-muted">
            <span>📅 {{ formatDate(selectedAssignment.due_date) }}</span>
            <span>⏱ {{ selectedAssignment.time_limit }}분</span>
            <span>📏 {{ selectedAssignment.text_limit?.toLocaleString() }}자</span>
            <span class="badge badge-green py-0.5">{{ getModeLabel(selectedAssignment.mode) }}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <button @click="openTemplate" class="btn btn-outline">
            📄 템플릿 {{ canEditSelected ? '보기 / 편집' : '보기' }}
          </button>
          <button v-if="submissions.length > 0" @click="exportCSV" class="btn btn-outline">
            📊 CSV 내보내기
          </button>
        </div>
      </div>

      <!-- Submissions Table -->
      <div class="card overflow-hidden">
        <div class="p-4 border-b border-border bg-background/50 flex items-center justify-between gap-4">
          <div>
            <h3 class="font-semibold text-text-primary">학생 제출 현황</h3>
            <p v-if="canForceSubmitSelected" class="text-xs text-text-muted mt-1">
              현재 작성 중 <strong class="text-text-primary">{{ inProgressCount }}명</strong>
            </p>
          </div>
          <button
            v-if="canForceSubmitSelected"
            @click="openForceSubmitModal"
            class="btn btn-danger btn-sm flex-shrink-0"
            :disabled="inProgressCount === 0 || forceSubmitting"
          >
            <svg v-if="forceSubmitting" class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            {{ forceSubmitting ? '종료 처리 중...' : '작성 일괄 종료' }}
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
          <div v-if="forceSubmitResult" class="text-xs mt-1 opacity-80">
            요청 대상 {{ forceSubmitResult.targetCount }}명 · 접속 중 전달 {{ forceSubmitResult.deliveredCount }}명 ·
            이미 제출되어 제외 {{ forceSubmitResult.alreadySubmittedCount }}명 · 최종 강제 종료 {{ forceSubmitResult.forceClosedCount }}명
            <span v-if="forceSubmitResult.analysisFailedCount">
              · 분석 실패 {{ forceSubmitResult.analysisFailedCount }}명
            </span>
          </div>
          <div v-if="forceSubmitResult?.errors?.length" class="text-xs mt-1">
            {{ forceSubmitResult.errors.join(' · ') }}
          </div>
        </div>
        
        <table class="data-table">
          <thead>
            <tr>
              <th>학생</th>
              <th>상태</th>
              <th>성적</th>
              <th>제출일시</th>
              <th>무결성</th>
              <th>분석</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loadingSubs">
              <td colspan="6" class="text-center py-8 text-text-muted">로딩 중...</td>
            </tr>
            <tr v-else-if="submissions.length === 0">
              <td colspan="6" class="text-center py-12 text-text-muted">아직 제출된 글이 없습니다.</td>
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
                  {{ sub.status === 'SUBMITTED' ? '제출 완료' : sub.status === 'FORCE_CLOSED' ? '자동 제출' : sub.status === 'IN_PROGRESS' ? '작성 중' : '시작 전' }}
                </span>
              </td>
              <!-- Graded score (teacher's grade) — the primary, prominent value -->
              <td>
                <div v-if="sub.score != null" class="font-bold text-lg text-text-primary">
                  {{ Number(sub.score) }}<span class="text-xs font-normal text-text-muted"> / {{ selectedAssignment?.max_score || 100 }}</span>
                </div>
                <span v-else class="text-xs text-text-muted">미채점</span>
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
                <button v-if="sub.flagia_score != null" @click.stop="goToAnalysis(sub.id)" class="btn btn-ghost btn-sm text-primary">
                  상세 분석 →
                </button>
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
              {{ detailSubmission.student_name }}의 제출물
              <span v-if="isLiveWatching" class="inline-flex items-center gap-1 text-xs font-semibold text-flag-red">
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
          <button @click="goToAnalysis(detailSubmission.id); closeDetail()" class="btn btn-primary ml-auto">
            상세 분석 보기
          </button>
        </div>

        <h4 class="text-sm font-semibold mb-2">{{ isLiveWatching ? '실시간 작성 내용' : '제출 내용' }}</h4>
        <!-- Live view: stream the student's current plain text as they write -->
        <div v-if="isLiveWatching" class="border border-flag-red/30 rounded-lg p-6 max-h-[45vh] overflow-y-auto bg-white shadow-inner mb-6">
          <div v-if="liveContent" class="whitespace-pre-wrap text-text-primary leading-relaxed">{{ liveContent }}</div>
          <div v-else class="text-text-muted text-sm">학생의 작성 내용을 기다리는 중...</div>
        </div>
        <div v-else class="border border-border rounded-lg p-6 max-h-[45vh] overflow-y-auto bg-white shadow-inner mb-6">
          <div class="markdown-body ProseMirror" v-html="detailSubmission.final_markdown || '(내용 없음)'"></div>
        </div>

        <div class="flex justify-between items-center pt-4 border-t border-border">
          <button @click="confirmDeleteSub(detailSubmission)" class="btn btn-danger btn-sm">
            제출물 초기화 (다시 쓰기 허용)
          </button>
          <button @click="closeDetail" class="btn btn-outline btn-sm">
            닫기
          </button>
        </div>
      </div>
    </div>

    <!-- Template View / Edit Modal -->
    <div v-if="showTemplateModal && selectedAssignment" class="modal-overlay" @click.self="showTemplateModal = false">
      <div class="modal-content max-w-2xl mx-4 p-6 max-h-[90vh] overflow-y-auto flex flex-col">
        <div class="flex items-start justify-between mb-4 flex-shrink-0">
          <div>
            <h3 class="text-xl font-bold">과제 템플릿</h3>
            <p class="text-xs text-text-muted mt-0.5">{{ selectedAssignment.title }} · 학생에게 기본 제공되는 가이드라인 텍스트</p>
          </div>
          <button @click="showTemplateModal = false" class="btn btn-ghost btn-xs">✕</button>
        </div>

        <!-- Editable (owner / admin) -->
        <div v-if="canEditSelected" class="flex flex-col flex-1">
          <div class="relative" style="height: 360px;">
            <RichTextEditor v-model="templateDraft" placeholder="여기에 템플릿 내용을 작성하세요..." />
          </div>
          <p class="text-xs text-text-muted mt-2">
            ⚠️ 템플릿 변경은 이후 새로 시작하는 학생에게 적용됩니다. 이미 작성 중이거나 제출한 학생에게는 영향을 주지 않습니다.
          </p>
          <div class="flex justify-end gap-3 pt-4 mt-2 border-t border-border">
            <button type="button" @click="showTemplateModal = false" class="btn btn-outline">닫기</button>
            <button type="button" @click="saveTemplate" class="btn btn-primary" :disabled="savingTemplate">
              {{ savingTemplate ? '저장 중...' : '템플릿 저장' }}
            </button>
          </div>
        </div>

        <!-- Read-only view -->
        <div v-else class="flex flex-col flex-1">
          <div class="border border-border rounded-lg p-6 max-h-[60vh] overflow-y-auto bg-white shadow-inner">
            <div class="markdown-body ProseMirror" v-html="selectedAssignment.template_text || '(템플릿 없음)'"></div>
          </div>
          <div class="flex justify-end pt-4 mt-2 border-t border-border">
            <button type="button" @click="showTemplateModal = false" class="btn btn-outline">닫기</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Assignment Modal -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="modal-content max-w-2xl mx-4 p-6 max-h-[90vh] overflow-y-auto flex flex-col">
        <div class="flex items-center justify-between mb-5 flex-shrink-0">
          <h3 class="text-xl font-bold">새 과제 만들기</h3>
          <button @click="showCreateModal = false" class="btn btn-ghost btn-xs">✕</button>
        </div>

        <form @submit.prevent="createAssignment" class="flex flex-col gap-5 flex-1">
          <div>
            <label class="label">과제 제목</label>
            <input v-model="form.title" class="input" placeholder="예: 인공지능의 윤리적 과제" required />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label">마감일</label>
              <input v-model="form.dueDate" type="datetime-local" class="input" required />
            </div>
            <div>
              <label class="label">제한 시간 (분)</label>
              <input v-model.number="form.timeLimit" type="number" class="input" min="10" max="300" />
            </div>
          </div>

          <div>
            <label class="label">글자 수 제한</label>
            <input v-model.number="form.textLimit" type="number" class="input" min="100" max="50000" />
          </div>

          <div>
            <label class="label">최대 배점 (만점 기준)</label>
            <input v-model.number="form.maxScore" type="number" class="input" min="1" max="1000" placeholder="100" />
          </div>

          <div>
            <label class="label">분석 모드</label>
            <div class="grid grid-cols-2 gap-3 mt-1">
              <div @click="form.mode = 'STRICT'" class="mode-option" :class="{ selected: form.mode === 'STRICT' }">
                <div class="font-bold text-primary mb-1">엄격 (Strict)</div>
                <div class="text-xs text-text-secondary leading-relaxed">모든 탭 이탈 및 복사-붙여넣기를 엄격하게 감지합니다. 시험이나 평가에 적합합니다.</div>
              </div>
              <div @click="form.mode = 'STANDARD'" class="mode-option" :class="{ selected: form.mode === 'STANDARD' }">
                <div class="font-bold text-primary mb-1">표준 (Standard)</div>
                <div class="text-xs text-text-secondary leading-relaxed">일반적인 글쓰기 환경. 잦은 탭 이탈이나 비정상적인 패턴에만 경고합니다.</div>
              </div>
              <div @click="form.mode = 'RESEARCH'" class="mode-option" :class="{ selected: form.mode === 'RESEARCH' }">
                <div class="font-bold text-primary mb-1">연구 (Research)</div>
                <div class="text-xs text-text-secondary leading-relaxed">자료 조사를 위한 탭 이동과 외부 텍스트 참조를 허용합니다.</div>
              </div>
              <div @click="form.mode = 'CREATIVE'" class="mode-option" :class="{ selected: form.mode === 'CREATIVE' }">
                <div class="font-bold text-primary mb-1">자유 (Creative)</div>
                <div class="text-xs text-text-secondary leading-relaxed">행동을 전혀 제한하지 않고 기본적인 타이핑 패턴만 수집합니다.</div>
              </div>
            </div>
          </div>

          <div class="flex flex-col">
            <label class="label">가이드라인 템플릿 (학생에게 기본 제공되는 텍스트)</label>
            <!-- Fixed height + internal scroll: a long template won't grow the
                 modal or overlap the sticky footer. -->
            <div class="relative" style="height: 220px;">
              <RichTextEditor v-model="form.templateText" placeholder="여기에 템플릿 내용을 작성하세요..." />
            </div>
          </div>

          <div class="flex justify-end gap-3 pt-4 border-t border-border sticky bottom-0 -mx-6 px-6 pb-1" style="background: var(--color-surface);">
            <button type="button" @click="showCreateModal = false" class="btn btn-outline">취소</button>
            <button type="submit" class="btn btn-primary" :disabled="creating">
              {{ creating ? '생성 중...' : '과제 생성하기' }}
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
          <h3 class="text-lg font-bold mb-2">작성 세션 일괄 종료</h3>
          <p class="text-sm text-text-secondary leading-relaxed">
            현재 작성 중인 학생 {{ inProgressCount }}명의 글쓰기를 종료하고, 마지막으로 저장된 내용을 자동 제출합니다.
            이미 제출한 학생에게는 영향을 주지 않습니다.
          </p>
        </div>
        <div class="rounded-lg border border-red-200 bg-red-50 p-4 my-5">
          <div class="text-xs text-red-600 font-medium mb-1">실행할 과제</div>
          <div class="font-semibold text-text-primary">{{ selectedAssignment.title }}</div>
          <div class="text-sm text-red-700 mt-1">작성 중 {{ inProgressCount }}명</div>
        </div>
        <div class="flex gap-2">
          <button
            @click="showForceSubmitModal = false"
            class="btn btn-outline flex-1"
            :disabled="forceSubmitting"
          >
            취소
          </button>
          <button
            @click="executeForceSubmit"
            class="btn btn-danger flex-1"
            :disabled="forceSubmitting || inProgressCount === 0"
          >
            <svg v-if="forceSubmitting" class="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            {{ forceSubmitting ? '종료 처리 중...' : '종료 및 제출' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <div v-if="showDeleteModal" class="modal-overlay" @click.self="showDeleteModal = false">
      <div class="modal-content max-w-sm mx-4 p-6 text-center">
        <div class="text-4xl mb-4">🗑️</div>
        <h3 class="text-lg font-bold mb-2">과제 삭제</h3>
        <p class="text-sm text-text-secondary mb-6">이 과제를 삭제하시겠습니까?<br>모든 제출물이 함께 삭제되며 복구할 수 없습니다.</p>
        <div class="flex gap-2">
          <button @click="showDeleteModal = false" class="btn btn-outline flex-1">취소</button>
          <button @click="executeDelete" class="btn bg-red-600 text-white hover:bg-red-700 flex-1 border-none">삭제</button>
        </div>
      </div>
    </div>

    <!-- Delete Submission Confirmation Modal -->
    <div v-if="showDeleteSubModal" class="modal-overlay" @click.self="showDeleteSubModal = false">
      <div class="modal-content max-w-sm mx-4 p-6 text-center">
        <div class="text-4xl mb-4">🔄</div>
        <h3 class="text-lg font-bold mb-2">제출물 초기화</h3>
        <p class="text-sm text-text-secondary mb-6">제출물을 초기화하시겠습니까?<br>학생의 진행 상황과 작성 시간이 모두 초기화되며, 학생은 처음부터 다시 작성할 수 있게 됩니다.</p>
        <div class="flex gap-2">
          <button @click="showDeleteSubModal = false" class="btn btn-outline flex-1">취소</button>
          <button @click="executeDeleteSub" :disabled="deletingSub" class="btn bg-red-600 text-white hover:bg-red-700 flex-1 border-none">
            {{ deletingSub ? '초기화 중...' : '초기화' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

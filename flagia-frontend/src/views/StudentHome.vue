<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '../composables/useAuth'

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
const router = useRouter()
const route = useRoute()
const { user, token } = useAuth()

const assignments = ref<any[]>([])
const submissions = ref<any[]>([])
const loading = ref(true)

const showJoinModal = ref(false)
const joinCode = ref('')
const joining = ref(false)
const joinError = ref('')

let socket: WebSocket | null = null

function connectWS() {
  if (!token.value) return
  socket = new WebSocket(WS_URL)
  socket.onopen = () => {
    socket?.send(JSON.stringify({
      type: 'auth',
      payload: { token: token.value }
    }))
  }
  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data)
      const { type } = msg
      if (type === 'assignments_update' || type === 'submissions_update') {
        refreshDataSilently()
      }
    } catch (err) {
      console.error('WS message error:', err)
    }
  }
  socket.onclose = () => {
    setTimeout(() => {
      if (socket) connectWS()
    }, 3000)
  }
}

async function refreshDataSilently() {
  try {
    const [aRes, sRes] = await Promise.all([
      fetch(`${API}/api/assignments`, { headers: { Authorization: `Bearer ${token.value}` } }),
      fetch(`${API}/api/assignments/my-submissions`, { headers: { Authorization: `Bearer ${token.value}` } })
        .catch(() => ({ ok: false, json: () => [] })),
    ])
    if (aRes.ok) assignments.value = await aRes.json()
    if (sRes.ok) submissions.value = await (sRes as Response).json()
  } catch { /* noop */ }
}

async function joinAssignment() {
  if (!joinCode.value) return
  joining.value = true
  joinError.value = ''
  try {
    const res = await fetch(`${API}/api/assignments/join/${joinCode.value}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.value}` }
    })
    const data = await res.json()
    if (!res.ok) {
      joinError.value = data.error || '참여에 실패했습니다'
      return
    }
    showJoinModal.value = false
    joinCode.value = ''
    await refreshDataSilently()
  } catch (err) {
    joinError.value = '서버 오류가 발생했습니다'
  } finally {
    joining.value = false
  }
}

onMounted(async () => {
  try {
    const [aRes, sRes] = await Promise.all([
      fetch(`${API}/api/assignments`, { headers: { Authorization: `Bearer ${token.value}` } }),
      fetch(`${API}/api/assignments/my-submissions`, { headers: { Authorization: `Bearer ${token.value}` } })
        .catch(() => ({ ok: false, json: () => [] })),
    ])
    if (aRes.ok) assignments.value = await aRes.json()
    if (sRes.ok) submissions.value = await (sRes as Response).json()
  } catch { /* noop */ } finally { loading.value = false }
  connectWS()
})

onUnmounted(() => {
  if (socket) {
    const s = socket
    socket = null
    s.close()
  }
})

// Map submissions by assignment_id
const submissionMap = computed(() => {
  const m: Record<string, any> = {}
  for (const s of submissions.value) m[s.assignment_id] = s
  return m
})

// Stats
const totalAssignments = computed(() => assignments.value.length)
const completedCount = computed(() =>
  assignments.value.filter(a => {
    const s = submissionMap.value[a.id]
    return s && (s.status === 'SUBMITTED' || s.status === 'FORCE_CLOSED')
  }).length
)
const inProgressCount = computed(() =>
  assignments.value.filter(a => {
    const s = submissionMap.value[a.id]
    return s && s.status === 'IN_PROGRESS'
  }).length
)

function getDday(dueDate: string) {
  const due = new Date(dueDate)
  const now = new Date()
  const diffMs = due.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays > 7) return { text: `D-${diffDays}`, class: 'dday-normal' }
  if (diffDays > 1) return { text: `D-${diffDays}`, class: 'dday-soon' }
  if (diffDays === 1) return { text: 'D-1', class: 'dday-urgent' }
  if (diffDays === 0) return { text: 'D-Day', class: 'dday-urgent', val: 0 }
  return { text: '마감됨', class: 'dday-passed', val: -1 }
}

// Filtering & Sorting
const filterStatus = ref('ALL') // ALL, NOT_STARTED, IN_PROGRESS, SUBMITTED
const sortBy = ref('DUE_DATE') // DUE_DATE, NEWEST

// Sync filter from route query param (e.g., /student?filter=IN_PROGRESS)
const validFilters = ['ALL', 'NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED']
if (route.query.filter && validFilters.includes(route.query.filter as string)) {
  filterStatus.value = route.query.filter as string
}
watch(() => route.query.filter, (newFilter) => {
  if (newFilter && validFilters.includes(newFilter as string)) {
    filterStatus.value = newFilter as string
  } else if (!newFilter) {
    filterStatus.value = 'ALL'
  }
})

const filteredAssignments = computed(() => {
  let list = assignments.value.filter(a => {
    const sub = submissionMap.value[a.id]
    // ASSIGNED = joined but never opened the editor → treat as not started.
    const status = sub && sub.status !== 'ASSIGNED' ? sub.status : 'NOT_STARTED'
    if (filterStatus.value === 'ALL') return true
    if (filterStatus.value === 'NOT_STARTED') return status === 'NOT_STARTED'
    if (filterStatus.value === 'IN_PROGRESS') return status === 'IN_PROGRESS'
    if (filterStatus.value === 'SUBMITTED') return status === 'SUBMITTED' || status === 'FORCE_CLOSED'
    return true
  })

  list.sort((a, b) => {
    if (sortBy.value === 'DUE_DATE') {
      const aTime = new Date(a.due_date).getTime()
      const bTime = new Date(b.due_date).getTime()
      return aTime - bTime
    } else if (sortBy.value === 'NEWEST') {
      const aTime = new Date(a.created_at || a.due_date).getTime()
      const bTime = new Date(b.created_at || b.due_date).getTime()
      return bTime - aTime
    }
    return 0
  })

  return list
})

function getStatusInfo(assignment: any) {
  const sub = submissionMap.value[assignment.id]
  if (!sub || sub.status === 'ASSIGNED') return { label: '미시작', color: 'text-text-muted', bg: 'bg-background' }
  if (sub.status === 'SUBMITTED') return { label: '제출 완료', color: 'text-flag-green', bg: 'bg-flag-green-bg' }
  if (sub.status === 'FORCE_CLOSED') return { label: '자동 제출', color: 'text-flag-amber', bg: 'bg-flag-amber-bg' }
  return { label: '작성 중', color: 'text-primary', bg: 'bg-primary-light' }
}

function getFlagBadge(assignment: any) {
  const sub = submissionMap.value[assignment.id]
  if (!sub || !sub.flag_status) return null
  return sub.flag_status
}

function goToEditor(assignmentId: string) {
  router.push(`/editor/${assignmentId}`)
}

function goToAnalysis(submissionId: string) {
  router.push(`/analysis/${submissionId}`)
}

function getModeLabel(mode: string) {
  const labels: Record<string, string> = {
    STRICT: '엄격', STANDARD: '표준', RESEARCH: '연구', CREATIVE: '자유',
  }
  return labels[mode] || mode
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="w-full max-w-5xl mx-auto px-6 py-8">
    <!-- Header -->
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-2xl font-bold text-text-primary">안녕하세요, {{ user?.name }}님 👋</h1>
        <p class="text-sm text-text-secondary mt-1">내 과제 목록을 확인하고 글쓰기를 시작하세요.</p>
      </div>
      <button @click="showJoinModal = true" class="btn btn-primary">
        + 코드 입력하여 참여
      </button>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-3 gap-4 mb-8">
      <div class="stat-card">
        <div class="stat-label">전체 과제</div>
        <div class="stat-value text-text-primary">{{ totalAssignments }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">제출 완료</div>
        <div class="stat-value text-flag-green">{{ completedCount }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">진행 중</div>
        <div class="stat-value text-primary">{{ inProgressCount }}</div>
      </div>
    </div>

    <!-- Filters & Sorting -->
    <div v-if="!loading && assignments.length > 0" class="flex flex-wrap items-center justify-between gap-4 mb-6">
      <div class="flex items-center gap-2">
        <button v-for="f in [{v:'ALL',l:'전체'}, {v:'NOT_STARTED',l:'미시작'}, {v:'IN_PROGRESS',l:'진행 중'}, {v:'SUBMITTED',l:'제출 완료'}]"
          :key="f.v"
          @click="filterStatus = f.v"
          class="btn btn-sm"
          :class="filterStatus === f.v ? 'btn-primary' : 'btn-ghost bg-background border border-border'">
          {{ f.l }}
        </button>
      </div>
      <div class="flex items-center gap-2">
        <select v-model="sortBy" class="input py-1.5 text-sm h-auto bg-background">
          <option value="DUE_DATE">마감일 임박순</option>
          <option value="NEWEST">최신 배정순</option>
        </select>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-col gap-3">
      <div v-for="i in 3" :key="i" class="card p-5 shimmer h-28 rounded-xl"></div>
    </div>

    <!-- Empty -->
    <div v-else-if="assignments.length === 0" class="card p-12 text-center">
      <div class="text-4xl mb-3">📝</div>
      <p class="text-text-secondary">아직 배정된 과제가 없습니다.</p>
      <p class="text-sm text-text-muted mt-1">교사가 과제를 생성하면 여기에 표시됩니다.</p>
    </div>

    <!-- Assignment List -->
    <div v-else class="flex flex-col gap-3">
      <div v-if="filteredAssignments.length === 0" class="card p-8 text-center text-text-muted">
        조건에 맞는 과제가 없습니다.
      </div>
      <div
        v-for="assignment in filteredAssignments"
        :key="assignment.id"
        class="card card-hover p-5 flex items-start gap-4 group"
        :class="{
          'border-l-4 border-l-flag-green': getFlagBadge(assignment) === 'GREEN',
          'border-l-4 border-l-flag-amber': getFlagBadge(assignment) === 'AMBER',
          'border-l-4 border-l-flag-red': getFlagBadge(assignment) === 'RED',
        }"
      >
        <!-- D-Day Badge -->
        <div class="flex-shrink-0 pt-1">
          <div class="dday-badge" :class="getDday(assignment.due_date).class">
            {{ getDday(assignment.due_date).text }}
          </div>
        </div>

        <!-- Content -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <h3 class="font-semibold text-text-primary truncate">{{ assignment.title }}</h3>
            <span class="badge text-xs" :class="getStatusInfo(assignment).bg + ' ' + getStatusInfo(assignment).color">
              {{ getStatusInfo(assignment).label }}
            </span>
          </div>

          <div class="flex items-center gap-4 text-xs text-text-muted mt-1.5">
            <span>📅 {{ formatDate(assignment.due_date) }}</span>
            <span>⏱ {{ assignment.time_limit }}분</span>
            <span>📏 {{ assignment.text_limit?.toLocaleString() }}자</span>
            <span class="badge badge-green text-xs py-0">{{ getModeLabel(assignment.mode) }}</span>
          </div>

          <!-- Scores when submitted: graded score is primary, integrity is subtle -->
          <div v-if="submissionMap[assignment.id] && (submissionMap[assignment.id].status === 'SUBMITTED' || submissionMap[assignment.id].status === 'FORCE_CLOSED')"
            class="flex items-center gap-4 mt-3">
            <div class="flex items-center gap-1.5">
              <span class="text-xs text-text-muted">성적</span>
              <span v-if="submissionMap[assignment.id].score != null" class="font-bold text-lg text-text-primary">
                {{ Number(submissionMap[assignment.id].score) }}<span class="text-xs font-normal text-text-muted"> / {{ assignment.max_score || 100 }}</span>
              </span>
              <span v-else class="text-xs text-text-muted">채점 대기 중</span>
            </div>
            <div v-if="submissionMap[assignment.id].flagia_score != null" class="flex items-center gap-1.5 text-xs text-text-muted">
              <span class="inline-block w-2 h-2 rounded-full" :class="{
                'bg-flag-green': submissionMap[assignment.id].flag_status === 'GREEN',
                'bg-flag-amber': submissionMap[assignment.id].flag_status === 'AMBER',
                'bg-flag-red': submissionMap[assignment.id].flag_status === 'RED',
              }"></span>
              무결성 {{ Number(submissionMap[assignment.id].flagia_score).toFixed(0) }}
            </div>
          </div>
        </div>

        <!-- Action -->
        <div class="flex-shrink-0">
          <button v-if="!submissionMap[assignment.id] || submissionMap[assignment.id]?.status === 'IN_PROGRESS' || submissionMap[assignment.id]?.status === 'ASSIGNED'"
            @click="goToEditor(assignment.id)"
            class="btn btn-primary btn-sm">
            {{ submissionMap[assignment.id]?.status === 'IN_PROGRESS' ? '이어쓰기' : '작성 시작' }}
          </button>
          <button v-else-if="submissionMap[assignment.id]?.flagia_score != null"
            @click="goToAnalysis(submissionMap[assignment.id].id)"
            class="btn btn-outline btn-sm">
            분석 보기
          </button>
          <span v-else class="btn btn-ghost btn-sm cursor-default">분석 중...</span>
        </div>
      </div>
    </div>

    <!-- Join Assignment Modal -->
    <div v-if="showJoinModal" class="modal-overlay">
      <div class="modal-content max-w-sm mx-4 p-6">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-lg font-bold">과제 참여하기</h3>
          <button @click="showJoinModal = false" class="btn btn-ghost btn-xs">✕</button>
        </div>

        <form @submit.prevent="joinAssignment" class="flex flex-col gap-4">
          <div>
            <label class="label">참여 코드 (6자리)</label>
            <input v-model="joinCode" type="text" class="input font-mono tracking-widest text-center text-lg uppercase" placeholder="XXXXXX" maxlength="6" required />
            <p v-if="joinError" class="text-danger text-sm mt-2">{{ joinError }}</p>
          </div>

          <div class="flex gap-2 mt-2">
            <button type="button" @click="showJoinModal = false" class="btn btn-outline flex-1">취소</button>
            <button type="submit" class="btn btn-primary flex-1" :disabled="joining || joinCode.length < 6">
              {{ joining ? '참여 중...' : '참여하기' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

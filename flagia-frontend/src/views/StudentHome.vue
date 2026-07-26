<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'

import { resolveApiBase, resolveWsUrl } from '../composables/apiHost'
import { translateError } from '../i18n'

const API = resolveApiBase()
const WS_URL = resolveWsUrl()
const router = useRouter()
const { t, locale } = useI18n()
const { user, token } = useAuth()

const assignments = ref<any[]>([])
const submissions = ref<any[]>([])
const loading = ref(true)
const statusFilters = computed(() => [
  { v: 'ALL', l: t('common.all') },
  { v: 'NOT_STARTED', l: t('status.notStarted') },
  { v: 'IN_PROGRESS', l: t('status.inProgress') },
  { v: 'SUBMITTED', l: t('status.submitted') },
])

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
      joinError.value = translateError(data.code, data.error || t('runtime.m_6b4d07a77cf3'))
      return
    }
    showJoinModal.value = false
    joinCode.value = ''
    await refreshDataSilently()
  } catch (err) {
    joinError.value = t('runtime.m_ece8487a2e72')
  } finally {
    joining.value = false
  }
}

let refreshInterval: any = null

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

  // Polling fallback: auto-refresh assignment list every 5 seconds
  refreshInterval = setInterval(() => {
    refreshDataSilently()
  }, 5000)
})

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }
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
  return { text: t('runtime.m_f28deccc7b67'), class: 'dday-passed', val: -1 }
}

// Filtering & Sorting (local state only — no URL query binding)
const filterStatus = ref('ALL') // ALL, NOT_STARTED, IN_PROGRESS, SUBMITTED
const sortBy = ref('DUE_DATE') // DUE_DATE, NEWEST

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
      const now = Date.now()
      const aTime = new Date(a.due_date).getTime()
      const bTime = new Date(b.due_date).getTime()
      const aPassed = aTime < now
      const bPassed = bTime < now

      if (aPassed !== bPassed) {
        return aPassed ? 1 : -1
      }
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
  if (!sub || sub.status === 'ASSIGNED') return { label: t('runtime.m_a12d033696c3'), color: 'text-text-muted', bg: 'bg-background' }
  if (sub.status === 'SUBMITTED') return { label: t('runtime.m_2349d1875e73'), color: 'text-flag-green', bg: 'bg-flag-green-bg' }
  if (sub.status === 'FORCE_CLOSED') return { label: t('runtime.m_f8421db5e1f3'), color: 'text-flag-amber', bg: 'bg-flag-amber-bg' }
  return { label: t('runtime.m_5d31848228b8'), color: 'text-primary', bg: 'bg-primary-light' }
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
    STRICT: t('runtime.m_cb092501bb93'), STANDARD: t('runtime.m_989b51aff08d'), RESEARCH: t('runtime.m_02e00a021a7f'), CREATIVE: t('runtime.m_6285a6f51651'),
  }
  return labels[mode] || mode
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString(locale.value === 'ko' ? 'ko-KR' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="w-full max-w-5xl mx-auto px-6 py-8">
    <!-- Header -->
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-2xl font-bold text-text-primary">{{ $t('auto.m_2d99f75165de') }} {{ user?.name }}{{ $t('auto.m_824cc1396138') }}</h1>
        <p class="text-sm text-text-secondary mt-1">{{ $t('auto.m_8a1be9696d52') }}</p>
      </div>
      <button @click="showJoinModal = true" class="btn btn-primary"> {{ $t('auto.m_6c3f9d339ba2') }} </button>
    </div>

    <!-- Stats -->
    <div class="grid grid-cols-3 gap-4 mb-8">
      <div class="stat-card">
        <div class="stat-label">{{ $t('auto.m_bcb80c1774e0') }}</div>
        <div class="stat-value text-text-primary">{{ totalAssignments }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">{{ $t('auto.m_2349d1875e73') }}</div>
        <div class="stat-value text-flag-green">{{ completedCount }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">{{ $t('auto.m_7890cafc8d29') }}</div>
        <div class="stat-value text-primary">{{ inProgressCount }}</div>
      </div>
    </div>

    <!-- Filters & Sorting -->
    <div v-if="!loading && assignments.length > 0" class="flex flex-wrap items-center justify-between gap-4 mb-6">
      <div class="flex items-center gap-2">
        <button v-for="f in statusFilters"
          :key="f.v"
          @click="filterStatus = f.v"
          class="btn btn-sm"
          :class="filterStatus === f.v ? 'btn-primary' : 'btn-ghost bg-background border border-border'">
          {{ f.l }}
        </button>
      </div>
      <div class="flex items-center gap-2">
        <select v-model="sortBy" class="input py-1.5 text-sm h-auto bg-background">
          <option value="DUE_DATE">{{ $t('auto.m_adb339944382') }}</option>
          <option value="NEWEST">{{ $t('auto.m_0558f940dd9c') }}</option>
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
      <p class="text-text-secondary">{{ $t('auto.m_63b946d86936') }}</p>
      <p class="text-sm text-text-muted mt-1">{{ $t('auto.m_5f34d27640f7') }}</p>
    </div>

    <!-- Assignment List -->
    <div v-else class="flex flex-col gap-3">
      <div v-if="filteredAssignments.length === 0" class="card p-8 text-center text-text-muted"> {{ $t('auto.m_1ac531742f17') }} </div>
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
            <span>⏱ {{ assignment.time_limit }}{{ $t('auto.m_0b877b721418') }}</span>
            <span>📏 {{ assignment.text_limit?.toLocaleString() }}{{ $t('auto.m_a862646b2e3b') }}</span>
            <span class="badge badge-green text-xs py-0">{{ getModeLabel(assignment.mode) }}</span>
          </div>

          <!-- Scores when submitted: graded score is primary, integrity is subtle -->
          <div v-if="submissionMap[assignment.id] && (submissionMap[assignment.id].status === 'SUBMITTED' || submissionMap[assignment.id].status === 'FORCE_CLOSED')"
            class="flex items-center gap-4 mt-3">
            <div class="flex items-center gap-1.5">
              <span class="text-xs text-text-muted">{{ $t('auto.m_d3bb3576294c') }}</span>
              <span v-if="submissionMap[assignment.id].score != null" class="font-bold text-lg text-text-primary">
                {{ Number(submissionMap[assignment.id].score) }}<span class="text-xs font-normal text-text-muted"> / {{ assignment.max_score || 100 }}</span>
              </span>
              <span v-else class="text-xs text-text-muted">{{ $t('auto.m_2e59d1b000f6') }}</span>
            </div>
            <div v-if="submissionMap[assignment.id].flagia_score != null" class="flex items-center gap-1.5 text-xs text-text-muted">
              <span class="inline-block w-2 h-2 rounded-full" :class="{
                'bg-flag-green': submissionMap[assignment.id].flag_status === 'GREEN',
                'bg-flag-amber': submissionMap[assignment.id].flag_status === 'AMBER',
                'bg-flag-red': submissionMap[assignment.id].flag_status === 'RED',
              }"></span> {{ $t('auto.m_acd8d777b590') }} {{ Number(submissionMap[assignment.id].flagia_score).toFixed(0) }}
            </div>
          </div>
        </div>

        <!-- Action -->
        <div class="flex-shrink-0">
          <button v-if="!submissionMap[assignment.id] || submissionMap[assignment.id]?.status === 'IN_PROGRESS' || submissionMap[assignment.id]?.status === 'ASSIGNED'"
            @click="goToEditor(assignment.id)"
            class="btn btn-primary btn-sm">
            {{ submissionMap[assignment.id]?.status === 'IN_PROGRESS' ? t('runtime.m_ea63c3fd9d29') : t('runtime.m_571cbb7c74c8') }}
          </button>
          <button v-else-if="submissionMap[assignment.id]?.flagia_score != null"
            @click="goToAnalysis(submissionMap[assignment.id].id)"
            class="btn btn-outline btn-sm"> {{ $t('auto.m_ebb7053a8f08') }} </button>
          <span v-else class="btn btn-ghost btn-sm cursor-default">{{ $t('auto.m_784896aa9fb3') }}</span>
        </div>
      </div>
    </div>

    <!-- Join Assignment Modal -->
    <div v-if="showJoinModal" class="modal-overlay">
      <div class="modal-content max-w-sm mx-4 p-6">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-lg font-bold">{{ $t('auto.m_10782992e05f') }}</h3>
          <button @click="showJoinModal = false" class="btn btn-ghost btn-xs">✕</button>
        </div>

        <form @submit.prevent="joinAssignment" class="flex flex-col gap-4">
          <div>
            <label class="label">{{ $t('auto.m_76ecf36b9680') }}</label>
            <input v-model="joinCode" type="text" class="input font-mono tracking-widest text-center text-lg uppercase" placeholder="XXXXXX" maxlength="6" required />
            <p v-if="joinError" class="text-danger text-sm mt-2">{{ joinError }}</p>
          </div>

          <div class="flex gap-2 mt-2">
            <button type="button" @click="showJoinModal = false" class="btn btn-outline flex-1">{{ $t('auto.m_19b2d19bc141') }}</button>
            <button type="submit" class="btn btn-primary flex-1" :disabled="joining || joinCode.length < 6">
              {{ joining ? t('runtime.m_92e7069527b7') : t('runtime.m_aa19fe31fbcf') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

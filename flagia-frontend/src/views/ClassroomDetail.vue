<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'
import { api } from '../composables/useApi'
import RichTextEditor from '../components/RichTextEditor.vue'
import { resolveWsUrl } from '../composables/apiHost'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const { isAdmin, token } = useAuth()

const loading = ref(true)
const error = ref('')
const classroom = ref<any>(null)
const members = ref<any[]>([])
const assignments = ref<any[]>([])

// viewMode = access level (admins get OWNER for every classroom).
// relation = the user's actual relationship, used only for the display marker.
const viewMode = ref<'OWNER' | 'PARTICIPANT' | 'VIEWER'>('PARTICIPANT')
const relation = ref<'OWNER' | 'MEMBER' | 'NONE'>('NONE')
const isOwner = computed(() => viewMode.value === 'OWNER')
const isParticipant = computed(() => viewMode.value === 'PARTICIPANT')
const isViewer = computed(() => viewMode.value === 'VIEWER')
// Admin is managing a classroom they neither created nor joined.
const adminUnaffiliated = computed(() => isAdmin.value && relation.value === 'NONE')
const copySuccess = ref(false)

// Create assignment modal (teacher)
const showCreateModal = ref(false)
const creating = ref(false)
const form = ref({ title: '', dueDate: '', timeLimit: 60, textLimit: 3000, maxScore: 100, templateText: '', mode: 'STANDARD' })

const showDeleteModal = ref(false)
const deleting = ref(false)

async function load() {
  loading.value = true
  try {
    const data = await api(`/api/classrooms/${route.params.id}`, { token: token.value! })
    classroom.value = data.classroom
    members.value = data.members || []
    assignments.value = data.assignments || []
    viewMode.value = data.viewMode || 'VIEWER'
    relation.value = data.relation || 'NONE'
  } catch (e: any) {
    error.value = e.message || t('runtime.m_11f1cffa3c81')
  } finally {
    loading.value = false
  }
}

async function refreshDataSilently() {
  try {
    const data = await api(`/api/classrooms/${route.params.id}`, { token: token.value! })
    classroom.value = data.classroom
    members.value = data.members || []
    assignments.value = data.assignments || []
  } catch { /* noop */ }
}

const WS_URL = resolveWsUrl()
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
      const { type, payload } = msg
      if (type === 'auth_ok') {
        socket?.send(JSON.stringify({
          type: 'join_classroom',
          payload: { classroomId: route.params.id }
        }))
      } else if (type === 'classroom_members_update' && payload.classroomId === route.params.id) {
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

onMounted(async () => {
  await load()
  connectWS()
})

onUnmounted(() => {
  if (socket) {
    const s = socket
    socket = null
    s.close()
  }
})

function formatDate(d: string) {
  if (!d) return '-'
  return new Date(d).toLocaleString(locale.value === 'ko' ? 'ko-KR' : 'en-US', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function getModeLabel(mode: string) {
  return { STRICT: t('runtime.m_cb092501bb93'), STANDARD: t('runtime.m_989b51aff08d'), RESEARCH: t('runtime.m_02e00a021a7f'), CREATIVE: t('runtime.m_6285a6f51651') }[mode] || mode
}

function copyCode() {
  navigator.clipboard.writeText(classroom.value.join_code)
  copySuccess.value = true
  setTimeout(() => (copySuccess.value = false), 1500)
}

async function createAssignment() {
  if (!form.value.title || !form.value.dueDate) return
  creating.value = true
  try {
    await api('/api/assignments', {
      method: 'POST',
      body: { ...form.value, classroomId: classroom.value.id },
      token: token.value!,
    })
    showCreateModal.value = false
    form.value = { title: '', dueDate: '', timeLimit: 60, textLimit: 3000, maxScore: 100, templateText: '', mode: 'STANDARD' }
    await load()
  } catch (e: any) {
    alert(e.message || t('runtime.m_64a3b112c6c8'))
  } finally {
    creating.value = false
  }
}

async function deleteClassroom() {
  deleting.value = true
  try {
    await api(`/api/classrooms/${classroom.value.id}`, { method: 'DELETE', token: token.value! })
    router.push('/classrooms')
  } catch (e: any) {
    alert(e.message || t('runtime.m_6f323cf10e42'))
  } finally {
    deleting.value = false
  }
}

// Student: open an assignment
function openAssignment(a: any) {
  if ((a.my_status === 'SUBMITTED' || a.my_status === 'FORCE_CLOSED') && a.my_submission_id) {
    router.push(`/analysis/${a.my_submission_id}`)
  } else {
    router.push(`/editor/${a.id}`)
  }
}
// Teacher/owner: open submissions for an assignment
function openSubmissions(a: any) {
  router.push(`/teacher?assignment=${a.id}`)
}

// Row click dispatches by view mode; viewers (read-only) do nothing.
function onAssignmentRow(a: any) {
  if (isOwner.value) openSubmissions(a)
  else if (isParticipant.value) openAssignment(a)
}

function statusLabel(s: string) {
  return { IN_PROGRESS: t('runtime.m_5d31848228b8'), SUBMITTED: t('runtime.m_2349d1875e73'), FORCE_CLOSED: t('runtime.m_853da12c7c36') }[s] || t('runtime.m_a12d033696c3')
}
</script>

<template>
  <div class="w-full max-w-6xl mx-auto px-6 py-8">
    <button @click="router.push('/classrooms')" class="btn btn-outline btn-sm flex items-center gap-1.5 mb-6">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
      </svg>
      <span>{{ $t('auto.m_88db09a92e1e') }}</span>
    </button>

    <div v-if="loading" class="text-center py-16 text-text-muted">{{ $t('auto.m_06e61b86cbda') }}</div>

    <div v-else-if="error" class="card p-8 text-center">
      <div class="text-3xl mb-3">❌</div>
      <p class="text-text-primary font-medium">{{ error }}</p>
    </div>

    <template v-else-if="classroom">
      <!-- Header -->
      <div class="card p-6 mb-6">
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1">
            <div class="flex items-center gap-3 mb-2">
              <h1 class="text-2xl font-bold text-text-primary">{{ classroom.name }}</h1>
            </div>
            <p v-if="classroom.description" class="text-sm text-text-secondary mb-3">{{ classroom.description }}</p>
            <div class="flex items-center gap-4 text-xs text-text-muted">
              <span>👤 {{ classroom.teacher_name }}</span>
              <span v-if="isOwner">{{ $t('auto.m_ac70e60b574b') }} {{ members.length }}{{ $t('auto.m_5a62fd50d243') }}</span>
              <span>{{ $t('auto.m_29d76704e171') }} {{ assignments.length }}{{ $t('auto.m_11600c9ada77') }}</span>
              <span v-if="adminUnaffiliated" class="badge text-xs bg-background text-text-muted">{{ $t('auto.m_133e87491f20') }}</span>
              <span v-else-if="relation === 'MEMBER'" class="badge badge-amber text-xs">{{ $t('auto.m_5df8dd738eb1') }}</span>
            </div>
          </div>

          <!-- Join code panel -->
          <div class="flex-shrink-0 text-right">
            <div class="text-xs text-text-muted mb-1">{{ $t('auto.m_37cac543c064') }}</div>
            <div
              @click="copyCode"
              class="bg-primary-light text-primary px-3 py-2 rounded-lg flex items-center gap-2 cursor-pointer border border-primary/20 hover:bg-primary hover:text-white transition-colors"
            >
              <span class="font-mono font-bold tracking-widest text-lg">{{ classroom.join_code }}</span>
              <span class="text-xs">{{ copySuccess ? '✅' : '📋' }}</span>
            </div>
          </div>
        </div>

        <!-- Owner controls -->
        <div v-if="isOwner" class="flex items-center gap-3 mt-5 pt-4 border-t border-border">
          <button @click="showCreateModal = true" class="btn btn-primary btn-sm">{{ $t('auto.m_1e3d29361df3') }}</button>
          <button @click="showDeleteModal = true" class="btn btn-ghost btn-sm text-danger ml-auto">{{ $t('auto.m_65ac7d8f5a04') }}</button>
        </div>
      </div>

      <!-- Assignments -->
      <div class="card overflow-hidden mb-6">
        <div class="p-4 border-b border-border bg-background/50">
          <h3 class="font-semibold text-text-primary">{{ $t('auto.m_001a89099a51') }}</h3>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ $t('auto.m_078b3a1b0a3d') }}</th>
              <th>{{ $t('auto.m_7484df028355') }}</th>
              <th>{{ $t('auto.m_cd1abb7116a5') }}</th>
              <th v-if="isParticipant">{{ $t('auto.m_2926977ba7c9') }}</th>
              <th v-else>{{ $t('auto.m_75e18976ecbb') }}</th>
              <th class="text-right">{{ isParticipant ? '' : t('runtime.m_c29fba5a7caf') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="assignments.length === 0">
              <td :colspan="5" class="text-center py-10 text-text-muted">{{ $t('auto.m_58b0a29d14d5') }}</td>
            </tr>
            <tr
              v-else
              v-for="a in assignments"
              :key="a.id"
              @click="onAssignmentRow(a)"
              :class="isViewer ? 'cursor-default' : 'cursor-pointer hover:bg-background'"
            >
              <td class="font-medium text-text-primary">{{ a.title }}</td>
              <td class="text-text-secondary text-sm">{{ formatDate(a.due_date) }}</td>
              <td><span class="badge badge-green text-xs">{{ getModeLabel(a.mode) }}</span></td>
              <!-- Participant sees their own status; owner/viewer see submission counts -->
              <td v-if="isParticipant">
                <span class="badge text-xs" :class="{
                  'badge-green': a.my_status === 'SUBMITTED',
                  'badge-amber': a.my_status === 'IN_PROGRESS',
                  'badge-red': a.my_status === 'FORCE_CLOSED',
                }">{{ statusLabel(a.my_status) }}</span>
              </td>
              <td v-else class="text-text-secondary text-sm">{{ a.submission_count ?? 0 }}{{ $t('auto.m_5a62fd50d243') }}</td>
              <td class="text-right">
                <button
                  v-if="isParticipant"
                  @click.stop="openAssignment(a)"
                  class="btn btn-primary btn-xs"
                >
                  {{ a.my_status === 'SUBMITTED' || a.my_status === 'FORCE_CLOSED' ? t('runtime.m_ebb7053a8f08') : (a.my_status === 'IN_PROGRESS' ? t('runtime.m_7edf22bef17b') : t('runtime.m_389b82de7bd6')) }}
                </button>
                <span v-else-if="isViewer" class="text-xs text-text-muted">{{ $t('auto.m_005c11b79a43') }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Members (owner only) -->
      <div v-if="isOwner" class="card overflow-hidden">
        <div class="p-4 border-b border-border bg-background/50">
          <h3 class="font-semibold text-text-primary">{{ $t('auto.m_29d8f0b63022') }}{{ members.length }})</h3>
        </div>
        <table class="data-table">
          <thead>
            <tr><th>{{ $t('auto.m_9aa18e507125') }}</th><th>{{ $t('auto.m_3c37764a2b97') }}</th><th>{{ $t('auto.m_48fcd1d84c43') }}</th></tr>
          </thead>
          <tbody>
            <tr v-if="members.length === 0">
              <td colspan="3" class="text-center py-10 text-text-muted">{{ $t('auto.m_9fa37c764d5f') }}</td>
            </tr>
            <tr v-else v-for="m in members" :key="m.id">
              <td class="font-medium text-text-primary">{{ m.name }}</td>
              <td class="text-text-secondary text-sm font-mono">{{ m.email }}</td>
              <td class="text-text-muted text-sm">{{ formatDate(m.joined_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Create Assignment Modal -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="modal-content max-w-2xl mx-4 p-6 max-h-[90vh] overflow-y-auto flex flex-col">
        <div class="flex items-center justify-between mb-5 flex-shrink-0">
          <h3 class="text-xl font-bold">{{ $t('auto.m_8ba30178139a') }} {{ classroom?.name }}</h3>
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
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label">{{ $t('auto.m_fd55bbb0e0a3') }}</label>
              <input v-model.number="form.textLimit" type="number" class="input" min="100" max="50000" />
            </div>
            <div>
              <label class="label">{{ $t('auto.m_cc538699d570') }}</label>
              <input v-model.number="form.maxScore" type="number" class="input" min="1" max="1000" placeholder="100" />
            </div>
          </div>

          <div>
            <label class="label">{{ $t('auto.m_946ae8af7bb0') }}</label>
            <div class="grid grid-cols-2 gap-3 mt-1">
              <div @click="form.mode = 'STRICT'" class="mode-option" :class="{ selected: form.mode === 'STRICT' }">
                <div class="font-bold text-primary mb-1">{{ $t('auto.m_98ddc156a1da') }}</div>
                <div class="text-xs text-text-secondary leading-relaxed">{{ $t('auto.m_52165e59b763') }}</div>
              </div>
              <div @click="form.mode = 'STANDARD'" class="mode-option" :class="{ selected: form.mode === 'STANDARD' }">
                <div class="font-bold text-primary mb-1">{{ $t('auto.m_52d6a7cd8410') }}</div>
                <div class="text-xs text-text-secondary leading-relaxed">{{ $t('auto.m_9ed85ab8f981') }}</div>
              </div>
              <div @click="form.mode = 'RESEARCH'" class="mode-option" :class="{ selected: form.mode === 'RESEARCH' }">
                <div class="font-bold text-primary mb-1">{{ $t('auto.m_eecc18749edb') }}</div>
                <div class="text-xs text-text-secondary leading-relaxed">{{ $t('auto.m_5d21be7fa6ed') }}</div>
              </div>
              <div @click="form.mode = 'CREATIVE'" class="mode-option" :class="{ selected: form.mode === 'CREATIVE' }">
                <div class="font-bold text-primary mb-1">{{ $t('auto.m_f59016e666f8') }}</div>
                <div class="text-xs text-text-secondary leading-relaxed">{{ $t('auto.m_ffa03eb8f73a') }}</div>
              </div>
            </div>
          </div>

          <div class="flex flex-col">
            <label class="label">{{ $t('auto.m_e7863729827a') }}</label>
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

    <!-- Delete Classroom Modal -->
    <div v-if="showDeleteModal" class="modal-overlay" @click.self="showDeleteModal = false">
      <div class="modal-content max-w-sm mx-4 p-6 text-center">
        <div class="text-4xl mb-4">🗑️</div>
        <h3 class="text-lg font-bold mb-2">{{ $t('auto.m_65ac7d8f5a04') }}</h3>
        <p class="text-sm text-text-secondary mb-6">{{ $t('auto.m_6ce0e32f7586') }}<br>{{ $t('auto.m_2cb8d30bad29') }}</p>
        <div class="flex gap-2">
          <button @click="showDeleteModal = false" class="btn btn-outline flex-1">{{ $t('auto.m_19b2d19bc141') }}</button>
          <button @click="deleteClassroom" :disabled="deleting" class="btn bg-red-600 text-white hover:bg-red-700 flex-1 border-none">
            {{ deleting ? t('runtime.m_d2884b2998a5') : t('runtime.m_fc81e222b97c') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

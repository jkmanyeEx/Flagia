<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'
import { api } from '../composables/useApi'

const router = useRouter()
const { t } = useI18n()
const { user, token, isAdmin } = useAuth()

function owns(c: any) { return c?.teacher_id === user.value?.id }
function joined(c: any) { return Number(c?.is_member) > 0 }
function canManage(c: any) { return owns(c) || isAdmin.value }

const classrooms = ref<any[]>([])
const loading = ref(true)

// Teacher: create modal
const showCreateModal = ref(false)
const creating = ref(false)
const createForm = ref({ name: '', description: '' })

// Student: join modal
const showJoinModal = ref(false)
const joining = ref(false)
const joinCode = ref('')
const joinError = ref('')

// Edit modal
const showEditModal = ref(false)
const editing = ref(false)
const editTarget = ref<any>(null)
const editForm = ref({ name: '', description: '' })

// Delete modal
const showDeleteModal = ref(false)
const deleting = ref(false)
const deleteTarget = ref<any>(null)

// Leave modal
const showLeaveModal = ref(false)
const leaving = ref(false)
const leaveTarget = ref<any>(null)

async function load() {
  loading.value = true
  try {
    classrooms.value = await api('/api/classrooms', { token: token.value! })
  } catch { /* noop */ } finally {
    loading.value = false
  }
}
onMounted(load)

async function createClassroom() {
  if (!createForm.value.name.trim()) return
  creating.value = true
  try {
    const created = await api('/api/classrooms', {
      method: 'POST',
      body: {
        name: createForm.value.name,
        description: createForm.value.description,
      },
      token: token.value!,
    })
    showCreateModal.value = false
    createForm.value = { name: '', description: '' }
    router.push(`/classrooms/${created.id}`)
  } catch (e: any) {
    alert(e.message || t('runtime.m_da8c0288dc9c'))
  } finally {
    creating.value = false
  }
}

async function joinClassroom() {
  const code = joinCode.value.trim().toUpperCase()
  if (!code) return
  joining.value = true
  joinError.value = ''
  try {
    const res = await api(`/api/classrooms/join/${code}`, { method: 'POST', token: token.value! })
    showJoinModal.value = false
    joinCode.value = ''
    router.push(`/classrooms/${res.classroomId}`)
  } catch (e: any) {
    joinError.value = e.message || t('runtime.m_6b4d07a77cf3')
  } finally {
    joining.value = false
  }
}

function openEdit(c: any) {
  editTarget.value = c
  editForm.value = { name: c.name, description: c.description || '' }
  showEditModal.value = true
}

async function saveEdit() {
  if (!editForm.value.name.trim() || !editTarget.value) return
  editing.value = true
  try {
    await api(`/api/classrooms/${editTarget.value.id}`, {
      method: 'PATCH',
      body: { name: editForm.value.name, description: editForm.value.description },
      token: token.value!,
    })
    showEditModal.value = false
    await load()
  } catch (e: any) {
    alert(e.message || t('runtime.m_f41cd600f91f'))
  } finally {
    editing.value = false
  }
}

function openDelete(c: any) {
  deleteTarget.value = c
  showDeleteModal.value = true
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await api(`/api/classrooms/${deleteTarget.value.id}`, { method: 'DELETE', token: token.value! })
    showDeleteModal.value = false
    await load()
  } catch (e: any) {
    alert(e.message || t('runtime.m_6f323cf10e42'))
  } finally {
    deleting.value = false
  }
}

function openLeave(c: any) {
  leaveTarget.value = c
  showLeaveModal.value = true
}

async function confirmLeave() {
  if (!leaveTarget.value) return
  leaving.value = true
  try {
    await api(`/api/classrooms/${leaveTarget.value.id}/leave`, { method: 'DELETE', token: token.value! })
    showLeaveModal.value = false
    await load()
  } catch (e: any) {
    alert(e.message || t('runtime.m_4d9e0fb7a364'))
  } finally {
    leaving.value = false
  }
}
</script>

<template>
  <div class="w-full max-w-7xl mx-auto px-6 py-8">
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-2xl font-bold text-text-primary">{{ $t('auto.m_d8a728a305ce') }}</h1>
        <p class="text-sm text-text-secondary mt-1">
          {{ isAdmin
            ? t('runtime.m_1d44f811b90a')
            : user?.role === 'TEACHER'
              ? t('runtime.m_2e9d6c49f58f')
              : t('runtime.m_56ecf4110f5a') }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button v-if="user?.role === 'TEACHER' || isAdmin" @click="showCreateModal = true" class="btn btn-primary"> {{ $t('auto.m_0086ddb20344') }} </button>
        <button v-if="user?.role === 'STUDENT' || isAdmin" @click="showJoinModal = true" class="btn btn-outline"> {{ $t('auto.m_96d554a7acb9') }} </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-16 text-text-muted">{{ $t('auto.m_06e61b86cbda') }}</div>

    <!-- Empty -->
    <div v-else-if="classrooms.length === 0" class="card p-12 text-center">
      <div class="text-4xl mb-3">🏫</div>
      <p class="text-text-primary font-medium mb-1">
        {{ isAdmin ? t('runtime.m_4a9439731531') : user?.role === 'TEACHER' ? t('runtime.m_e8518d00c94d') : t('runtime.m_480996c1b27c') }}
      </p>
      <p class="text-sm text-text-muted">
        {{ isAdmin ? t('runtime.m_7598e4137f47') : user?.role === 'TEACHER' ? t('runtime.m_07326560e3e2') : t('runtime.m_158a5daae754') }}
      </p>
    </div>

    <!-- Grid -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="c in classrooms"
        :key="c.id"
        @click="router.push(`/classrooms/${c.id}`)"
        class="card p-5 cursor-pointer hover:border-primary transition-colors"
      >
        <div class="flex items-start justify-between mb-2">
          <h3 class="text-lg font-bold text-text-primary">{{ c.name }}</h3>
          <span class="font-mono text-xs bg-background px-2 py-0.5 rounded border border-border">{{ c.join_code }}</span>
        </div>

        <!-- Admin: ownership / membership indicator -->
        <div v-if="isAdmin" class="mb-2">
          <span v-if="owns(c)" class="badge badge-green text-xs">{{ $t('auto.m_788aa643e78c') }}</span>
          <span v-else-if="joined(c)" class="badge badge-amber text-xs">{{ $t('auto.m_5df8dd738eb1') }}</span>
          <span v-else class="badge text-xs bg-background text-text-muted">{{ $t('auto.m_1bcb8a0449c6') }}</span>
        </div>

        <p v-if="c.description" class="text-sm text-text-secondary mb-4 line-clamp-2">{{ c.description }}</p>
        <p v-else class="text-sm text-text-muted italic mb-4">{{ $t('auto.m_86016beba92d') }}</p>

        <div class="flex items-center gap-4 text-xs text-text-muted">
          <span>{{ $t('auto.m_ac70e60b574b') }} {{ c.member_count ?? 0 }}{{ $t('auto.m_5a62fd50d243') }}</span>
          <span>{{ $t('auto.m_29d76704e171') }} {{ c.assignment_count ?? 0 }}{{ $t('auto.m_11600c9ada77') }}</span>
          <span v-if="(user?.role === 'STUDENT' || isAdmin) && c.teacher_name">👤 {{ c.teacher_name }}</span>
        </div>

        <!-- Action buttons -->
        <div class="flex items-center gap-2 mt-4 pt-3 border-t border-border">
          <!-- Edit (teacher/admin who owns it, or admin for any) -->
          <button
            v-if="canManage(c)"
            @click.stop="openEdit(c)"
            class="btn btn-outline btn-xs"
          >{{ $t('auto.m_7f3a94b4066c') }}</button>
          <!-- Delete (teacher/admin who owns it, or admin for any) -->
          <button
            v-if="canManage(c)"
            @click.stop="openDelete(c)"
            class="btn btn-ghost btn-xs text-danger"
          >{{ $t('auto.m_7331f1265ec6') }}</button>
          <!-- Leave (student, or admin who joined as member) -->
          <button
            v-if="(user?.role === 'STUDENT') || (isAdmin && joined(c))"
            @click.stop="openLeave(c)"
            class="btn btn-ghost btn-xs text-danger ml-auto"
          >{{ $t('auto.m_80fa14fb138a') }}</button>
        </div>
      </div>
    </div>

    <!-- Create Modal (teacher) -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="modal-content max-w-md mx-4 p-6">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-xl font-bold">{{ $t('auto.m_8950eb25f0e3') }}</h3>
          <button @click="showCreateModal = false" class="btn btn-ghost btn-xs">✕</button>
        </div>

        <form @submit.prevent="createClassroom" class="flex flex-col gap-5">
          <div>
            <label class="label">{{ $t('auto.m_7c004e6ceab6') }}</label>
            <input v-model="createForm.name" class="input" :placeholder="$t('auto.m_8ea712ee7715')" required />
          </div>
          <div>
            <label class="label">{{ $t('auto.m_e4a45c959d26') }}</label>
            <textarea v-model="createForm.description" class="input" rows="3" :placeholder="$t('auto.m_3b816aa756c3')"></textarea>
          </div>

          <p class="text-xs text-text-muted"> {{ $t('auto.m_076a2e8fa971') }} </p>

          <div class="flex justify-end gap-3 pt-2">
            <button type="button" @click="showCreateModal = false" class="btn btn-outline">{{ $t('auto.m_19b2d19bc141') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="creating">
              {{ creating ? t('runtime.m_56bc49b0ea17') : t('runtime.m_900f6d40e351') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Join Modal (student) -->
    <div v-if="showJoinModal" class="modal-overlay" @click.self="showJoinModal = false">
      <div class="modal-content max-w-sm mx-4 p-6">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-xl font-bold">{{ $t('auto.m_4218233945c6') }}</h3>
          <button @click="showJoinModal = false" class="btn btn-ghost btn-xs">✕</button>
        </div>

        <form @submit.prevent="joinClassroom" class="flex flex-col gap-4">
          <div>
            <label class="label">{{ $t('auto.m_37cac543c064') }}</label>
            <input
              v-model="joinCode"
              class="input font-mono tracking-widest text-center uppercase"
              :placeholder="$t('auto.m_19d6bdc99aa5')"
              maxlength="8"
              required
            />
          </div>
          <p v-if="joinError" class="text-sm text-flag-red">{{ joinError }}</p>
          <div class="flex justify-end gap-3">
            <button type="button" @click="showJoinModal = false" class="btn btn-outline">{{ $t('auto.m_19b2d19bc141') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="joining">
              {{ joining ? t('runtime.m_92e7069527b7') : t('runtime.m_aa19fe31fbcf') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Edit Modal -->
    <div v-if="showEditModal" class="modal-overlay" @click.self="showEditModal = false">
      <div class="modal-content max-w-md mx-4 p-6">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-xl font-bold">{{ $t('auto.m_a0d83f95b712') }}</h3>
          <button @click="showEditModal = false" class="btn btn-ghost btn-xs">✕</button>
        </div>
        <form @submit.prevent="saveEdit" class="flex flex-col gap-5">
          <div>
            <label class="label">{{ $t('auto.m_7c004e6ceab6') }}</label>
            <input v-model="editForm.name" class="input" :placeholder="$t('auto.m_7c004e6ceab6')" required />
          </div>
          <div>
            <label class="label">{{ $t('auto.m_e4a45c959d26') }}</label>
            <textarea v-model="editForm.description" class="input" rows="3" :placeholder="$t('auto.m_3b816aa756c3')"></textarea>
          </div>
          <div class="flex justify-end gap-3 pt-2">
            <button type="button" @click="showEditModal = false" class="btn btn-outline">{{ $t('auto.m_19b2d19bc141') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="editing">
              {{ editing ? t('runtime.m_5d687060860a') : t('runtime.m_1f1712acff27') }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <div v-if="showDeleteModal" class="modal-overlay" @click.self="showDeleteModal = false">
      <div class="modal-content max-w-sm mx-4 p-6 text-center">
        <div class="text-4xl mb-4">🗑️</div>
        <h3 class="text-lg font-bold mb-2">{{ $t('auto.m_65ac7d8f5a04') }}</h3>
        <p class="text-sm text-text-secondary mb-2">
          <strong>{{ deleteTarget?.name }}</strong>{{ $t('auto.m_6d8da5d40847') }} </p>
        <p class="text-xs text-text-muted mb-6">{{ $t('auto.m_2cb8d30bad29') }}</p>
        <div class="flex gap-2">
          <button @click="showDeleteModal = false" class="btn btn-outline flex-1">{{ $t('auto.m_19b2d19bc141') }}</button>
          <button @click="confirmDelete" :disabled="deleting" class="btn bg-red-600 text-white hover:bg-red-700 flex-1 border-none">
            {{ deleting ? t('runtime.m_d2884b2998a5') : t('runtime.m_fc81e222b97c') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Leave Confirmation Modal -->
    <div v-if="showLeaveModal" class="modal-overlay" @click.self="showLeaveModal = false">
      <div class="modal-content max-w-sm mx-4 p-6 text-center">
        <div class="text-4xl mb-4">👋</div>
        <h3 class="text-lg font-bold mb-2">{{ $t('auto.m_5865a030ce4b') }}</h3>
        <p class="text-sm text-text-secondary mb-6">
          <strong>{{ leaveTarget?.name }}</strong>{{ $t('auto.m_13bc6ee4ae2d') }}<br> {{ $t('auto.m_bd68ae6af18a') }} </p>
        <div class="flex gap-2">
          <button @click="showLeaveModal = false" class="btn btn-outline flex-1">{{ $t('auto.m_19b2d19bc141') }}</button>
          <button @click="confirmLeave" :disabled="leaving" class="btn bg-red-600 text-white hover:bg-red-700 flex-1 border-none">
            {{ leaving ? t('runtime.m_a6519d0dcdf5') : t('runtime.m_80fa14fb138a') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

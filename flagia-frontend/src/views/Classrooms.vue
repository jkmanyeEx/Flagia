<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { api } from '../composables/useApi'

const router = useRouter()
const { user, token, isAdmin } = useAuth()

function owns(c: any) { return c?.teacher_id === user.value?.id }
function joined(c: any) { return Number(c?.is_member) > 0 }

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
    alert(e.message || '학급 생성 중 오류가 발생했습니다')
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
    joinError.value = e.message || '참여에 실패했습니다'
  } finally {
    joining.value = false
  }
}
</script>

<template>
  <div class="w-full max-w-7xl mx-auto px-6 py-8">
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-2xl font-bold text-text-primary">학급</h1>
        <p class="text-sm text-text-secondary mt-1">
          {{ isAdmin
            ? '관리자 권한으로 모든 학급을 열람하고 관리할 수 있습니다. 직접 만들거나 참여하지 않은 학급은 표시로 구분됩니다.'
            : user?.role === 'TEACHER'
              ? '학급을 만들고 학생을 초대해 과제를 운영하세요.'
              : '참여 코드로 학급에 입장하고 배정된 과제를 확인하세요.' }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button v-if="user?.role === 'TEACHER' || isAdmin" @click="showCreateModal = true" class="btn btn-primary">
          + 새 학급 만들기
        </button>
        <button v-if="user?.role === 'STUDENT' || isAdmin" @click="showJoinModal = true" class="btn btn-outline">
          코드로 참여하기
        </button>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-16 text-text-muted">로딩 중...</div>

    <!-- Empty -->
    <div v-else-if="classrooms.length === 0" class="card p-12 text-center">
      <div class="text-4xl mb-3">🏫</div>
      <p class="text-text-primary font-medium mb-1">
        {{ isAdmin ? '아직 생성된 학급이 없습니다' : user?.role === 'TEACHER' ? '아직 만든 학급이 없습니다' : '참여한 학급이 없습니다' }}
      </p>
      <p class="text-sm text-text-muted">
        {{ isAdmin ? '교사가 학급을 만들면 여기에 표시됩니다.' : user?.role === 'TEACHER' ? '첫 학급을 만들어 학생을 초대하세요.' : '선생님께 받은 참여 코드를 입력하세요.' }}
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
          <span v-if="owns(c)" class="badge badge-green text-xs">내 학급</span>
          <span v-else-if="joined(c)" class="badge badge-amber text-xs">참여 중</span>
          <span v-else class="badge text-xs bg-background text-text-muted">미소유·미참여</span>
        </div>

        <p v-if="c.description" class="text-sm text-text-secondary mb-4 line-clamp-2">{{ c.description }}</p>
        <p v-else class="text-sm text-text-muted italic mb-4">설명 없음</p>

        <div class="flex items-center gap-4 text-xs text-text-muted">
          <span>👥 학생 {{ c.member_count ?? 0 }}명</span>
          <span>📝 과제 {{ c.assignment_count ?? 0 }}개</span>
          <span v-if="(user?.role === 'STUDENT' || isAdmin) && c.teacher_name">👤 {{ c.teacher_name }}</span>
        </div>
      </div>
    </div>

    <!-- Create Modal (teacher) -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="modal-content max-w-md mx-4 p-6">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-xl font-bold">새 학급 만들기</h3>
          <button @click="showCreateModal = false" class="btn btn-ghost btn-xs">✕</button>
        </div>

        <form @submit.prevent="createClassroom" class="flex flex-col gap-5">
          <div>
            <label class="label">학급 이름</label>
            <input v-model="createForm.name" class="input" placeholder="예: 3학년 2반 국어" required />
          </div>
          <div>
            <label class="label">설명 (선택)</label>
            <textarea v-model="createForm.description" class="input" rows="3" placeholder="학급에 대한 간단한 설명"></textarea>
          </div>

          <p class="text-xs text-text-muted">
            학급을 만들면 참여 코드가 자동 생성됩니다. 학생에게 코드를 공유해 학급에 초대하세요.
          </p>

          <div class="flex justify-end gap-3 pt-2">
            <button type="button" @click="showCreateModal = false" class="btn btn-outline">취소</button>
            <button type="submit" class="btn btn-primary" :disabled="creating">
              {{ creating ? '생성 중...' : '학급 생성하기' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Join Modal (student) -->
    <div v-if="showJoinModal" class="modal-overlay" @click.self="showJoinModal = false">
      <div class="modal-content max-w-sm mx-4 p-6">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-xl font-bold">학급 참여</h3>
          <button @click="showJoinModal = false" class="btn btn-ghost btn-xs">✕</button>
        </div>

        <form @submit.prevent="joinClassroom" class="flex flex-col gap-4">
          <div>
            <label class="label">참여 코드</label>
            <input
              v-model="joinCode"
              class="input font-mono tracking-widest text-center uppercase"
              placeholder="예: AB12CD"
              maxlength="8"
              required
            />
          </div>
          <p v-if="joinError" class="text-sm text-flag-red">{{ joinError }}</p>
          <div class="flex justify-end gap-3">
            <button type="button" @click="showJoinModal = false" class="btn btn-outline">취소</button>
            <button type="submit" class="btn btn-primary" :disabled="joining">
              {{ joining ? '참여 중...' : '참여하기' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

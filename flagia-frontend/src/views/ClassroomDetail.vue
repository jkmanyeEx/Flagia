<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { api } from '../composables/useApi'
import RichTextEditor from '../components/RichTextEditor.vue'

const route = useRoute()
const router = useRouter()
const { user, token } = useAuth()

const loading = ref(true)
const error = ref('')
const classroom = ref<any>(null)
const members = ref<any[]>([])
const assignments = ref<any[]>([])

const isTeacher = ref(false)
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
    isTeacher.value = user.value?.role === 'TEACHER' && classroom.value.teacher_id === user.value?.id
  } catch (e: any) {
    error.value = e.message || '학급 정보를 불러올 수 없습니다'
  } finally {
    loading.value = false
  }
}
onMounted(load)

function formatDate(d: string) {
  if (!d) return '-'
  return new Date(d).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function getModeLabel(mode: string) {
  return { STRICT: '엄격', STANDARD: '표준', RESEARCH: '연구', CREATIVE: '자유' }[mode] || mode
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
    alert(e.message || '과제 생성 중 오류가 발생했습니다')
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
    alert(e.message || '삭제에 실패했습니다')
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
// Teacher: open submissions for an assignment
function openSubmissions(a: any) {
  router.push(`/teacher?assignment=${a.id}`)
}

function statusLabel(s: string) {
  return { IN_PROGRESS: '작성 중', SUBMITTED: '제출 완료', FORCE_CLOSED: '강제 종료' }[s] || '미시작'
}
</script>

<template>
  <div class="w-full max-w-6xl mx-auto px-6 py-8">
    <button @click="router.push('/classrooms')" class="btn btn-outline btn-sm flex items-center gap-1.5 mb-6">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
      </svg>
      <span>학급 목록</span>
    </button>

    <div v-if="loading" class="text-center py-16 text-text-muted">로딩 중...</div>

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
              <span v-if="isTeacher">👥 학생 {{ members.length }}명</span>
              <span>📝 과제 {{ assignments.length }}개</span>
            </div>
          </div>

          <!-- Join code panel -->
          <div class="flex-shrink-0 text-right">
            <div class="text-xs text-text-muted mb-1">참여 코드</div>
            <div
              @click="copyCode"
              class="bg-primary-light text-primary px-3 py-2 rounded-lg flex items-center gap-2 cursor-pointer border border-primary/20 hover:bg-primary hover:text-white transition-colors"
            >
              <span class="font-mono font-bold tracking-widest text-lg">{{ classroom.join_code }}</span>
              <span class="text-xs">{{ copySuccess ? '✅' : '📋' }}</span>
            </div>
          </div>
        </div>

        <!-- Teacher controls -->
        <div v-if="isTeacher" class="flex items-center gap-3 mt-5 pt-4 border-t border-border">
          <button @click="showCreateModal = true" class="btn btn-primary btn-sm">+ 새 과제</button>
          <button @click="showDeleteModal = true" class="btn btn-ghost btn-sm text-danger ml-auto">학급 삭제</button>
        </div>
      </div>

      <!-- Assignments -->
      <div class="card overflow-hidden mb-6">
        <div class="p-4 border-b border-border bg-background/50">
          <h3 class="font-semibold text-text-primary">과제</h3>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>제목</th>
              <th>마감일</th>
              <th>모드</th>
              <th v-if="isTeacher">제출</th>
              <th v-else>상태</th>
              <th class="text-right">{{ isTeacher ? '관리' : '' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="assignments.length === 0">
              <td :colspan="5" class="text-center py-10 text-text-muted">아직 과제가 없습니다.</td>
            </tr>
            <tr
              v-else
              v-for="a in assignments"
              :key="a.id"
              @click="isTeacher ? openSubmissions(a) : openAssignment(a)"
              class="cursor-pointer hover:bg-background"
            >
              <td class="font-medium text-text-primary">{{ a.title }}</td>
              <td class="text-text-secondary text-sm">{{ formatDate(a.due_date) }}</td>
              <td><span class="badge badge-green text-xs">{{ getModeLabel(a.mode) }}</span></td>
              <td v-if="isTeacher" class="text-text-secondary text-sm">{{ a.submission_count ?? 0 }}명</td>
              <td v-else>
                <span class="badge text-xs" :class="{
                  'badge-green': a.my_status === 'SUBMITTED',
                  'badge-amber': a.my_status === 'IN_PROGRESS',
                  'badge-red': a.my_status === 'FORCE_CLOSED',
                }">{{ statusLabel(a.my_status) }}</span>
              </td>
              <td class="text-right">
                <button
                  v-if="!isTeacher"
                  @click.stop="openAssignment(a)"
                  class="btn btn-primary btn-xs"
                >
                  {{ a.my_status === 'SUBMITTED' || a.my_status === 'FORCE_CLOSED' ? '분석 보기' : (a.my_status === 'IN_PROGRESS' ? '이어 쓰기' : '시작하기') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Members (teacher) -->
      <div v-if="isTeacher" class="card overflow-hidden">
        <div class="p-4 border-b border-border bg-background/50">
          <h3 class="font-semibold text-text-primary">학생 명단 ({{ members.length }})</h3>
        </div>
        <table class="data-table">
          <thead>
            <tr><th>이름</th><th>이메일</th><th>참여일</th></tr>
          </thead>
          <tbody>
            <tr v-if="members.length === 0">
              <td colspan="3" class="text-center py-10 text-text-muted">아직 참여한 학생이 없습니다. 참여 코드를 공유하세요.</td>
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
          <h3 class="text-xl font-bold">새 과제 만들기 · {{ classroom?.name }}</h3>
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
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label">글자 수 제한</label>
              <input v-model.number="form.textLimit" type="number" class="input" min="100" max="50000" />
            </div>
            <div>
              <label class="label">최대 배점</label>
              <input v-model.number="form.maxScore" type="number" class="input" min="1" max="1000" placeholder="100" />
            </div>
          </div>

          <div>
            <label class="label">분석 모드</label>
            <div class="grid grid-cols-2 gap-3 mt-1">
              <div @click="form.mode = 'STRICT'" class="mode-option" :class="{ selected: form.mode === 'STRICT' }">
                <div class="font-bold text-primary mb-1">엄격 (Strict)</div>
                <div class="text-xs text-text-secondary leading-relaxed">탭 이탈·붙여넣기를 엄격하게 감지. 시험·평가용.</div>
              </div>
              <div @click="form.mode = 'STANDARD'" class="mode-option" :class="{ selected: form.mode === 'STANDARD' }">
                <div class="font-bold text-primary mb-1">표준 (Standard)</div>
                <div class="text-xs text-text-secondary leading-relaxed">일반 글쓰기 환경. 비정상 패턴에만 경고.</div>
              </div>
              <div @click="form.mode = 'RESEARCH'" class="mode-option" :class="{ selected: form.mode === 'RESEARCH' }">
                <div class="font-bold text-primary mb-1">연구 (Research)</div>
                <div class="text-xs text-text-secondary leading-relaxed">자료 조사·외부 참조 허용.</div>
              </div>
              <div @click="form.mode = 'CREATIVE'" class="mode-option" :class="{ selected: form.mode === 'CREATIVE' }">
                <div class="font-bold text-primary mb-1">자유 (Creative)</div>
                <div class="text-xs text-text-secondary leading-relaxed">행동 제한 없이 타이핑 패턴만 수집.</div>
              </div>
            </div>
          </div>

          <div class="flex flex-col">
            <label class="label">가이드라인 템플릿 (학생에게 기본 제공)</label>
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

    <!-- Delete Classroom Modal -->
    <div v-if="showDeleteModal" class="modal-overlay" @click.self="showDeleteModal = false">
      <div class="modal-content max-w-sm mx-4 p-6 text-center">
        <div class="text-4xl mb-4">🗑️</div>
        <h3 class="text-lg font-bold mb-2">학급 삭제</h3>
        <p class="text-sm text-text-secondary mb-6">이 학급을 삭제하시겠습니까?<br>학급 내 모든 과제와 제출물이 함께 삭제되며 복구할 수 없습니다.</p>
        <div class="flex gap-2">
          <button @click="showDeleteModal = false" class="btn btn-outline flex-1">취소</button>
          <button @click="deleteClassroom" :disabled="deleting" class="btn bg-red-600 text-white hover:bg-red-700 flex-1 border-none">
            {{ deleting ? '삭제 중...' : '삭제' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

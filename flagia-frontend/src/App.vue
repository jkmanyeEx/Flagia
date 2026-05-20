<script setup lang="ts">
import { computed, onErrorCaptured, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from './composables/useAuth'

const router = useRouter()
const route = useRoute()
const { user, isLoggedIn, logout: doLogout } = useAuth()

// ── Layout logic ──
const publicPages = ['landing', 'login', 'register']
const isPublicPage = computed(() => publicPages.includes(route.name as string))
const isEditorView = computed(() => route.name === 'editor')

// ── Modals and Mobile Sidebar ──
const isSidebarOpen = ref(false)
const showGuideModal = ref(false)
const showSettingsModal = ref(false)

// Close sidebar on route change
watch(() => route.fullPath, () => {
  isSidebarOpen.value = false
  renderError.value = null
})

// ── Error boundary to prevent white-out ──
const renderError = ref<string | null>(null)
onErrorCaptured((err) => {
  console.error('Component render error caught:', err)
  renderError.value = err instanceof Error ? err.message : '렌더링 오류가 발생했습니다'
  return false // prevent propagation
})

function handleLogout() {
  doLogout()
  router.push('/login')
}

function goHome() {
  router.push('/dashboard')
}

// Single mutually-exclusive active nav key — avoids multiple items
// highlighting at once (e.g. 대시보드 + 과제 관리 both lighting up on /teacher).
const activeNav = computed(() => {
  const n = route.name as string
  if (n === 'analysis') return 'analysis'
  if (n === 'classrooms' || n === 'classroom-detail') return 'classrooms'
  if (user.value?.role === 'TEACHER') {
    if (n === 'teacher' || n === 'dashboard') return 'teacher-dash'
    return ''
  }
  // Student
  if (n === 'student-home' || n === 'dashboard') {
    if (route.query.filter === 'IN_PROGRESS') return 'student-inprogress'
    if (route.query.filter === 'SUBMITTED') return 'student-submitted'
    return 'student-all'
  }
  return ''
})
</script>

<template>
  <!-- ─── PUBLIC LAYOUT (landing, login, register) ─── -->
  <div v-if="isPublicPage" class="min-h-screen">
    <router-view v-slot="{ Component }">
      <transition name="fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>
  </div>

  <!-- ─── EDITOR LAYOUT (full screen, no nav) ─── -->
  <div v-else-if="isEditorView" class="min-h-screen">
    <router-view />
  </div>

  <!-- ─── AUTHENTICATED LAYOUT (Sideways Sidebar Navbar + Content) ─── -->
  <div v-else class="app-layout">
    
    <!-- Sidebar Overlay for Mobile -->
    <div 
      v-if="isSidebarOpen" 
      class="sidebar-overlay md:hidden" 
      @click="isSidebarOpen = false"
    ></div>

    <!-- Sidebar Component -->
    <aside class="app-sidebar" :class="{ 'open': isSidebarOpen }">
      <div class="sidebar-brand" @click="goHome">
        <div class="sidebar-logo-icon">
          <img src="/logo.jpg" alt="Flagia" />
        </div>
        <span class="sidebar-logo-text">Flagia</span>
      </div>

      <!-- User Profile Card -->
      <div class="sidebar-profile">
        <div class="sidebar-user-info">
          <span class="sidebar-user-name">{{ user?.name }}</span>
          <span class="sidebar-user-role">{{ user?.role === 'TEACHER' ? '교사 계정' : '학생 계정' }}</span>
        </div>
      </div>

      <!-- Navigation links -->
      <div class="sidebar-nav">
        <!-- Classrooms (both roles) -->
        <button @click="router.push('/classrooms')" class="sidebar-nav-item" :class="{ active: activeNav === 'classrooms' }">
          <span class="item-icon">🏫</span>
          <span class="item-label">학급</span>
        </button>

        <!-- Teacher-specific links -->
        <template v-if="user?.role === 'TEACHER'">
          <button @click="router.push('/teacher')" class="sidebar-nav-item" :class="{ active: activeNav === 'teacher-dash' }">
            <span class="item-icon">📝</span>
            <span class="item-label">과제 관리</span>
          </button>
        </template>

        <!-- Student-specific links -->
        <template v-else>
          <button @click="router.push('/student')" class="sidebar-nav-item" :class="{ active: activeNav === 'student-all' }">
            <span class="item-icon">📋</span>
            <span class="item-label">전체 과제 목록</span>
          </button>
          <button @click="router.push('/student?filter=IN_PROGRESS')" class="sidebar-nav-item" :class="{ active: activeNav === 'student-inprogress' }">
            <span class="item-icon">✏️</span>
            <span class="item-label">진행 중인 과제</span>
          </button>
          <button @click="router.push('/student?filter=SUBMITTED')" class="sidebar-nav-item" :class="{ active: activeNav === 'student-submitted' }">
            <span class="item-icon">📁</span>
            <span class="item-label">제출 완료 목록</span>
          </button>
        </template>

        <div class="sidebar-divider"></div>

        <!-- Help & Settings -->
        <button @click="showGuideModal = true" class="sidebar-nav-item">
          <span class="item-icon">📖</span>
          <span class="item-label">사용 가이드</span>
        </button>
        <button @click="showSettingsModal = true" class="sidebar-nav-item">
          <span class="item-icon">⚙️</span>
          <span class="item-label">시스템 설정</span>
        </button>
      </div>

      <!-- Logout footer -->
      <div class="sidebar-footer">
        <button @click="handleLogout" class="sidebar-logout-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span>로그아웃</span>
        </button>
      </div>
    </aside>

    <!-- Main Body Area -->
    <div class="app-body-wrapper">
      
      <!-- Mobile Top Header -->
      <header class="mobile-header md:hidden">
        <div class="mobile-brand" @click="goHome">
          <img src="/logo.jpg" alt="Flagia" class="mobile-logo-img" />
          <span class="mobile-logo-text">Flagia</span>
        </div>
      </header>

      <!-- Content Body -->
      <main class="app-content-area">
        <!-- Error boundary fallback -->
        <div v-if="renderError" class="error-fallback">
          <div class="error-fallback-inner">
            <div class="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center mb-4 mx-auto">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-red-500">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-text-primary mb-2">페이지 로드 오류</h3>
            <p class="text-sm text-text-secondary mb-4">{{ renderError }}</p>
            <button @click="renderError = null; router.push('/dashboard')" class="btn btn-primary">
              대시보드로 돌아가기
            </button>
          </div>
        </div>

        <router-view v-else v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>

    <!-- ─── Guide Modal ─── -->
    <div v-if="showGuideModal" class="modal-overlay" @click.self="showGuideModal = false">
      <div class="modal-content max-w-xl mx-4 p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold text-text-primary">📖 Flagia 이용 가이드</h3>
          <button @click="showGuideModal = false" class="btn btn-ghost btn-xs">✕</button>
        </div>

        <div class="space-y-4 text-sm text-text-secondary overflow-y-auto max-h-[60vh] pr-2">
          <section>
            <h4 class="font-semibold text-text-primary mb-1">🔍 Flagia Score (0–100)</h4>
            <p class="leading-relaxed">
              학생이 글을 쓰는 동안 수집된 키 입력 텔레메트리를 분석해 <strong>사람이 직접 작성했을 신뢰도</strong>를 점수화합니다. 아래 5개 지표의 가중 합산으로 산출됩니다.
            </p>
          </section>

          <section>
            <h4 class="font-semibold text-text-primary mb-1">📊 5개 분석 지표</h4>
            <ul class="list-disc pl-5 space-y-1">
              <li><strong>⌨️ 타이핑 리듬</strong>: 키 입력 간격의 변동 계수(Cv). 기계처럼 일정하거나 붙여넣기로 표본이 부족하면 낮아집니다.</li>
              <li><strong>✏️ 수정 강도</strong>: 키 입력 수 대비 최종 글자 수 비율. 수정 흔적이 거의 없으면 사전 작성·복사를 의심합니다.</li>
              <li><strong>📋 외부 콘텐츠</strong>: 붙여넣기 횟수와 분량. 외부에서 가져온 비중이 클수록 낮아집니다.</li>
              <li><strong>👁️ 집중도</strong>: 작성 중 에디터 이탈(blur) 누적 시간.</li>
              <li><strong>⏱️ 작성 시간</strong>: 분량 대비 작성 속도(분당 글자 수). 사람이 타이핑하기엔 너무 빠르면 낮아집니다.</li>
            </ul>
          </section>

          <section>
            <h4 class="font-semibold text-text-primary mb-1">🛡 분석 모드 (지표 가중치 조절)</h4>
            <ul class="list-disc pl-5 space-y-1">
              <li><strong>STRICT (시험)</strong>: 타이핑 리듬을 가장 엄격하게 평가합니다. (GREEN ≥ 75)</li>
              <li><strong>STANDARD (일반 과제)</strong>: 균형 잡힌 기본 권장 모드입니다. (GREEN ≥ 70)</li>
              <li><strong>RESEARCH (조사)</strong>: 외부 참고를 허용하되 붙여넣기 비중을 중점 평가합니다. (GREEN ≥ 60)</li>
              <li><strong>CREATIVE (창작)</strong>: 리듬 기준을 완화하고 수정 활동을 폭넓게 인정합니다. (GREEN ≥ 55)</li>
            </ul>
          </section>

          <section>
            <h4 class="font-semibold text-text-primary mb-1">🚦 플래그 판정</h4>
            <p class="leading-relaxed">
              🟢 <strong>안전</strong> · 🟡 <strong>주의</strong> · 🔴 <strong>위험</strong>. 🟡 이상은 부정행위 단정이 아닌 <strong>추가 확인 권장</strong> 신호입니다.
            </p>
          </section>

          <section>
            <h4 class="font-semibold text-text-primary mb-1">🎥 작성 리플레이 & 채점</h4>
            <p class="leading-relaxed">
              교사는 분석 리포트에서 학생의 키 입력 과정을 재생(리플레이)하며 작성 흐름을 검토하고, 본문 화면에서 점수와 피드백을 입력할 수 있습니다.
            </p>
          </section>
        </div>
        
        <div class="mt-6 flex justify-end">
          <button @click="showGuideModal = false" class="btn btn-primary">확인</button>
        </div>
      </div>
    </div>

    <!-- ─── Settings Modal ─── -->
    <div v-if="showSettingsModal" class="modal-overlay" @click.self="showSettingsModal = false">
      <div class="modal-content max-w-md mx-4 p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold text-text-primary">⚙️ 시스템 설정</h3>
          <button @click="showSettingsModal = false" class="btn btn-ghost btn-xs">✕</button>
        </div>

        <div class="space-y-5 text-sm text-text-secondary">
          <!-- Account info (real data) -->
          <section>
            <h4 class="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">계정 정보</h4>
            <div class="bg-background rounded-lg p-3 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-text-muted">이름</span>
                <span class="font-semibold text-text-primary">{{ user?.name }}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-text-muted">이메일</span>
                <span class="font-mono text-text-primary">{{ user?.email }}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-text-muted">역할</span>
                <span class="badge" :class="user?.role === 'TEACHER' ? 'badge-green' : 'badge-amber'">
                  {{ user?.role === 'TEACHER' ? '교사' : '학생' }}
                </span>
              </div>
            </div>
          </section>

          <!-- Security info (real, from README/backend) -->
          <section>
            <h4 class="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">보안 & 무결성</h4>
            <ul class="bg-background rounded-lg p-3 space-y-1.5 text-xs">
              <li class="flex items-center gap-2"><span>🔒</span> 전송 구간 HTTPS / TLS 1.3</li>
              <li class="flex items-center gap-2"><span>🔑</span> JWT 세션 (24시간 만료)</li>
              <li class="flex items-center gap-2"><span>🧩</span> 텔레메트리 SHA-256 해시 체이닝 (변조 탐지)</li>
            </ul>
          </section>
        </div>

        <div class="mt-6 flex justify-end">
          <button @click="showSettingsModal = false" class="btn btn-primary">닫기</button>
        </div>
      </div>
    </div>

  </div>
</template>

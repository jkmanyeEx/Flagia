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

// Mock settings options
const gradingScale = ref('100')
const autoGrade = ref(true)
const emailNotify = ref(true)

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

// Active nav check
function isActive(path: string) {
  return route.path === path || route.path.startsWith(path + '/')
}
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
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
            <line x1="4" y1="22" x2="4" y2="15"/>
          </svg>
        </div>
        <span class="sidebar-logo-text">Flagia</span>
      </div>

      <!-- User Profile Card -->
      <div class="sidebar-profile">
        <div class="sidebar-avatar">{{ user?.name?.charAt(0) || '?' }}</div>
        <div class="sidebar-user-info">
          <span class="sidebar-user-name">{{ user?.name }}</span>
          <span class="sidebar-user-role">{{ user?.role === 'TEACHER' ? '교사 계정' : '학생 계정' }}</span>
        </div>
      </div>

      <!-- Navigation links -->
      <div class="sidebar-nav">
        <button 
          @click="goHome" 
          class="sidebar-nav-item" 
          :class="{ active: route.name === 'dashboard' || (isActive('/teacher') && !route.query.view) || (isActive('/student') && !route.query.filter) }"
        >
          <span class="item-icon">📊</span>
          <span class="item-label">대시보드</span>
        </button>

        <!-- Teacher-specific links -->
        <template v-if="user?.role === 'TEACHER'">
          <button @click="router.push('/teacher')" class="sidebar-nav-item" :class="{ active: isActive('/teacher') }">
            <span class="item-icon">📝</span>
            <span class="item-label">과제 관리</span>
          </button>
          <button @click="showGuideModal = true" class="sidebar-nav-item">
            <span class="item-icon">⚡</span>
            <span class="item-label">분석 모드 안내</span>
          </button>
        </template>

        <!-- Student-specific links -->
        <template v-else>
          <button @click="router.push('/student?filter=IN_PROGRESS')" class="sidebar-nav-item" :class="{ active: route.query.filter === 'IN_PROGRESS' }">
            <span class="item-icon">✏️</span>
            <span class="item-label">진행 중인 과제</span>
          </button>
          <button @click="router.push('/student?filter=SUBMITTED')" class="sidebar-nav-item" :class="{ active: route.query.filter === 'SUBMITTED' }">
            <span class="item-icon">📁</span>
            <span class="item-label">제출 완료 목록</span>
          </button>
          <button @click="router.push('/student')" class="sidebar-nav-item" :class="{ active: isActive('/student') && !route.query.filter }">
            <span class="item-icon">📋</span>
            <span class="item-label">전체 과제 목록</span>
          </button>
        </template>

        <!-- Analysis link (always visible, muted when not active) -->
        <button 
          @click="route.name === 'analysis' ? null : router.push('/student')"
          class="sidebar-nav-item"
          :class="{ active: route.name === 'analysis', 'opacity-40 cursor-default': route.name !== 'analysis' }"
        >
          <span class="item-icon">🔍</span>
          <span class="item-label">분석 리포트</span>
        </button>

        <div class="sidebar-divider"></div>

        <!-- Extra Useful Links -->
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
        <button @click="isSidebarOpen = !isSidebarOpen" class="mobile-menu-btn">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
        <span class="mobile-logo-text">Flagia</span>
        <div class="mobile-avatar">{{ user?.name?.charAt(0) || '?' }}</div>
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
      <div class="modal-card max-w-xl w-full p-6 bg-white rounded-xl shadow-2xl relative">
        <button @click="showGuideModal = false" class="modal-close-btn">&times;</button>
        <h3 class="text-lg font-bold text-text-primary mb-4">📖 Flagia 이용 가이드</h3>
        
        <div class="space-y-4 text-sm text-text-secondary overflow-y-auto max-h-[60vh] pr-2">
          <section>
            <h4 class="font-semibold text-text-primary mb-1">🔍 실시간 필기 흐름 추적 (IKI)</h4>
            <p class="leading-relaxed">
              Flagia는 학생의 키 스트로크 입력을 밀리초(ms) 단위로 분석합니다. 비정상적으로 일정한 타이핑 간격(IKI) 또는 붙여넣기를 감지하여 대필 및 인공지능 생성물 여부를 식별합니다.
            </p>
          </section>

          <section>
            <h4 class="font-semibold text-text-primary mb-1">🛡 분석 모드 구분</h4>
            <ul class="list-disc pl-5 space-y-1">
              <li><strong>STRICT (시험 모드)</strong>: 브라우저 탭 이탈이나 글 붙여넣기를 전면 차단하며 엄격하게 통제합니다.</li>
              <li><strong>STANDARD (일반 과제)</strong>: 일반 보고서용 권장 모드로, 자연스러운 수정 활동과 표절을 대조합니다.</li>
              <li><strong>RESEARCH (조사 모드)</strong>: 외부 참고자료 복사 및 잦은 이탈을 허용하는 자유로운 과제 형태입니다.</li>
              <li><strong>CREATIVE (창작 모드)</strong>: 일정한 속도 점검을 느슨하게 하여 생각하며 작성하는 창작용 모드입니다.</li>
            </ul>
          </section>

          <section>
            <h4 class="font-semibold text-text-primary mb-1">✍️ 채점 및 점수 부여</h4>
            <p class="leading-relaxed">
              제출물 분석 화면에서 제출된 본문과 작성 리플레이 과정을 검토한 뒤 피드백과 점수를 입력하여 제출물을 채점할 수 있습니다.
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
      <div class="modal-card max-w-md w-full p-6 bg-white rounded-xl shadow-2xl relative">
        <button @click="showSettingsModal = false" class="modal-close-btn">&times;</button>
        <h3 class="text-lg font-bold text-text-primary mb-4">⚙️ 시스템 설정</h3>
        
        <div class="space-y-4 text-sm text-text-secondary">
          <div class="flex items-center justify-between">
            <div>
              <span class="block font-semibold text-text-primary">기본 최대 배점</span>
              <span class="text-xs text-text-muted">새 과제를 생성할 때 지정할 기본 배점</span>
            </div>
            <select v-model="gradingScale" class="form-input w-24">
              <option value="10">10점 만점</option>
              <option value="100">100점 만점</option>
              <option value="4.5">4.5 학점</option>
            </select>
          </div>

          <div class="flex items-center justify-between">
            <div>
              <span class="block font-semibold text-text-primary">자동 AI 부정행위 플래그</span>
              <span class="text-xs text-text-muted">비정상 타이핑 감지 시 빨간색 경고 표시</span>
            </div>
            <input type="checkbox" v-model="autoGrade" class="w-4 h-4 rounded text-primary focus:ring-primary" />
          </div>

          <div class="flex items-center justify-between">
            <div>
              <span class="block font-semibold text-text-primary">알림 메일 발송</span>
              <span class="text-xs text-text-muted">과제 제출 및 채점 완료 시 이메일 알림</span>
            </div>
            <input type="checkbox" v-model="emailNotify" class="w-4 h-4 rounded text-primary focus:ring-primary" />
          </div>
        </div>
        
        <div class="mt-6 flex justify-end">
          <button @click="showSettingsModal = false" class="btn btn-primary">저장 완료</button>
        </div>
      </div>
    </div>

  </div>
</template>

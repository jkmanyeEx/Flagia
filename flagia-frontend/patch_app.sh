cat << 'INNER_EOF' > src/App.vue
<script setup lang="ts">
import { computed, onErrorCaptured, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from './composables/useAuth'

const router = useRouter()
const route = useRoute()
const { user, isLoggedIn, isTeacher, logout: doLogout } = useAuth()

// ── Layout logic ──
const publicPages = ['landing', 'login', 'register']
const isPublicPage = computed(() => publicPages.includes(route.name as string))
const isEditorView = computed(() => route.name === 'editor')

// ── Error boundary to prevent white-out ──
const renderError = ref<string | null>(null)
onErrorCaptured((err) => {
  console.error('Component render error caught:', err)
  renderError.value = err instanceof Error ? err.message : '렌더링 오류가 발생했습니다'
  return false // prevent propagation
})

// Reset error on route change
watch(() => route.fullPath, () => {
  renderError.value = null
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

  <!-- ─── AUTHENTICATED LAYOUT (Top Navbar + Content) ─── -->
  <div v-else class="app-layout flex-col">
    
    <!-- Top Navbar -->
    <nav class="app-top-nav">
      <div class="nav-container">
        <div class="nav-left">
          <div class="nav-logo" @click="goHome">
            <div class="nav-logo-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                <line x1="4" y1="22" x2="4" y2="15"/>
              </svg>
            </div>
            <span class="nav-logo-text">Flagia</span>
          </div>
          <div class="nav-links">
            <button @click="goHome" class="nav-link" :class="{ active: isActive('/teacher') || isActive('/student') || route.name === 'dashboard' }">
              대시보드
            </button>
            <button v-if="route.name === 'analysis'" class="nav-link active">
              분석 리포트
            </button>
          </div>
        </div>
        <div class="nav-right">
          <div class="nav-user">
            <div class="nav-avatar">{{ user?.name?.charAt(0) || '?' }}</div>
            <div class="nav-user-info hidden sm:block">
              <span class="nav-user-name">{{ user?.name }}</span>
              <span class="nav-user-role">{{ user?.role === 'TEACHER' ? '교사' : '학생' }}</span>
            </div>
          </div>
          <button @click="handleLogout" class="btn btn-outline btn-sm">로그아웃</button>
        </div>
      </div>
    </nav>

    <!-- Main content -->
    <main class="app-content bg-background">
      <!-- Error boundary fallback -->
      <div v-if="renderError" class="error-fallback">
        <div class="error-fallback-inner">
          <div class="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center mb-4">
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
</template>
INNER_EOF

<script setup lang="ts">
import { computed, onErrorCaptured, ref, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuth } from './composables/useAuth'
import { usePreferences, type AppLocale, type AppTheme } from './composables/usePreferences'

const router = useRouter()
const route = useRoute()
const { user, isLoggedIn, logout: doLogout } = useAuth()
const { t } = useI18n()
const { theme, locale, setTheme, setLocale } = usePreferences()

// ── Layout logic ──
const publicPages = ['landing', 'login', 'register']
const isPublicPage = computed(() => publicPages.includes(route.name as string))
const isEditorView = computed(() => route.name === 'editor')

// ── Modals and Mobile Sidebar ──
const isSidebarOpen = ref(false)
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
  renderError.value = err instanceof Error ? err.message : t('errors.renderFallback')
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
// highlighting at once (for example, two navigation destinations on /teacher).
const activeNav = computed(() => {
  const n = route.name as string
  if (n === 'analysis') return 'analysis'
  if (n === 'classrooms' || n === 'classroom-detail') return 'classrooms'
  if (n === 'teacher') return 'teacher-dash'
  if (n === 'student-home') {
    return 'student-all'
  }
  // /dashboard redirects by role; reflect where it lands.
  if (n === 'dashboard') return user.value?.role === 'STUDENT' ? 'student-all' : 'teacher-dash'
  return ''
})

const roleLabel = computed(() => t(
  user.value?.role === 'TEACHER' ? 'nav.teacherAccount'
    : user.value?.role === 'ADMIN' ? 'nav.adminAccount'
      : 'nav.studentAccount',
))

const roleName = computed(() => t(
  user.value?.role === 'TEACHER' ? 'common.teacher'
    : user.value?.role === 'ADMIN' ? 'common.admin'
      : 'common.student',
))
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
          <span class="sidebar-user-role">{{ roleLabel }}</span>
        </div>
      </div>

      <!-- Navigation links -->
      <div class="sidebar-nav">
        <!-- Classrooms (both roles) -->
        <button @click="router.push('/classrooms')" class="sidebar-nav-item" :class="{ active: activeNav === 'classrooms' }">
          <span class="item-icon">🏫</span>
          <span class="item-label">{{ t('nav.classrooms') }}</span>
        </button>

        <!-- Teacher / Admin: assignment management -->
        <button v-if="user?.role === 'TEACHER' || user?.role === 'ADMIN'" @click="router.push('/teacher')" class="sidebar-nav-item" :class="{ active: activeNav === 'teacher-dash' }">
          <span class="item-icon">📝</span>
          <span class="item-label">{{ t('nav.assignmentManagement') }}</span>
        </button>

        <!-- Student / Admin: student-side assignment views -->
        <template v-if="user?.role === 'STUDENT' || user?.role === 'ADMIN'">
          <button @click="router.push('/student')" class="sidebar-nav-item" :class="{ active: activeNav === 'student-all' }">
            <span class="item-icon">📋</span>
            <span class="item-label">{{ t(user?.role === 'ADMIN' ? 'nav.studentAssignments' : 'nav.assignments') }}</span>
          </button>
        </template>

        <div class="sidebar-divider"></div>

        <button @click="showSettingsModal = true" class="sidebar-nav-item">
          <span class="item-icon">⚙️</span>
          <span class="item-label">{{ t('nav.settings') }}</span>
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
          <span>{{ t('nav.logout') }}</span>
        </button>
      </div>
    </aside>

    <!-- Main Body Area -->
    <div class="app-body-wrapper">

      <button
        v-if="!isSidebarOpen"
        class="mobile-menu-trigger md:hidden"
        type="button"
        :aria-label="t('nav.openMenu')"
        @click="isSidebarOpen = true"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <path d="M4 7h16M4 12h16M4 17h16"/>
        </svg>
      </button>

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
            <h3 class="text-lg font-semibold text-text-primary mb-2">{{ t('errors.renderTitle') }}</h3>
            <p class="text-sm text-text-secondary mb-4">{{ renderError }}</p>
            <button @click="renderError = null; router.push('/dashboard')" class="btn btn-primary">
              {{ t('common.dashboard') }}
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

    <!-- ─── Settings Modal ─── -->
    <div v-if="showSettingsModal" class="modal-overlay" @click.self="showSettingsModal = false">
      <div class="modal-content max-w-md mx-4 p-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold text-text-primary">{{ t('settings.title') }}</h3>
          <button @click="showSettingsModal = false" class="btn btn-ghost btn-xs">✕</button>
        </div>

        <div class="space-y-5 text-sm text-text-secondary">
          <!-- Account info (real data) -->
          <section>
            <h4 class="settings-section-label">{{ t('settings.account') }}</h4>
            <div class="bg-background rounded-lg p-3 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-text-muted">{{ t('common.name') }}</span>
                <span class="font-semibold text-text-primary">{{ user?.name }}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-text-muted">{{ t('common.email') }}</span>
                <span class="font-mono text-text-primary">{{ user?.email }}</span>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-text-muted">{{ t('common.role') }}</span>
                <span class="badge" :class="user?.role === 'STUDENT' ? 'badge-amber' : 'badge-green'">
                  {{ roleName }}
                </span>
              </div>
            </div>
          </section>

          <section>
            <h4 class="settings-section-label">{{ t('settings.preferences') }}</h4>
            <div class="settings-preferences">
              <div class="settings-row">
                <span class="settings-row-label">{{ t('settings.theme') }}</span>
                <div class="settings-segment" role="group" :aria-label="t('settings.theme')">
                  <button
                    v-for="option in (['light', 'dark'] as AppTheme[])"
                    :key="option"
                    type="button"
                    :class="{ active: theme === option }"
                    @click="setTheme(option)"
                  >
                    {{ t(`settings.${option}`) }}
                  </button>
                </div>
              </div>
              <div class="settings-row">
                <span class="settings-row-label">{{ t('settings.language') }}</span>
                <div class="settings-segment" role="group" :aria-label="t('settings.language')">
                  <button
                    v-for="option in (['ko', 'en'] as AppLocale[])"
                    :key="option"
                    type="button"
                    :class="{ active: locale === option }"
                    @click="setLocale(option)"
                  >
                    {{ t(option === 'ko' ? 'settings.korean' : 'settings.english') }}
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div class="mt-6 flex justify-end">
          <button @click="showSettingsModal = false" class="btn btn-primary">{{ t('common.close') }}</button>
        </div>
      </div>
    </div>

  </div>
</template>

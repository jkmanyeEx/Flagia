import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import './style.css'

import { useAuth } from './composables/useAuth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // ── Public routes ──
    { path: '/', name: 'landing', component: () => import('./views/LandingPage.vue'), meta: { public: true } },
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
    { path: '/register', name: 'register', component: () => import('./views/LoginView.vue'), meta: { public: true } },

    // ── Protected routes ──
    { path: '/dashboard', name: 'dashboard', component: () => import('./views/DashboardRouter.vue') },
    { path: '/teacher', name: 'teacher', component: () => import('./views/TeacherDashboard.vue') },
    { path: '/student', name: 'student-home', component: () => import('./views/StudentHome.vue') },
    { path: '/editor/:assignmentId', name: 'editor', component: () => import('./views/StudentEditor.vue') },
    { path: '/analysis/:submissionId', name: 'analysis', component: () => import('./views/SubmissionAnalysis.vue') },
    { path: '/join/:code', name: 'join', component: () => import('./views/JoinAssignment.vue') },

    // Catch-all
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

// Auth guard
router.beforeEach(async (to) => {
  const { isLoggedIn, ready, validateToken, user } = useAuth()

  // Validate token on first navigation
  if (!ready.value) {
    await validateToken()
  }

  const isPublic = to.meta.public === true

  // Not logged in → redirect to login (unless public route)
  if (!isPublic && !isLoggedIn.value) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  // Logged in on login/register → redirect to dashboard
  if ((to.name === 'login' || to.name === 'register') && isLoggedIn.value) {
    return { name: 'dashboard' }
  }

  // Logged in on landing → redirect to dashboard
  if (to.name === 'landing' && isLoggedIn.value) {
    return { name: 'dashboard' }
  }

  // Teacher-only route guard
  if (to.name === 'teacher' && user.value?.role !== 'TEACHER') {
    return { name: 'student-home' }
  }
})

const app = createApp(App)
app.use(router)
app.mount('#app')

/**
 * Centralized reactive auth state for Flagia.
 * All views should use this instead of raw localStorage access.
 */
import { ref, computed, readonly } from 'vue'
import { api } from './useApi'

export interface FlagiaUser {
  id: string
  name: string
  email: string
  role: 'TEACHER' | 'STUDENT' | 'ADMIN'
}

// ── Singleton reactive state ──
const user = ref<FlagiaUser | null>(null)
const token = ref<string | null>(localStorage.getItem('flagia_token'))
const ready = ref(false) // true once initial validation completes

// ── Computed ──
const isLoggedIn = computed(() => !!token.value && !!user.value)
const isTeacher = computed(() => user.value?.role === 'TEACHER')
const isStudent = computed(() => user.value?.role === 'STUDENT')
const isAdmin = computed(() => user.value?.role === 'ADMIN')

// ── Hydrate user from localStorage cache (fast, non-blocking) ──
function hydrateFromCache() {
  const cached = localStorage.getItem('flagia_user')
  if (cached) {
    try {
      user.value = JSON.parse(cached)
    } catch {
      localStorage.removeItem('flagia_user')
    }
  }
}

// ── Token validation against server ──
async function validateToken(): Promise<boolean> {
  if (!token.value) {
    clearAuth()
    ready.value = true
    return false
  }

  try {
    const data = await api('/api/auth/me', { token: token.value })
    user.value = data.user
    localStorage.setItem('flagia_user', JSON.stringify(data.user))
    ready.value = true
    return true
  } catch {
    clearAuth()
    ready.value = true
    return false
  }
}

// ── Login ──
async function login(email: string, password: string) {
  const data = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  })
  token.value = data.token
  user.value = data.user
  localStorage.setItem('flagia_token', data.token)
  localStorage.setItem('flagia_user', JSON.stringify(data.user))
  return data
}

// ── Register ──
async function register(name: string, email: string, password: string, role: string) {
  const data = await api('/api/auth/register', {
    method: 'POST',
    body: { name, email, password, role },
  })
  token.value = data.token
  user.value = data.user
  localStorage.setItem('flagia_token', data.token)
  localStorage.setItem('flagia_user', JSON.stringify(data.user))
  return data
}

// ── Logout ──
function logout() {
  clearAuth()
}

// ── Clear ──
function clearAuth() {
  token.value = null
  user.value = null
  localStorage.removeItem('flagia_token')
  localStorage.removeItem('flagia_user')
}

// Hydrate immediately on import
hydrateFromCache()

export function useAuth() {
  return {
    user: readonly(user),
    token: readonly(token),
    ready: readonly(ready),
    isLoggedIn,
    isTeacher,
    isStudent,
    isAdmin,
    login,
    register,
    logout,
    validateToken,
  }
}

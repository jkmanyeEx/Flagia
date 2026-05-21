<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const route = useRoute()
const { login, register: doRegister, isLoggedIn } = useAuth()

// Determine mode from route
const isLogin = ref(route.name !== 'register')
const name = ref('')
const email = ref('')
const password = ref('')
const role = ref<'STUDENT' | 'TEACHER' | 'ADMIN'>('STUDENT')
const loading = ref(false)
const error = ref('')

// If already logged in, redirect away
onMounted(() => {
  if (isLoggedIn.value) {
    router.replace('/dashboard')
  }
})

async function submit() {
  loading.value = true
  error.value = ''
  try {
    if (isLogin.value) {
      await login(email.value, password.value)
    } else {
      await doRegister(name.value, email.value, password.value, role.value)
    }
    // Redirect to where they came from or dashboard
    const redirect = route.query.redirect as string
    router.push(redirect || '/dashboard')
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function toggleMode() {
  isLogin.value = !isLogin.value
  error.value = ''
}
</script>

<template>
  <div class="min-h-screen flex">
    <!-- Left: Hero Panel -->
    <div class="hidden lg:flex lg:flex-1 hero-gradient relative overflow-hidden">
      <div class="absolute inset-0" style="background: url('data:image/svg+xml,%3Csvg width=&quot;40&quot; height=&quot;40&quot; viewBox=&quot;0 0 40 40&quot; xmlns=&quot;http://www.w3.org/2000/svg&quot;%3E%3Cg fill=&quot;%23ffffff&quot; fill-opacity=&quot;0.05&quot;%3E%3Cpath d=&quot;M20 0L40 20L20 40L0 20z&quot;/%3E%3C/g%3E%3C/svg%3E');"></div>
      
      <div class="relative z-10 flex flex-col justify-between p-12 text-white">
        <!-- Logo -->
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center">
            <img src="/logo.jpg" alt="Flagia" class="w-full h-full object-cover" />
          </div>
          <span class="text-2xl font-bold tracking-tight">Flagia</span>
        </div>

        <!-- Main Copy -->
        <div class="my-auto max-w-lg">
          <h1 class="text-4xl font-extrabold leading-tight mb-6">
            과정 중심<br/>
            정직한 글쓰기<br/>
            증명 플랫폼
          </h1>
          <p class="text-lg text-white/70 leading-relaxed mb-8">
            키스트로크 다이나믹스 분석을 통해 학생의 글쓰기 과정을 투명하게 검증합니다. AI 시대에 진정한 학술 무결성을 지키세요.
          </p>

          <!-- Feature badges -->
          <div class="flex flex-wrap gap-3">
            <div class="flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2 text-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              실시간 텔레메트리
            </div>
            <div class="flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2 text-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
              마크다운 에디터
            </div>
            <div class="flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2 text-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              행동 분석 엔진
            </div>
          </div>
        </div>

        <!-- Footer -->
        <p class="text-sm text-white/40">© 2026 Flagia · Academic Writing Integrity</p>
      </div>
    </div>

    <!-- Right: Auth Form -->
    <div class="flex-1 flex items-center justify-center p-6 bg-background">
      <div class="w-full max-w-md">
        <!-- Mobile logo -->
        <div class="lg:hidden flex items-center gap-2.5 mb-8 justify-center">
          <div class="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center">
            <img src="/logo.jpg" alt="Flagia" class="w-full h-full object-cover" />
          </div>
          <span class="text-xl font-bold tracking-tight">Flagia</span>
        </div>

        <div class="card p-8">
          <!-- Tabs -->
          <div class="flex mb-6 bg-background rounded-lg p-1">
            <button
              @click="isLogin = true; error = ''"
              class="flex-1 py-2 text-sm font-medium rounded-md transition-all"
              :class="isLogin ? 'bg-white shadow-sm text-text-primary' : 'text-text-secondary'"
            >로그인</button>
            <button
              @click="isLogin = false; error = ''"
              class="flex-1 py-2 text-sm font-medium rounded-md transition-all"
              :class="!isLogin ? 'bg-white shadow-sm text-text-primary' : 'text-text-secondary'"
            >회원가입</button>
          </div>

          <form @submit.prevent="submit" class="flex flex-col gap-4">
            <!-- Name (register only) -->
            <div v-if="!isLogin">
              <label class="label">이름</label>
              <input v-model="name" type="text" class="input" placeholder="홍길동" required />
            </div>

            <div>
              <label class="label">이메일</label>
              <input v-model="email" type="email" class="input" placeholder="email@school.edu" required />
            </div>

            <div>
              <label class="label">비밀번호</label>
              <input v-model="password" type="password" class="input" placeholder="••••••••" required minlength="4" />
            </div>

            <!-- Role (register only) -->
            <div v-if="!isLogin">
              <label class="label">역할</label>
              <div class="grid grid-cols-3 gap-2">
                <button type="button"
                  @click="role = 'STUDENT'"
                  class="mode-option text-center text-sm"
                  :class="{ selected: role === 'STUDENT' }">
                  <div class="text-lg mb-0.5">🎓</div>
                  학생
                </button>
                <button type="button"
                  @click="role = 'TEACHER'"
                  class="mode-option text-center text-sm"
                  :class="{ selected: role === 'TEACHER' }">
                  <div class="text-lg mb-0.5">📋</div>
                  교사
                </button>
                <button type="button"
                  @click="role = 'ADMIN'"
                  class="mode-option text-center text-sm"
                  :class="{ selected: role === 'ADMIN' }">
                  <div class="text-lg mb-0.5">🛡️</div>
                  관리자
                </button>
              </div>
              <p v-if="role === 'ADMIN'" class="text-xs text-text-muted mt-1.5 leading-relaxed">
                관리자는 모든 과제와 학급을 열람할 수 있으며, 본인이 만들었거나 참여한 항목만 관리할 수 있습니다.
              </p>
            </div>

            <!-- Error -->
            <div v-if="error" class="text-sm text-danger bg-flag-red-bg px-3 py-2 rounded-lg">
              {{ error }}
            </div>

            <button type="submit" class="btn btn-primary w-full py-3 mt-1" :disabled="loading">
              <svg v-if="loading" class="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              {{ isLogin ? '로그인' : '가입하기' }}
            </button>
          </form>

          <p class="text-center text-sm text-text-secondary mt-5">
            {{ isLogin ? '계정이 없으신가요?' : '이미 계정이 있으신가요?' }}
            <button @click="toggleMode" class="text-primary font-medium ml-1 hover:underline">
              {{ isLogin ? '회원가입' : '로그인' }}
            </button>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

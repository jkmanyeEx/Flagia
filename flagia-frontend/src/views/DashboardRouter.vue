<script setup lang="ts">
/**
 * DashboardRouter: Redirects to the correct dashboard based on user role.
 */
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuth } from '../composables/useAuth'

const router = useRouter()
const { user, isLoggedIn } = useAuth()

onMounted(() => {
  if (!isLoggedIn.value) {
    router.replace('/login')
    return
  }
  if (user.value?.role === 'TEACHER') {
    router.replace('/teacher')
  } else {
    router.replace('/student')
  }
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center">
    <div class="animate-pulse text-text-secondary">로딩 중...</div>
  </div>
</template>

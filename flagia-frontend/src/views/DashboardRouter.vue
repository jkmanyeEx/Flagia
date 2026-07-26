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
  // Teachers and admins land on the assignment-management dashboard; students
  // on their assignment list.
  if (user.value?.role === 'TEACHER' || user.value?.role === 'ADMIN') {
    router.replace('/teacher')
  } else {
    router.replace('/student')
  }
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center">
    <div class="animate-pulse text-text-secondary">{{ $t('auto.m_06e61b86cbda') }}</div>
  </div>
</template>

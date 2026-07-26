<script setup lang="ts">
/**
 * JoinAssignment: Handles invite code joining from URL.
 * URL format: /join/:code
 */
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuth } from '../composables/useAuth'
import { api } from '../composables/useApi'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { user, token, isLoggedIn } = useAuth()

const status = ref<'loading' | 'error' | 'success'>('loading')
const errorMsg = ref('')

onMounted(async () => {
  if (!isLoggedIn.value) return

  const code = route.params.code as string
  if (!code) {
    errorMsg.value = t('runtime.m_936e6395c842')
    status.value = 'error'
    return
  }

  try {
    const data = await api(`/api/assignments/join/${code}`, {
      method: 'POST',
      token: token.value!,
    })
    status.value = 'success'
    // Redirect to editor
    router.replace(`/editor/${data.assignmentId}`)
  } catch (err: any) {
    errorMsg.value = err.message || t('runtime.m_ec4efd661fab')
    status.value = 'error'
  }
})
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-surface-dim">
    <div v-if="status === 'loading'" class="text-center">
      <div class="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4 animate-pulse">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-primary">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
          <polyline points="10 17 15 12 10 7"/>
          <line x1="15" y1="12" x2="3" y2="12"/>
        </svg>
      </div>
      <p class="text-text-secondary">{{ $t('auto.m_dc832aa787c9') }}</p>
    </div>

    <div v-else-if="status === 'error'" class="text-center max-w-sm">
      <div class="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center mx-auto mb-4">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-red-500">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
      </div>
      <p class="text-text-primary font-semibold mb-2">{{ $t('auto.m_574bd71a8c49') }}</p>
      <p class="text-text-secondary text-sm mb-6">{{ errorMsg }}</p>
      <button @click="router.push('/dashboard')" class="btn btn-primary">{{ $t('auto.m_4c0f6d2b714f') }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

interface Result {
  status: 'pending' | 'evaluated' | 'unevaluated'
  stage?: string
  reason?: string
  level?: string
  validation?: string
  previousScore: number
  deduction: number
  appliedDeduction: number
  featureScore?: number
  contextScore?: number
  calibrationHumanCount?: number
  modelVersion?: string
  evidence?: { feature: string; value: number; contribution: number }[]
  revisions?: {
    status: string; surfaceEdits: number; rewordings: number; meaningEdits: number; unknownEdits: number; coverage?: string
    examples: { kind: string; before: string; after: string }[]
  }
}
const props = defineProps<{ result: Result; finalScore: number; retrying?: boolean }>()
defineEmits<{ retry: [] }>()
const { t, te } = useI18n()
const stages = ['queued', 'loading', 'features', 'context', 'revisions']
const progress = computed(() => Math.max(1, stages.indexOf(props.result.stage || 'queued') + 1) / stages.length * 100)
const retryable = computed(() => props.result.status === 'unevaluated' &&
  ['inference_failed', 'model_unavailable', 'worker_exited', 'worker_stopped', 'timeout', 'busy', 'invalid_worker_result', 'model_changed'].includes(props.result.reason || ''))
function featureLabel(key: string) {
  return te(`linguistic.features.${key}`) ? t(`linguistic.features.${key}`) : key
}
function reasonLabel(key?: string) {
  return key && te(`linguistic.reasons.${key}`) ? t(`linguistic.reasons.${key}`) : t('linguistic.reasons.inference_failed')
}
</script>

<template>
  <section class="card p-5 sm:p-6 overflow-hidden" aria-labelledby="linguistic-heading">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-xs font-semibold text-primary tracking-wide mb-1">{{ t('linguistic.eyebrow') }}</p>
        <h2 id="linguistic-heading" class="text-lg font-bold text-text-primary">{{ t('linguistic.title') }}</h2>
        <p class="text-xs text-text-secondary mt-1">{{ t('linguistic.scope') }}</p>
      </div>
      <span class="text-xs font-semibold rounded-full px-3 py-1.5"
        :class="result.status === 'pending' ? 'bg-primary/10 text-primary' : result.status === 'unevaluated' ? 'bg-background text-text-secondary' : result.deduction ? 'bg-flag-amber-bg text-flag-amber' : 'bg-background text-text-primary'">
        {{ t(`linguistic.status.${result.status}`) }}
      </span>
    </div>

    <div v-if="result.status === 'pending'" class="mt-5" role="status" aria-live="polite">
      <div class="flex items-center justify-between text-sm text-text-secondary gap-3">
        <span>{{ t(`linguistic.stages.${result.stage || 'queued'}`) }}</span>
        <span class="text-xs">{{ t('linguistic.pendingScore') }}</span>
      </div>
      <div class="h-1.5 bg-primary/10 rounded-full mt-3 overflow-hidden">
        <div class="h-full rounded-full bg-primary transition-all duration-300" :style="{ width: `${progress}%` }"></div>
      </div>
    </div>

    <div v-else-if="result.status === 'unevaluated'" class="mt-4 rounded-xl border border-border p-4">
      <p class="text-sm text-text-primary">{{ reasonLabel(result.reason) }}</p>
      <p class="text-xs text-text-secondary mt-1">{{ t('linguistic.unevaluatedDetail') }}</p>
      <button v-if="retryable" class="btn btn-outline btn-sm mt-3" :disabled="retrying" @click="$emit('retry')">
        {{ t(retrying ? 'linguistic.retrying' : 'linguistic.retry') }}
      </button>
    </div>

    <template v-else>
      <div class="grid grid-cols-3 gap-2 sm:gap-4 mt-5 rounded-xl bg-background border border-border p-4">
        <div><p class="text-xs text-text-muted">{{ t('linguistic.previousScore') }}</p>
          <p class="text-xl sm:text-2xl font-bold mt-1 tabular-nums text-text-primary">{{ result.previousScore.toFixed(1) }}</p></div>
        <div><p class="text-xs text-text-muted">{{ t('linguistic.deduction') }}</p>
          <p class="text-xl sm:text-2xl font-bold mt-1 tabular-nums" :class="result.appliedDeduction ? 'text-flag-red' : 'text-text-primary'">−{{ result.appliedDeduction.toFixed(1) }}</p></div>
        <div><p class="text-xs text-text-muted">{{ t('linguistic.finalScore') }}</p>
          <p class="text-xl sm:text-2xl font-bold mt-1 tabular-nums text-text-primary">{{ finalScore.toFixed(1) }}</p></div>
      </div>
      <p class="text-sm font-semibold text-text-primary mt-4">{{ t(`linguistic.levels.${result.level || 'none'}`) }}</p>
      <p class="text-xs text-text-secondary mt-1 leading-relaxed">{{ t('linguistic.interpretation') }}</p>
      <p v-if="result.deduction > result.appliedDeduction" class="text-xs text-text-secondary mt-1">{{ t('linguistic.floor', { points: result.deduction }) }}</p>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
        <div v-for="item in [{ key: 'featureModel', score: result.featureScore }, { key: 'contextModel', score: result.contextScore }]"
          :key="item.key" class="rounded-xl border border-border p-3.5 flex justify-between items-center gap-3">
          <span class="text-sm text-text-secondary">{{ t(`linguistic.${item.key}`) }}</span>
          <span class="font-mono text-sm text-text-primary">{{ item.score?.toFixed(3) ?? '—' }}</span>
        </div>
      </div>
      <p class="text-xs text-text-muted mt-2">{{ t('linguistic.notProbability') }}</p>

      <details v-if="result.evidence?.length" class="mt-4 border-t border-border pt-3">
        <summary class="cursor-pointer text-sm font-medium text-text-secondary">{{ t('linguistic.evidence') }}</summary>
        <div class="mt-3 space-y-2">
          <div v-for="item in result.evidence" :key="item.feature" class="flex justify-between gap-3 text-xs">
            <span class="text-text-secondary">{{ featureLabel(item.feature) }}</span>
            <span class="font-mono text-text-primary">{{ item.value.toFixed(3) }} <span class="text-text-muted">({{ item.contribution > 0 ? '+' : '' }}{{ item.contribution.toFixed(2) }})</span></span>
          </div>
        </div>
        <p class="text-xs text-text-muted mt-2 leading-relaxed">{{ t('linguistic.evidenceHelp') }}</p>
      </details>

      <div v-if="result.revisions" class="mt-4 border-t border-border pt-4">
        <h3 class="text-sm font-semibold text-text-primary">{{ t('linguistic.revisionsTitle') }}</h3>
        <p v-if="result.revisions.status === 'unevaluated'" class="text-xs text-text-secondary mt-2">{{ t('linguistic.revisionsUnavailable') }}</p>
        <template v-else>
          <div class="flex flex-wrap gap-x-5 gap-y-2 text-xs text-text-secondary mt-2">
            <span>{{ t('linguistic.editKinds.surface') }} <strong class="text-text-primary">{{ result.revisions.surfaceEdits }}</strong></span>
            <span>{{ t('linguistic.editKinds.rewording') }} <strong class="text-text-primary">{{ result.revisions.rewordings }}</strong></span>
            <span>{{ t('linguistic.editKinds.meaning') }} <strong class="text-text-primary">{{ result.revisions.meaningEdits }}</strong></span>
            <span>{{ t('linguistic.editKinds.unknown') }} <strong class="text-text-primary">{{ result.revisions.unknownEdits }}</strong></span>
          </div>
          <details v-if="result.revisions.examples.length" class="mt-3">
            <summary class="text-xs text-text-secondary cursor-pointer">{{ t('linguistic.revisionExamples') }}</summary>
            <div v-for="(edit, i) in result.revisions.examples" :key="i" class="mt-3 rounded-lg bg-background border border-border p-3 text-xs leading-relaxed">
              <span class="font-semibold text-primary">{{ t(`linguistic.editKinds.${edit.kind}`) }}</span>
              <p class="text-text-muted mt-1 break-words">{{ t('linguistic.before') }}: {{ edit.before }}</p>
              <p class="text-text-primary mt-1 break-words">{{ t('linguistic.after') }}: {{ edit.after }}</p>
            </div>
          </details>
        </template>
        <p class="text-xs text-text-muted mt-2 leading-relaxed">{{ t('linguistic.revisionsHelp') }}</p>
        <p v-if="result.revisions.coverage === 'sampled'" class="text-xs text-text-muted mt-1">{{ t('linguistic.sampledHistory') }}</p>
      </div>
      <p v-if="result.validation !== 'validated'" class="text-xs text-text-secondary leading-relaxed mt-4 rounded-lg bg-flag-amber-bg p-3">
        {{ t('linguistic.provisional', { count: result.calibrationHumanCount ?? 0 }) }}
      </p>
    </template>
  </section>
</template>

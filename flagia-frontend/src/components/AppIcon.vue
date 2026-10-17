<script setup lang="ts">
import { iconPaths, type IconName } from './icons'

withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 20 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false" class="app-icon">
    <path :d="iconPaths[name]" />
  </svg>
</template>

<style scoped>
.app-icon { display: inline-block; flex-shrink: 0; vertical-align: -0.15em; }
</style>

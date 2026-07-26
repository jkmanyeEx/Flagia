import { computed, ref } from 'vue'
import { i18n, type AppLocale } from '../i18n'

export type { AppLocale } from '../i18n'
export type AppTheme = 'light' | 'dark'

function savedTheme(): AppTheme {
  return localStorage.getItem('flagia_theme') === 'dark' ? 'dark' : 'light'
}

const theme = ref<AppTheme>(savedTheme())
const locale = computed<AppLocale>({
  get: () => i18n.global.locale.value as AppLocale,
  set: value => {
    i18n.global.locale.value = value
  },
})

function applyTheme(value: AppTheme) {
  theme.value = value
  localStorage.setItem('flagia_theme', value)
  document.documentElement.dataset.theme = value
  document.documentElement.style.colorScheme = value
}

function applyLocale(value: AppLocale) {
  locale.value = value
  localStorage.setItem('flagia_locale', value)
  document.documentElement.lang = value
}

export function initializePreferences() {
  applyTheme(theme.value)
  applyLocale(locale.value)
}

export function usePreferences() {
  return {
    theme,
    locale,
    setTheme: applyTheme,
    setLocale: applyLocale,
  }
}

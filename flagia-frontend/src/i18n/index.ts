import { createI18n } from 'vue-i18n'
import ko from './locales/ko'
import en from './locales/en'

export type AppLocale = 'ko' | 'en'

export function storedLocale(): AppLocale {
  return localStorage.getItem('flagia_locale') === 'en' ? 'en' : 'ko'
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: storedLocale(),
  fallbackLocale: 'ko',
  messages: { ko, en },
})

export function translateError(code?: string, fallback?: string) {
  const keyByCode: Record<string, string> = {
    UNAUTHENTICATED: 'errors.unauthenticated',
    INVALID_TOKEN: 'errors.invalidToken',
    FORBIDDEN: 'errors.forbidden',
    NOT_FOUND: 'errors.notFound',
    INVALID_REQUEST: 'errors.invalidRequest',
    SERVER_ERROR: 'errors.server',
    REQUEST_FAILED: 'common.requestFailed',
    CONFLICT: 'errors.invalidRequest',
  }
  const key = code ? keyByCode[code] : undefined
  return key ? i18n.global.t(key) : (fallback || i18n.global.t('common.requestFailed'))
}

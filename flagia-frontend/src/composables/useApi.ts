import { API_BASE } from './apiHost'
import { i18n, translateError } from '../i18n'

export async function api(path: string, options: { method?: string; body?: any; token?: string } = {}) {
  const token = options.token || localStorage.getItem('flagia_token')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept-Language': i18n.global.locale.value,
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const data = await res.json()
  if (!res.ok) throw new Error(translateError(data.code, data.error))
  return data
}

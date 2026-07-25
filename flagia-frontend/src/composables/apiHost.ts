/**
 * Centralized API / WebSocket host resolution.
 *
 * Deployments:
 *   localhost (dev)      → Vite on :5173 proxies /api and /ws to backend :3000
 *   flagia.devmeko.xyz   → https://flagiaapi.devmeko.xyz
 *   flagia.kr            → https://api.flagia.kr           (tunneled, local :3000)
 *   other host / local IP → same host on :3000
 *
 * The "local" backend port differs per deployment, but a tunneled frontend
 * always reaches its backend through the mapped API host below, so the port
 * only matters for the raw-IP fallback (3000).
 */

const LOCAL_PORT = 3000

// Frontend hostname → tunneled API hostname (served over https / wss).
const API_HOST_MAP: Record<string, string> = {
  'flagia.devmeko.xyz': 'flagiaapi.devmeko.xyz',
  'flagia.kr': 'api.flagia.kr',
  'www.flagia.kr': 'api.flagia.kr',
}

/** Base URL for REST calls (empty string in dev → Vite proxy handles /api). */
export function resolveApiBase(): string {
  if (import.meta.env.DEV) return ''
  const host = window.location.hostname
  const apiHost = API_HOST_MAP[host]
  if (apiHost) return `https://${apiHost}`
  return `${window.location.protocol}//${host}:${LOCAL_PORT}`
}

/** Full WebSocket URL (e.g. wss://api.flagia.kr/ws). */
export function resolveWsUrl(): string {
  if (import.meta.env.DEV) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}/ws`
  }
  const host = window.location.hostname
  const apiHost = API_HOST_MAP[host]
  if (apiHost) return `wss://${apiHost}/ws`
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${host}:${LOCAL_PORT}/ws`
}

export const API_BASE = resolveApiBase()

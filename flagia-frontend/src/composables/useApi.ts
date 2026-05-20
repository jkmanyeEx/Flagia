function resolveApiBase(): string {
  // In dev mode, Vite proxy handles /api → :3502
  if (import.meta.env.DEV) return ''

  // In production, resolve based on current hostname
  const host = window.location.hostname
  if (host === 'flagia.devmeko.xyz') {
    return 'https://flagiaapi.devmeko.xyz'
  }
  else if (host === 'flagia.kr') {
    return 'https://api.flagia.kr'
  }
  // Local production (pm2 serve) — point to backend port
  return `${window.location.protocol}//${host}:3502`
}

const API_BASE = resolveApiBase()

export async function api(path: string, options: { method?: string; body?: any; token?: string } = {}) {
  const token = options.token || localStorage.getItem('flagia_token')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || '요청 실패')
  return data
}

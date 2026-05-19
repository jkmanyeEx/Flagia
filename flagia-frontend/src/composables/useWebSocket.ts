/**
 * WebSocket Composable
 * 
 * Manages WebSocket connection with:
 * - Auto-reconnect
 * - Session management
 * - Event batch transmission
 * - Kill-switch signal handling
 */

import { ref, onUnmounted } from 'vue'
import type { TelemetryEvent } from './useKeystrokeCapture'

export function useWebSocket() {
  const connected = ref(false)
  const sessionId = ref<string | null>(null)
  const serverTimeDiff = ref(0)

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let onForceClose: (() => void) | null = null
  let onSubmitRequired: (() => void) | null = null

  function connect(token: string) {
    if (ws && ws.readyState === WebSocket.OPEN) return

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    let wsHost = location.host
    if (import.meta.env.PROD) {
      const hostname = location.hostname
      wsHost = hostname === 'flagia.devmeko.xyz'
        ? 'flagiaapi.devmeko.xyz'
        : `${hostname}:3502`
    }
    ws = new WebSocket(`${protocol}//${wsHost}/ws`)

    ws.onopen = () => {
      connected.value = true
      // Authenticate
      ws!.send(JSON.stringify({ type: 'auth', payload: { token } }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'auth_ok':
            break
          case 'session_ready':
            sessionId.value = msg.payload.sessionId
            // Compute server time difference for timer sync
            serverTimeDiff.value = msg.payload.serverTime - Date.now()
            break
          case 'batch_ack':
            // Events received
            break
          case 'force_close':
            // Teacher kill-switch
            if (onForceClose) onForceClose()
            break
          case 'submit_required':
            if (onSubmitRequired) onSubmitRequired()
            break
          case 'error':
            console.error('WS error:', msg.payload.error)
            break
        }
      } catch (err) {
        console.error('WS parse error:', err)
      }
    }

    ws.onclose = () => {
      connected.value = false
      sessionId.value = null
      // Auto-reconnect after 3s
      reconnectTimer = setTimeout(() => connect(token), 3000)
    }

    ws.onerror = () => {
      connected.value = false
    }
  }

  function joinSession(submissionId: string, assignmentId: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({
      type: 'join_session',
      payload: { submissionId, assignmentId },
    }))
  }

  function sendEventBatch(events: TelemetryEvent[]) {
    if (!ws || ws.readyState !== WebSocket.OPEN || events.length === 0) return
    ws.send(JSON.stringify({
      type: 'event_batch',
      payload: { events },
    }))
  }

  function notifyTimerExpired() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'timer_expired', payload: {} }))
  }

  function setOnForceClose(fn: () => void) { onForceClose = fn }
  function setOnSubmitRequired(fn: () => void) { onSubmitRequired = fn }

  function disconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (ws) {
      ws.onclose = null // Prevent reconnect
      ws.close()
    }
    connected.value = false
  }

  onUnmounted(() => {
    disconnect()
  })

  return {
    connected,
    sessionId,
    serverTimeDiff,
    connect,
    joinSession,
    sendEventBatch,
    notifyTimerExpired,
    setOnForceClose,
    setOnSubmitRequired,
    disconnect,
  }
}

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { marked } from 'marked'
import { useAuth } from '../composables/useAuth'
import { api } from '../composables/useApi'

const route = useRoute()
const router = useRouter()
const { user, token } = useAuth()
// Teacher-style access (replay room, grading, "submissions" nav). Admins are
// treated as staff here so they get the same review tools as teachers.
const isStaff = computed(() => user.value?.role === 'TEACHER' || user.value?.role === 'ADMIN')

const loading = ref(true)
const error = ref('')
const data = ref<any>(null)
const events = ref<any[]>([])

// Replay State
const replayPlaying = ref(false)
const replayCurrentMs = ref(0)
const replaySpeed = ref(10)
const replayIntervalId = ref<any>(null)

onMounted(async () => {
  try {
    const [analysisData, eventsData] = await Promise.all([
      api(`/api/submissions/${route.params.submissionId}/analysis`, {
        token: token.value!,
      }),
      api(`/api/submissions/${route.params.submissionId}/events`, {
        token: token.value!,
      }).catch((err) => {
        console.error('Failed to load events:', err)
        return { events: [] }
      })
    ])
    data.value = analysisData
    events.value = eventsData.events || []
  } catch (e: any) {
    error.value = e.message || '분석 데이터를 불러올 수 없습니다'
  } finally {
    loading.value = false
  }
})

const submission = computed(() => data.value?.submission)
const analysis = computed(() => data.value?.analysis)

// Gauge calculations
const gaugeRadius = 65
const gaugeCircumference = computed(() => 2 * Math.PI * gaugeRadius)
function gaugeOffset(score: number) {
  return gaugeCircumference.value - (score / 100) * gaugeCircumference.value
}

function flagColor(status: string) {
  return { GREEN: '#16A34A', AMBER: '#D97706', RED: '#DC2626' }[status] || '#9CA3AF'
}
function flagLabel(status: string) {
  return { GREEN: '🟢 안전', AMBER: '🟡 주의', RED: '🔴 위험' }[status] || status
}
function flagBg(status: string) {
  return { GREEN: 'bg-flag-green-bg', AMBER: 'bg-flag-amber-bg', RED: 'bg-flag-red-bg' }[status] || ''
}

function componentIcon(key: string) {
  return {
    typingRhythm: '⌨️',
    revisionIntensity: '✏️',
    externalContent: '📋',
    focusDuration: '👁️',
    writingTime: '⏱️',
  }[key] || '📊'
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}초`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 ${Math.round(seconds % 60)}초`
  return `${Math.floor(seconds / 3600)}시간 ${Math.floor((seconds % 3600) / 60)}분`
}

function formatDate(d: string) {
  return new Date(d).toLocaleString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// Dynamic Timeline buckets recalculation
const bucketSizeSec = ref(30)

interface TelemetryEvent {
  seq: number;
  timestamp: number;
  iki: number;
  type: string;
  meta?: {
    key?: string;
    pasteLength?: number;
    cursorPosition?: number;
    [key: string]: any;
  };
}

interface TimelineBucket {
  startMs: number;
  endMs: number;
  keystrokeCount: number;
  avgIki: number;
  isBlurred: boolean;
  pasteCount: number;
}

function buildTimeline(eventsList: TelemetryEvent[], bucketSizeMs = 30000): TimelineBucket[] {
  if (!eventsList || eventsList.length === 0) return [];

  const timestamps = eventsList.map(e => e.timestamp).filter(t => t > 0);
  if (timestamps.length === 0) return [];

  const minT = Math.min(...timestamps);
  const maxT = Math.max(...timestamps);

  const buckets: TimelineBucket[] = [];
  let currentStart = minT;

  while (currentStart < maxT + bucketSizeMs) {
    const currentEnd = currentStart + bucketSizeMs;
    const bucketEvents = eventsList.filter(e => e.timestamp >= currentStart && e.timestamp < currentEnd);
    
    const keystrokes = bucketEvents.filter(e => e.type === 'keydown').length;
    const ikiValues = bucketEvents
      .filter(e => e.type === 'keydown' && e.iki > 0 && e.iki < 30000)
      .map(e => e.iki);
    const avgIki = ikiValues.length > 0 ? ikiValues.reduce((a, b) => a + b, 0) / ikiValues.length : 0;
    const isBlurred = bucketEvents.some(e => e.type === 'blur') && !bucketEvents.some(e => e.type === 'focus');
    const pasteCount = bucketEvents.filter(e => e.type === 'paste').length;

    buckets.push({
      startMs: currentStart - minT,
      endMs: currentEnd - minT,
      keystrokeCount: keystrokes,
      avgIki: Math.round(avgIki),
      isBlurred,
      pasteCount,
    });

    currentStart = currentEnd;
  }

  return buckets;
}

const timeline = computed(() => {
  if (!events.value || events.value.length === 0) {
    return analysis.value?.timeline || []
  }
  return buildTimeline(events.value, bucketSizeSec.value * 1000)
})

function getTimelineMaxKeystroke() {
  if (!timeline.value || timeline.value.length === 0) return 1
  return Math.max(1, ...timeline.value.map((b: any) => b.keystrokeCount))
}

function getTimelineBucketHeight(bucket: any) {
  const max = getTimelineMaxKeystroke()
  if (bucket.isBlurred || bucket.pasteCount > 0) {
    return 100
  }
  return Math.max(3, (bucket.keystrokeCount / max) * 100)
}

function getTimelineBucketColor(bucket: any) {
  if (bucket.isBlurred) return '#FDE68A'
  if (bucket.pasteCount > 0) return '#FCA5A5'
  if (bucket.keystrokeCount === 0) return '#E5E7EB'
  return '#818CF8'
}

// Replay Mechanics
const minTime = computed(() => {
  if (!events.value || events.value.length === 0) return 0
  const times = events.value.map(e => e.timestamp).filter(t => t > 0)
  return times.length > 0 ? Math.min(...times) : 0
})

const maxTime = computed(() => {
  if (!events.value || events.value.length === 0) return 0
  const times = events.value.map(e => e.timestamp).filter(t => t > 0)
  return times.length > 0 ? Math.max(...times) : 0
})

const replayTotalMs = computed(() => {
  return maxTime.value - minTime.value
})

function startReplay() {
  if (events.value.length === 0) return
  if (replayPlaying.value) return
  
  if (replayCurrentMs.value >= replayTotalMs.value) {
    replayCurrentMs.value = 0
  }
  
  replayPlaying.value = true
  const tickMs = 50
  
  replayIntervalId.value = setInterval(() => {
    replayCurrentMs.value += tickMs * replaySpeed.value
    if (replayCurrentMs.value >= replayTotalMs.value) {
      replayCurrentMs.value = replayTotalMs.value
      pauseReplay()
    }
  }, tickMs)
}

function pauseReplay() {
  replayPlaying.value = false
  if (replayIntervalId.value) {
    clearInterval(replayIntervalId.value)
    replayIntervalId.value = null
  }
}

function stopReplay() {
  pauseReplay()
  replayCurrentMs.value = 0
}

function setSpeed(s: number) {
  replaySpeed.value = s
  if (replayPlaying.value) {
    pauseReplay()
    startReplay()
  }
}

// ── Hangul IME automaton for replay ──
// Browser keydown events during Korean composition arrive as individual
// compatibility jamo (e.g. ㅎ ㅏ ㄴ for 한). We assemble them into syllables
// using the standard 2-set Hangul automaton.
const CHO_LIST  = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ']
const JUNG_LIST = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ']
const JONG_LIST = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ']
const COMPOUND_JUNG: Record<string, string> = {
  'ㅗㅏ':'ㅘ','ㅗㅐ':'ㅙ','ㅗㅣ':'ㅚ','ㅜㅓ':'ㅝ','ㅜㅔ':'ㅞ','ㅜㅣ':'ㅟ','ㅡㅣ':'ㅢ',
}
const DECOMPOSE_JUNG: Record<string, [string, string]> = {
  'ㅘ':['ㅗ','ㅏ'],'ㅙ':['ㅗ','ㅐ'],'ㅚ':['ㅗ','ㅣ'],'ㅝ':['ㅜ','ㅓ'],'ㅞ':['ㅜ','ㅔ'],'ㅟ':['ㅜ','ㅣ'],'ㅢ':['ㅡ','ㅣ'],
}
const COMPOUND_JONG: Record<string, string> = {
  'ㄱㅅ':'ㄳ','ㄴㅈ':'ㄵ','ㄴㅎ':'ㄶ','ㄹㄱ':'ㄺ','ㄹㅁ':'ㄻ','ㄹㅂ':'ㄼ','ㄹㅅ':'ㄽ','ㄹㅌ':'ㄾ','ㄹㅍ':'ㄿ','ㄹㅎ':'ㅀ','ㅂㅅ':'ㅄ',
}
const DECOMPOSE_JONG: Record<string, [string, string]> = {
  'ㄳ':['ㄱ','ㅅ'],'ㄵ':['ㄴ','ㅈ'],'ㄶ':['ㄴ','ㅎ'],'ㄺ':['ㄹ','ㄱ'],'ㄻ':['ㄹ','ㅁ'],'ㄼ':['ㄹ','ㅂ'],'ㄽ':['ㄹ','ㅅ'],'ㄾ':['ㄹ','ㅌ'],'ㄿ':['ㄹ','ㅍ'],'ㅀ':['ㄹ','ㅎ'],'ㅄ':['ㅂ','ㅅ'],
}
// Keys that are not typed text — never render them in the replay canvas.
const NON_CONTENT_KEYS = new Set([
  'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete',
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
  'ContextMenu', 'Pause', 'ScrollLock', 'NumLock', 'PrintScreen',
  'Process', 'Unidentified', 'Dead',
])
function isJamo(k: string) { return /^[ㄱ-ㆎ]$/.test(k) }
function isJung(k: string) { return JUNG_LIST.includes(k) }

// The student editor is pre-filled with the assignment's guideline template,
// so keystrokes begin after it. Seed the replay with that plain text so the
// reconstructed document isn't missing its opening section.
const templatePlain = computed(() =>
  (submission.value?.templateText || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
)
function composeSyllable(cho: string, jung: string, jong: string): string {
  const ci = CHO_LIST.indexOf(cho), ji = JUNG_LIST.indexOf(jung), gi = JONG_LIST.indexOf(jong)
  if (ci < 0 || ji < 0 || gi < 0) return (cho || '') + (jung || '') + (jong || '')
  return String.fromCharCode(0xAC00 + (ci * 21 + ji) * 28 + gi)
}

const hasValidCursorData = computed(() => {
  return events.value.some(e => e.type === 'keydown' && e.meta && typeof e.meta.cursorPosition === 'number' && e.meta.cursorPosition > 0)
})

const replayState = computed(() => {
  if (!events.value || events.value.length === 0) {
    return {
      text: '',
      keystrokeCount: 0,
      pasteCount: 0,
      blurCount: 0,
      currentWpm: 0,
      activeStatus: '대기 중',
      logs: [],
    }
  }

  const thresholdTime = minTime.value + replayCurrentMs.value
  let committed = templatePlain.value
  // Active composition buffer
  let cho = '', jung = '', jong = ''
  let compStartPos = committed.length
  const hasBuf = () => !!(cho || jung || jong)
  const renderBuf = () => hasBuf() ? composeSyllable(cho, jung, jong) : ''
  const flushBuf = () => {
    if (hasBuf()) {
      const bufText = renderBuf()
      committed = committed.slice(0, compStartPos) + bufText + committed.slice(compStartPos)
      compStartPos += bufText.length
    }
    cho = ''; jung = ''; jong = ''
  }
  let keystrokeCount = 0
  let pasteCount = 0
  let blurCount = 0
  let activeStatus = '작성 중'
  const logs: string[] = []

  for (const e of events.value) {
    if (e.timestamp > thresholdTime) break

    const relativeSec = Math.round((e.timestamp - minTime.value) / 1000)
    const timeStr = `${Math.floor(relativeSec / 60)}분 ${relativeSec % 60}초`

    const cursorPosition = hasValidCursorData.value && e.meta && typeof e.meta.cursorPosition === 'number'
      ? e.meta.cursorPosition
      : undefined

    const selectionLength = hasValidCursorData.value && e.meta && typeof e.meta.selectionLength === 'number'
      ? e.meta.selectionLength
      : 0

    const pos = (typeof cursorPosition === 'number') ? cursorPosition : committed.length

    if (e.type === 'keydown') {
      const key = e.meta?.key

      // Skip keyboard shortcuts (Ctrl/Cmd/Alt held) and control/navigation
      // keys so they don't leak into the reconstructed text.
      if (e.meta?.mod || (key && NON_CONTENT_KEYS.has(key))) {
        continue
      }

      // If the cursor jumped during an active composition, flush the buffer first
      if (hasBuf() && pos !== compStartPos && pos !== compStartPos + 1) {
        flushBuf()
      }

      keystrokeCount++

      // If selection exists, delete the range before applying the keystroke
      if (selectionLength > 0) {
        flushBuf()
        committed = committed.slice(0, pos) + committed.slice(pos + selectionLength)
      }

      if (key === 'Backspace') {
        if (selectionLength === 0) {
          // Delete one logical step from the composing buffer first,
          // then fall through to committed text.
          if (jong) {
            const d = DECOMPOSE_JONG[jong]
            jong = d ? d[0] : ''
          } else if (jung) {
            const d = DECOMPOSE_JUNG[jung]
            jung = d ? d[0] : ''
          } else if (cho) {
            cho = ''
          } else {
            if (pos > 0) {
              committed = committed.slice(0, pos - 1) + committed.slice(pos)
            }
          }
        }
      } else if (key === 'Enter') {
        flushBuf()
        committed = committed.slice(0, pos) + '\n' + committed.slice(pos)
      } else if (key && isJamo(key)) {
        if (!hasBuf()) {
          compStartPos = pos
        }
        if (isJung(key)) {
          // Vowel
          if (!cho) {
            // Standalone vowel — no IME initial. Commit raw.
            flushBuf()
            committed = committed.slice(0, compStartPos) + key + committed.slice(compStartPos)
            compStartPos += 1
          } else if (!jung) {
            jung = key
          } else if (!jong) {
            const cj = COMPOUND_JUNG[jung + key]
            if (cj) {
              jung = cj
            } else {
              flushBuf()
              compStartPos = pos
              committed = committed.slice(0, compStartPos) + key + committed.slice(compStartPos)
              compStartPos += 1
            }
          } else {
            // cho+jung+jong, new vowel → last jong (or its tail) becomes
            // the new syllable's cho, paired with this vowel.
            const dj = DECOMPOSE_JONG[jong]
            let newCho: string
            if (dj) {
              jong = dj[0]
              newCho = dj[1]
            } else {
              newCho = jong
              jong = ''
            }
            flushBuf()
            cho = newCho
            jung = key
          }
        } else {
          // Consonant
          if (!cho) {
            cho = key
          } else if (!jung) {
            // Two consonants without a vowel — commit the first, start new.
            flushBuf()
            cho = key
          } else if (!jong) {
            if (JONG_LIST.includes(key)) {
              jong = key
            } else {
              flushBuf()
              cho = key
            }
          } else {
            const cjong = COMPOUND_JONG[jong + key]
            if (cjong) {
              jong = cjong
            } else {
              flushBuf()
              cho = key
            }
          }
        }
      } else if (key && key.length === 1) {
        // Plain ASCII / printable character.
        flushBuf()
        committed = committed.slice(0, pos) + key + committed.slice(pos)
      }
      // Modifier / navigation keys: ignored (no buffer change).
    } else if (e.type === 'paste') {
      flushBuf()
      pasteCount++
      const len = e.meta?.pasteLength || 0
      const pastedText = e.meta?.pasteContent || `[📋 ${len}자]`
      
      // If selection exists, delete the range before pasting
      if (selectionLength > 0) {
        committed = committed.slice(0, pos) + committed.slice(pos + selectionLength)
      }
      
      committed = committed.slice(0, pos) + pastedText + committed.slice(pos)
      logs.push(`[${timeStr}] 📋 붙여넣기 실행 (${len}자)`)
    } else if (e.type === 'blur') {
      flushBuf()
      blurCount++
      activeStatus = '화면 이탈'
      logs.push(`[${timeStr}] ⚠️ 에디터를 벗어남`)
    } else if (e.type === 'focus') {
      activeStatus = '작성 중'
      logs.push(`[${timeStr}] ✏️ 에디터로 복귀`)
    }
  }

  const text = committed.slice(0, compStartPos) + renderBuf() + committed.slice(compStartPos)

  const windowStart = thresholdTime - 30000
  const recentEvents = events.value.filter(
    e => e.timestamp >= windowStart && e.timestamp <= thresholdTime && e.type === 'keydown'
  )
  const liveWpm = Math.round(recentEvents.length / 2.5)
  const recentLogs = logs.slice(-15).reverse()

  return {
    text,
    keystrokeCount,
    pasteCount,
    blurCount,
    currentWpm: liveWpm,
    activeStatus,
    logs: recentLogs,
  }
})

// Mini gauge for component cards
const miniR = 22
const miniC = computed(() => 2 * Math.PI * miniR)
function miniOffset(score: number) {
  return miniC.value - (score / 100) * miniC.value
}

// Active Tab & Custom Tooltips
const activeTab = ref<'report' | 'replay' | 'content'>('report')

// Grading states
const score = ref<number | null>(null)
const feedback = ref('')
const gradingLoading = ref(false)
const gradingSuccess = ref(false)

async function submitGrade() {
  if (score.value === null || score.value < 0) return
  gradingLoading.value = true
  gradingSuccess.value = false
  try {
    await api(`/api/submissions/${route.params.submissionId}/grade`, {
      method: 'POST',
      body: {
        score: score.value,
        feedback: feedback.value
      },
      token: token.value!
    })
    gradingSuccess.value = true
    if (data.value?.submission) {
      data.value.submission.score = score.value
      data.value.submission.feedback = feedback.value
    }
  } catch (e: any) {
    alert(e.message || '채점 등록 중 오류가 발생했습니다')
  } finally {
    gradingLoading.value = false
  }
}

// Populate grade inputs when data is loaded
import { watch } from 'vue'
watch(data, (newVal) => {
  if (newVal?.submission) {
    score.value = newVal.submission.score
    feedback.value = newVal.submission.feedback || ''
  }
}, { immediate: true })

function goBack() {
  if (isStaff.value) {
    // Return to the specific assignment's submission list, not the bare dashboard.
    const aid = submission.value?.assignmentId
    router.push(aid ? `/teacher?assignment=${aid}` : '/teacher')
  } else {
    router.push('/student?filter=SUBMITTED')
  }
}

const backLabel = computed(() =>
  isStaff.value ? '제출 목록으로 돌아가기' : '내 과제로 돌아가기'
)
</script>

<template>
  <!-- Loading -->
  <div v-if="loading" class="min-h-screen flex items-center justify-center bg-background">
    <div class="flex flex-col items-center gap-3">
      <div class="w-10 h-10 border-3 border-primary border-t-transparent rounded-full animate-spin"></div>
      <span class="text-sm text-text-secondary">분석 데이터를 불러오는 중...</span>
    </div>
  </div>

  <!-- Error -->
  <div v-else-if="error" class="min-h-screen flex items-center justify-center bg-background">
    <div class="card p-8 text-center max-w-md">
      <div class="text-3xl mb-3">❌</div>
      <p class="text-text-primary font-medium">{{ error }}</p>
      <button @click="goBack" class="btn btn-outline mt-4">돌아가기</button>
    </div>
  </div>

  <!-- Analysis Report -->
  <div v-else-if="data" class="max-w-5xl mx-auto px-6 py-8">
    <!-- Back button + Breadcrumb -->
    <div class="flex items-center justify-between mb-6">
      <button @click="goBack" class="btn btn-outline btn-sm flex items-center gap-1.5">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/>
          <polyline points="12 19 5 12 12 5"/>
        </svg>
        <span>{{ backLabel }}</span>
      </button>
      <div class="flex items-center gap-2 text-sm text-text-muted">
        <button @click="goBack" class="hover:text-primary transition-colors">
          {{ isStaff ? '제출 목록' : '내 과제' }}
        </button>
        <span>/</span>
        <span class="text-text-secondary">분석 리포트</span>
      </div>
    </div>

    <!-- Tab Navigation -->
    <div class="flex items-center border-b border-border mb-6">
      <button 
        @click="activeTab = 'report'" 
        class="px-5 py-3 text-sm font-semibold border-b-2 transition-all duration-150 -mb-px flex items-center gap-1.5"
        :class="activeTab === 'report' ? 'border-primary text-primary font-bold' : 'border-transparent text-text-secondary hover:text-text-primary'"
      >
        <span>📊</span> 분석 리포트
      </button>
      <button 
        v-if="isStaff && events.length > 0"
        @click="activeTab = 'replay'" 
        class="px-5 py-3 text-sm font-semibold border-b-2 transition-all duration-150 -mb-px flex items-center gap-1.5"
        :class="activeTab === 'replay' ? 'border-primary text-primary font-bold' : 'border-transparent text-text-secondary hover:text-text-primary'"
      >
        <span>🎥</span> 작성 리플레이 룸
      </button>
      <button 
        @click="activeTab = 'content'" 
        class="px-5 py-3 text-sm font-semibold border-b-2 transition-all duration-150 -mb-px flex items-center gap-1.5"
        :class="activeTab === 'content' ? 'border-primary text-primary font-bold' : 'border-transparent text-text-secondary hover:text-text-primary'"
      >
        <span>📝</span> 본문 집중 분석 & 채점
      </button>
    </div>

    <!-- TAB 1: Analysis Report -->
    <div v-if="activeTab === 'report'" class="space-y-6">
      <!-- Hero Section: Score + Verdict -->
      <div v-if="analysis" class="card p-8">
        <div class="flex items-start gap-8">
          <!-- Large Gauge -->
          <div class="flex-shrink-0">
            <div class="score-gauge-lg">
              <svg width="160" height="160" viewBox="0 0 160 160">
                <circle cx="80" cy="80" :r="gaugeRadius" fill="none" stroke="#E5E7EB" stroke-width="8"/>
                <circle cx="80" cy="80" :r="gaugeRadius" fill="none"
                  :stroke="flagColor(analysis.flagStatus || '')"
                  stroke-width="8" stroke-linecap="round"
                  :stroke-dasharray="gaugeCircumference"
                  :stroke-dashoffset="gaugeOffset(analysis.flagiaScore ?? 0)"
                  style="transition: stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1);"
                />
              </svg>
              <div class="score-text-lg">
                <div class="score-number" :style="{ color: flagColor(analysis.flagStatus || '') }">
                  {{ (analysis.flagiaScore ?? 0).toFixed(1) }}
                </div>
                <div class="score-label text-text-muted">Flagia Score</div>
              </div>
            </div>
          </div>

          <!-- Info -->
          <div class="flex-1">
            <div class="flex items-center gap-3 mb-3">
              <h1 class="text-xl font-bold text-text-primary">글쓰기 무결성 분석 리포트</h1>
              <span class="badge text-sm" :class="{
                'badge-green': analysis.flagStatus === 'GREEN',
                'badge-amber': analysis.flagStatus === 'AMBER',
                'badge-red': analysis.flagStatus === 'RED',
              }">
                {{ flagLabel(analysis.flagStatus || '') }}
              </span>
            </div>

            <div v-if="submission" class="text-sm text-text-secondary mb-1">
              <strong>{{ submission.assignmentTitle }}</strong>
            </div>
            <div v-if="submission" class="flex items-center gap-4 text-xs text-text-muted mb-4">
              <span>👤 {{ submission.studentName }}</span>
              <span>📧 {{ submission.studentEmail }}</span>
              <span v-if="submission.submittedAt">📅 {{ formatDate(submission.submittedAt) }}</span>
            </div>

            <!-- Verdict -->
            <div class="p-4 rounded-lg" :class="flagBg(analysis.flagStatus || '')">
              <p class="text-sm font-semibold mb-1" :style="{ color: flagColor(analysis.flagStatus || '') }">
                {{ analysis.verdict }}
              </p>
              <p class="text-xs text-text-secondary leading-relaxed">
                {{ analysis.verdictDetail }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- 4 Metric Cards -->
      <div v-if="analysis?.components" class="grid grid-cols-2 gap-4">
        <div
          v-for="(comp, key) in analysis.components"
          :key="key"
          class="metric-card animate-fade-in"
          :class="'status-' + comp.status"
        >
          <div class="flex items-start gap-4">
            <!-- Mini gauge -->
            <div class="flex-shrink-0 relative" style="width: 56px; height: 56px;">
              <svg width="56" height="56" viewBox="0 0 56 56" style="transform: rotate(-90deg);">
                <circle cx="28" cy="28" :r="miniR" fill="none" stroke="#E5E7EB" stroke-width="4"/>
                <circle cx="28" cy="28" :r="miniR" fill="none"
                  :stroke="flagColor(comp.status === 'good' ? 'GREEN' : comp.status === 'warning' ? 'AMBER' : 'RED')"
                  stroke-width="4" stroke-linecap="round"
                  :stroke-dasharray="miniC"
                  :stroke-dashoffset="miniOffset(comp.raw)"
                  style="transition: stroke-dashoffset 0.8s ease;"
                />
              </svg>
              <div class="absolute inset-0 flex items-center justify-center text-sm font-bold"
                :style="{ color: flagColor(comp.status === 'good' ? 'GREEN' : comp.status === 'warning' ? 'AMBER' : 'RED') }">
                {{ comp.raw }}
              </div>
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-base">{{ componentIcon(key as string) }}</span>
                <h3 class="text-sm font-semibold text-text-primary">{{ comp.label }}</h3>
              </div>
              <p class="text-xs text-text-secondary leading-relaxed">{{ comp.description }}</p>
              <div class="flex items-center gap-3 mt-2 text-xs text-text-muted">
                <span>점수: <strong>{{ comp.raw }}</strong> / 100</span>
                <span>가중치: {{ (comp.weight * 100).toFixed(0) }}%</span>
                <span>기여: {{ comp.weighted.toFixed(1) }}점</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Writing Timeline with custom hover tooltips -->
      <div v-if="timeline && timeline.length > 0" class="card p-6">
        <div class="flex items-center justify-between mb-4 border-b border-border pb-3">
          <div>
            <h2 class="text-sm font-semibold text-text-primary mb-1">글쓰기 타임라인 (상호작용 뷰)</h2>
            <p class="text-xs text-text-muted font-normal">타임라인 박스에 마우스를 올리면 구간별 상세 이력과 지표를 볼 수 있습니다.</p>
          </div>
          <div class="flex items-center gap-2 text-xs">
            <span class="text-text-secondary font-medium">집계 단위:</span>
            <input
              type="range"
              min="5"
              max="120"
              step="5"
              v-model.number="bucketSizeSec"
              class="w-32 accent-primary cursor-pointer"
            />
            <span class="font-mono bg-background px-1.5 py-0.5 rounded border border-border">{{ bucketSizeSec }}초</span>
          </div>
        </div>

        <div class="timeline-bar">
          <div
            v-for="(bucket, i) in timeline"
            :key="i"
            class="timeline-bucket"
            :style="{
              background: getTimelineBucketColor(bucket),
              height: getTimelineBucketHeight(bucket) + '%',
              alignSelf: 'flex-end',
            }"
          >
            <!-- Custom Interactive Hover Card Tooltip -->
            <div class="timeline-tooltip font-sans text-xs">
              <div class="text-[10px] text-slate-400 font-bold border-b border-white/10 pb-1 mb-1 flex items-center justify-between">
                <span>구간 #{{ Number(i) + 1 }}</span>
                <span>⏰ {{ Math.round(bucket.startMs / 1000) }}초 ~ {{ Math.round(bucket.endMs / 1000) }}초</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-400">⌨️ 키 입력</span>
                <span class="font-bold">{{ bucket.keystrokeCount }}회</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-400">⏱️ 평균 IKI</span>
                <span class="font-bold font-mono">{{ bucket.avgIki > 0 ? bucket.avgIki + 'ms' : '-' }}</span>
              </div>
              <div v-if="bucket.pasteCount > 0" class="flex justify-between text-red-400 font-semibold">
                <span>📋 붙여넣기</span>
                <span>{{ bucket.pasteCount }}회</span>
              </div>
              <div v-if="bucket.isBlurred" class="flex justify-between text-amber-400 font-semibold">
                <span>⚠️ 에디터 이탈</span>
                <span>감지됨</span>
              </div>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-4 mt-4 text-xs text-text-muted">
          <div class="flex items-center gap-1.5">
            <div class="w-3 h-3 rounded-sm" style="background: #818CF8;"></div> 타이핑
          </div>
          <div class="flex items-center gap-1.5">
            <div class="w-3 h-3 rounded-sm" style="background: #FDE68A;"></div> 화면 이탈
          </div>
          <div class="flex items-center gap-1.5">
            <div class="w-3 h-3 rounded-sm" style="background: #FCA5A5;"></div> 붙여넣기
          </div>
          <div class="flex items-center gap-1.5">
            <div class="w-3 h-3 rounded-sm" style="background: #E5E7EB;"></div> 비활동
          </div>
        </div>
      </div>

      <!-- Session Summary -->
      <div v-if="analysis?.sessionSummary" class="card p-6">
        <h2 class="text-sm font-semibold text-text-primary mb-4">세션 요약</h2>
        <div class="grid grid-cols-5 gap-4">
          <div class="text-center">
            <div class="text-xl font-bold text-text-primary">
              {{ formatDuration(analysis.sessionSummary.totalDurationSec ?? 0) }}
            </div>
            <div class="text-xs text-text-muted mt-0.5">총 작성 시간</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-bold text-text-primary">
              {{ (analysis.sessionSummary.totalKeystrokes ?? 0).toLocaleString() }}
            </div>
            <div class="text-xs text-text-muted mt-0.5">총 키 입력</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-bold text-text-primary">
              {{ (analysis.sessionSummary.totalCharactersTyped ?? 0).toLocaleString() }}
            </div>
            <div class="text-xs text-text-muted mt-0.5">최종 글자 수</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-bold text-text-primary">
              {{ analysis.sessionSummary.averageWPM ?? 0 }}
            </div>
            <div class="text-xs text-text-muted mt-0.5">평균 WPM</div>
          </div>
          <div class="text-center">
            <div class="text-xl font-bold text-text-primary">
              {{ analysis.sessionSummary.sessionCount ?? 0 }}
            </div>
            <div class="text-xs text-text-muted mt-0.5">세션 수</div>
          </div>
        </div>
      </div>

      <!-- Raw Metrics -->
      <div class="card p-6">
        <h2 class="text-sm font-semibold text-text-primary mb-4">원시 측정값</h2>
        <div v-if="analysis" class="grid grid-cols-3 gap-4 text-sm">
          <div class="p-3 bg-background rounded-lg">
            <div class="text-xs text-text-muted">IKI 변동 계수 (Cv)</div>
            <div class="font-mono font-bold mt-0.5">{{ (analysis.coefficientOfVariation ?? 0).toFixed(4) }}</div>
          </div>
          <div class="p-3 bg-background rounded-lg">
            <div class="text-xs text-text-muted">수정 비율 (RR)</div>
            <div class="font-mono font-bold mt-0.5">{{ (analysis.revisionRatio ?? 0).toFixed(4) }}</div>
          </div>
          <div class="p-3 bg-background rounded-lg">
            <div class="text-xs text-text-muted">붙여넣기 횟수</div>
            <div class="font-mono font-bold mt-0.5">{{ analysis.totalPasteCount ?? 0 }}</div>
          </div>
          <div class="p-3 bg-background rounded-lg">
            <div class="text-xs text-text-muted">총 이탈 시간</div>
            <div class="font-mono font-bold mt-0.5">{{ formatDuration(analysis.totalBlurDuration ?? 0) }}</div>
          </div>
          <div class="p-3 bg-background rounded-lg">
            <div class="text-xs text-text-muted">분석 모드</div>
            <div class="font-mono font-bold mt-0.5">{{ submission?.mode }}</div>
          </div>
          <div class="p-3 bg-background rounded-lg">
            <div class="text-xs text-text-muted">글자 제한</div>
            <div class="font-mono font-bold mt-0.5">{{ (submission?.textLimit ?? 0).toLocaleString() }}자</div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 2: Playback Simulator Room -->
    <div v-if="activeTab === 'replay'" class="space-y-6">
      <div class="card p-6 bg-slate-50 border-primary-50">
        <div class="flex items-center justify-between mb-4 border-b border-border pb-3">
          <div>
            <h2 class="text-sm font-semibold text-text-primary flex items-center gap-2">
              <span>🎥 Writing Process Replay</span>
              <span class="badge badge-green text-xs">Simulated Playback</span>
            </h2>
            <p class="text-xs text-text-muted mt-0.5">학생의 키 입력 리듬과 지우기, 붙여넣기 역사를 리얼타임 시뮬레이션으로 복원합니다.</p>
          </div>
          
          <div class="flex items-center gap-2 text-xs">
            <span class="font-medium text-text-secondary">에디터 상태:</span>
            <span class="px-2 py-0.5 rounded font-bold text-xs" :class="{
              'bg-green-100 text-green-700': replayState.activeStatus === '작성 중',
              'bg-amber-100 text-amber-700': replayState.activeStatus === '화면 이탈',
              'bg-slate-100 text-slate-700': replayState.activeStatus === '대기 중',
            }">{{ replayState.activeStatus }}</span>
          </div>
        </div>

        <!-- Playback Stats Dashboard -->
        <div class="grid grid-cols-4 gap-4 mb-4">
          <div class="bg-white p-3 rounded-lg border border-border text-center shadow-xs">
            <div class="text-xs text-text-muted">입력 글자 수</div>
            <div class="text-base font-bold text-text-primary mt-1">
              {{ replayState.text.replace(/\[📋 붙여넣기: \d+자\]/g, '').length }}자
            </div>
          </div>
          <div class="bg-white p-3 rounded-lg border border-border text-center shadow-xs">
            <div class="text-xs text-text-muted">실시간 속도</div>
            <div class="text-base font-bold text-primary mt-1">{{ replayState.currentWpm }} WPM</div>
          </div>
          <div class="bg-white p-3 rounded-lg border border-border text-center shadow-xs">
            <div class="text-xs text-text-muted">키 입력 횟수</div>
            <div class="text-base font-bold text-text-primary mt-1">{{ replayState.keystrokeCount }}회</div>
          </div>
          <div class="bg-white p-3 rounded-lg border border-border text-center shadow-xs">
            <div class="text-xs text-text-muted">붙여넣기 / 이탈</div>
            <div class="text-base font-bold mt-1" :class="replayState.pasteCount > 0 || replayState.blurCount > 0 ? 'text-flag-amber' : 'text-flag-green'">
              {{ replayState.pasteCount }}회 / {{ replayState.blurCount }}회
            </div>
          </div>
        </div>

        <!-- Video-like Layout -->
        <div class="grid grid-cols-3 gap-4 mb-4 h-96">
          <!-- Editor Canvas -->
          <div class="col-span-2 bg-slate-950 text-slate-200 p-6 rounded-lg font-mono text-sm overflow-y-auto border border-slate-800 relative flex flex-col">
            <div class="absolute top-2 right-2 text-[10px] text-slate-500 font-sans select-none tracking-widest font-bold">
              REPLAY SCREEN
            </div>
            <div class="flex-1 whitespace-pre-wrap break-all leading-relaxed pr-8 pt-4">
              {{ replayState.text }}<span class="w-2 h-4 bg-primary inline-block animate-pulse align-middle ml-0.5"></span>
            </div>
          </div>

          <!-- Real-time Event Logger -->
          <div class="bg-slate-900 text-slate-300 p-4 rounded-lg font-mono text-[11px] overflow-y-auto border border-slate-800 flex flex-col">
            <div class="text-slate-500 font-sans font-semibold mb-2 select-none uppercase tracking-wider text-[10px] border-b border-slate-800 pb-1">
              Event Log (Realtime)
            </div>
            <div class="flex-1 flex flex-col gap-1.5">
              <div v-for="(log, idx) in replayState.logs" :key="idx" class="border-l-2 border-indigo-500 pl-2 py-0.5 text-slate-300">
                {{ log }}
              </div>
              <div v-if="replayState.logs.length === 0" class="text-slate-500 italic text-center my-auto">
                이벤트가 발생하면 로그가 표시됩니다.
              </div>
            </div>
          </div>
        </div>

        <!-- Playback Controller Card -->
        <div class="bg-white p-4 rounded-lg border border-border shadow-xs flex items-center justify-between gap-4">
          <!-- Play / Pause / Stop -->
          <div class="flex items-center gap-1.5">
            <button @click="replayPlaying ? pauseReplay() : startReplay()" class="btn btn-primary btn-sm flex items-center justify-center w-10 h-9 p-0" title="재생 / 일시정지">
              <span v-if="replayPlaying">⏸</span>
              <span v-else>▶</span>
            </button>
            <button @click="stopReplay" class="btn btn-outline btn-sm flex items-center justify-center w-10 h-9 p-0" title="정지">
              <span>⏹</span>
            </button>
          </div>

          <!-- Scrubber and Time -->
          <div class="flex-1 flex items-center gap-3">
            <span class="text-xs font-mono text-text-secondary min-w-[45px] text-right">
              {{ formatDuration(replayCurrentMs / 1000) }}
            </span>
            <input
              type="range"
              min="0"
              :max="replayTotalMs"
              v-model.number="replayCurrentMs"
              @input="pauseReplay"
              class="flex-1 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-primary"
            />
            <span class="text-xs font-mono text-text-secondary min-w-[45px]">
              {{ formatDuration(replayTotalMs / 1000) }}
            </span>
          </div>

          <!-- Speed control -->
          <div class="flex items-center gap-1 bg-slate-100 p-1 rounded-md">
            <button
              v-for="s in [1, 5, 10, 20, 50]"
              :key="s"
              @click="setSpeed(s)"
              class="px-2 py-1 text-[11px] font-mono font-bold rounded transition-colors"
              :class="replaySpeed === s ? 'bg-primary text-white' : 'text-text-secondary hover:bg-slate-200'"
            >
              {{ s }}x
            </button>
          </div>
        </div>
      </div>

      <!-- Blur Intervals -->
      <div v-if="analysis?.blurIntervals && analysis.blurIntervals.length > 0" class="card p-6">
        <h2 class="text-sm font-semibold text-text-primary mb-1">화면 이탈 기록</h2>
        <p class="text-xs text-text-muted mb-4">작성 중 에디터를 벗어난 상세 시간 리스트</p>

        <div class="flex flex-col gap-1.5">
          <div v-for="(interval, i) in analysis.blurIntervals.slice(0, 20)" :key="i"
            class="flex items-center gap-3 text-xs p-2 rounded-lg hover:bg-background transition-colors">
            <span class="text-text-muted w-8 text-right font-mono">#{{ Number(i) + 1 }}</span>
            <span class="font-mono text-text-secondary">
              {{ Math.round(interval.startMs / 1000) }}s → {{ Math.round(interval.endMs / 1000) }}s
            </span>
            <span class="font-semibold" :class="{
              'text-flag-green': interval.durationSec < 10,
              'text-flag-amber': interval.durationSec >= 10 && interval.durationSec < 60,
              'text-flag-red': interval.durationSec >= 60,
            }">
              {{ interval.durationSec.toFixed(1) }}초
            </span>
            <div class="flex-1">
              <div class="progress-bar h-1">
                <div class="progress-fill" :class="{
                  'bg-flag-green': interval.durationSec < 10,
                  'bg-flag-amber': interval.durationSec >= 10 && interval.durationSec < 60,
                  'bg-flag-red': interval.durationSec >= 60,
                }" :style="{ width: Math.min(100, interval.durationSec / 2) + '%' }"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB 3: Focused Content View & Grading -->
    <div v-if="activeTab === 'content'" class="grid grid-cols-3 gap-6">
      <!-- Left Column: Focused Document Paper -->
      <div class="col-span-2 space-y-4">
        <div class="bg-white border border-border rounded-xl shadow-md p-10 max-h-[85vh] overflow-y-auto flex flex-col font-serif relative">
          <!-- Document Header -->
          <div class="border-b border-border pb-6 mb-8 font-sans">
            <h1 class="text-2xl font-bold text-text-primary mb-2">{{ submission?.assignmentTitle }}</h1>
            <div class="flex items-center justify-between text-xs text-text-muted">
              <div class="flex items-center gap-3">
                <span class="font-semibold text-text-secondary">👤 {{ submission?.studentName }}</span>
                <span>📧 {{ submission?.studentEmail }}</span>
              </div>
              <div class="flex items-center gap-3 font-mono">
                <span>글자 수: <strong>{{ submission?.finalMarkdown?.length || 0 }}자</strong></span>
                <span v-if="submission?.submittedAt">제출일: {{ formatDate(submission.submittedAt) }}</span>
              </div>
            </div>
          </div>

          <!-- Paper Body -->
          <div class="flex-1 markdown-body prose prose-slate max-w-none text-base leading-relaxed text-slate-800 font-sans" style="line-height: 1.8;">
            <div class="markdown-body" v-html="marked.parse(submission?.finalMarkdown || '(내용 없음)')"></div>
          </div>

          <!-- Bottom Footer watermark -->
          <div class="border-t border-border mt-10 pt-4 text-center text-[10px] text-text-muted font-sans select-none">
            Flagia Integrity Document Viewer
          </div>
        </div>
      </div>

      <!-- Right Column: Grading Form & Metrics Overview -->
      <div class="col-span-1 space-y-6">
        <!-- Teacher Grading Panel -->
        <div v-if="isStaff" class="card p-6 border-indigo-100 shadow-sm bg-indigo-50/20">
          <h2 class="text-sm font-bold text-indigo-900 mb-4 flex items-center gap-1.5">
            <span>✏️</span> 제출물 채점 및 피드백
          </h2>
          
          <form @submit.prevent="submitGrade" class="space-y-4">
            <div>
              <label class="block text-xs font-semibold text-indigo-800 mb-1.5">
                과제 점수 입력 (최대 {{ submission?.maxScore || 100 }}점)
              </label>
              <div class="relative flex items-center">
                <input
                  type="number"
                  v-model.number="score"
                  min="0"
                  :max="submission?.maxScore || 100"
                  step="1"
                  required
                  placeholder="점수 입력"
                  class="input w-full pr-12 focus:border-primary no-spinner"
                />
                <span class="absolute right-3 text-xs font-mono text-text-muted">/ {{ submission?.maxScore || 100 }}</span>
              </div>
            </div>

            <div>
              <label class="block text-xs font-semibold text-indigo-800 mb-1.5">
                학생 전달 피드백
              </label>
              <textarea 
                v-model="feedback"
                placeholder="과제에 대한 피드백 및 코멘트를 입력하세요..."
                rows="5"
                class="input w-full p-3 text-xs resize-none"
              ></textarea>
            </div>

            <button 
              type="submit" 
              class="btn btn-primary w-full text-xs font-bold py-2.5"
              :disabled="gradingLoading"
            >
              {{ gradingLoading ? '저장 중...' : '점수 & 피드백 저장' }}
            </button>

            <div v-if="gradingSuccess" class="text-center text-xs text-green-600 font-bold bg-green-50 py-1.5 rounded border border-green-200">
              ✓ 채점 정보가 저장되었습니다!
            </div>
          </form>
        </div>

        <!-- Student View Panel: Score & Feedback display -->
        <div v-else class="card p-6">
          <h2 class="text-sm font-bold text-text-primary mb-4">🏆 과제 평가 결과</h2>
          <div class="bg-slate-50 border border-slate-100 rounded-lg p-4 text-center">
            <div class="text-xs text-text-muted">획득 점수</div>
            <div class="text-3xl font-black text-primary mt-1">
              {{ score !== null ? score : '-' }} <span class="text-sm font-normal text-text-muted">/ {{ submission?.maxScore || 100 }}</span>
            </div>
          </div>

          <div class="mt-4">
            <div class="text-xs font-semibold text-text-secondary mb-1">선생님 피드백</div>
            <div class="bg-background rounded-lg p-4 text-xs text-text-primary whitespace-pre-wrap min-h-24 border border-border leading-relaxed">
              {{ feedback || '아직 등록된 피드백이 없습니다.' }}
            </div>
          </div>
        </div>

        <!-- Integrity Overview Card -->
        <div class="card p-6">
          <h2 class="text-sm font-semibold text-text-primary mb-4">🛡️ 글쓰기 무결성 요약</h2>
          <div class="space-y-3 text-xs">
            <div class="flex justify-between items-center py-1.5 border-b border-border">
              <span class="text-text-secondary">Flagia Score</span>
              <strong :style="{ color: flagColor(analysis?.flagStatus || '') }">
                {{ (analysis?.flagiaScore ?? 0).toFixed(1) }}점 ({{ flagLabel(analysis?.flagStatus || '') }})
              </strong>
            </div>
            <div class="flex justify-between items-center py-1.5 border-b border-border">
              <span class="text-text-secondary">총 키 입력 횟수</span>
              <strong class="text-text-primary">{{ (analysis?.sessionSummary?.totalKeystrokes ?? 0).toLocaleString() }}회</strong>
            </div>
            <div class="flex justify-between items-center py-1.5 border-b border-border">
              <span class="text-text-secondary">복사 붙여넣기</span>
              <strong :class="analysis?.totalPasteCount > 0 ? 'text-flag-amber' : 'text-flag-green'">
                {{ analysis?.totalPasteCount ?? 0 }}회 감지
              </strong>
            </div>
            <div class="flex justify-between items-center py-1.5 border-b border-border">
              <span class="text-text-secondary">외부 브라우저 이탈</span>
              <strong :class="analysis?.totalBlurDuration > 10 ? 'text-flag-amber' : 'text-flag-green'">
                {{ analysis?.blurIntervals?.length || 0 }}회 ({{ formatDuration(analysis?.totalBlurDuration || 0) }})
              </strong>
            </div>
            <div class="flex justify-between items-center py-1.5">
              <span class="text-text-secondary">평균 글쓰기 속도</span>
              <strong class="text-text-primary">{{ analysis?.sessionSummary?.averageWPM || 0 }} WPM</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Hide the native number-input spinner arrows on the grade field — they
   overlapped the "/ 100" suffix and looked like a stray arrow. */
.no-spinner::-webkit-outer-spin-button,
.no-spinner::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.no-spinner {
  -moz-appearance: textfield;
  appearance: textfield;
}
</style>

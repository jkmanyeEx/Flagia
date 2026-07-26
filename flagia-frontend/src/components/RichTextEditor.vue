<script setup lang="ts">
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { watch, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { createDocumentFrame } from '../utils/replayFrames'

const { t } = useI18n()

const props = defineProps<{
  modelValue: string
  disabled?: boolean
  placeholder?: string
}>()

const emit = defineEmits([
  'update:modelValue',
  'keydown',
  'paste',
  'blur',
  'focus',
  'document-frame',
])

const isFocused = ref(false)
let telemetryReady = false
let suppressTelemetry = false
let telemetryBasePending = true
let lastTelemetryText = ''
let lastTelemetryCursor = 0
let lastTelemetrySelectionLength = 0

// Pre-transaction selection capture — set by ProseMirror's editorProps hooks
// BEFORE the transaction modifies the document. This is the key fix for accurate
// telemetry: the Vue @keydown handler fires AFTER PM processes the key, so
// reading selection there gives post-change positions.
const lastSelectionBeforeEvent = ref({ cursor: 0, selectionLength: 0 })

function captureSelection(view: any) {
  try {
    const { anchor, head } = view.state.selection
    const start = Math.min(anchor, head)
    const end = Math.max(anchor, head)
    const cursor = view.state.doc.textBetween(0, start, '\n').length
    const selectionLength = view.state.doc.textBetween(0, end, '\n').length - cursor
    lastSelectionBeforeEvent.value = { cursor, selectionLength }
  } catch { /* noop */ }
}

function readPlainEditorState(editorInstance: any) {
  const { doc, selection } = editorInstance.state
  const start = Math.min(selection.anchor, selection.head)
  const end = Math.max(selection.anchor, selection.head)
  const text = doc.textBetween(0, doc.content.size, '\n')
  const cursorPosition = doc.textBetween(0, start, '\n').length
  const selectionLength = doc.textBetween(start, end, '\n').length
  return { text, cursorPosition, selectionLength }
}

const editor = useEditor({
  extensions: [
    // Lists, horizontal rule and blockquote are disabled (plain prose only), and
    // the bundled Link extension is turned off so typed/pasted URLs stay as plain
    // text instead of becoming clickable hyperlinks.
    StarterKit.configure({
      bulletList: false,
      orderedList: false,
      listItem: false,
      horizontalRule: false,
      blockquote: false,
      link: false,
    }),
    Placeholder.configure({
      placeholder: props.placeholder || t('runtime.m_95531b206301'),
    }),
  ],
  content: props.modelValue,
  editable: !props.disabled,
  editorProps: {
    // These hooks fire BEFORE ProseMirror processes the event, giving us the
    // exact pre-transaction selection for accurate telemetry capture.
    handleKeyDown: (view: any) => {
      captureSelection(view)
      return false // let ProseMirror handle the key normally
    },
    handlePaste: (view: any) => {
      captureSelection(view)
      return false
    },
  },
  onUpdate: ({ editor }) => {
    emit('update:modelValue', editor.getHTML())
  },
  onCreate: ({ editor }) => {
    const state = readPlainEditorState(editor)
    lastTelemetryText = state.text
    lastTelemetryCursor = state.cursorPosition
    lastTelemetrySelectionLength = state.selectionLength
    telemetryReady = true
  },
  onTransaction: ({ editor, transaction }) => {
    if (
      !telemetryReady ||
      suppressTelemetry ||
      props.disabled ||
      (!transaction.docChanged && !transaction.selectionSet)
    ) {
      return
    }

    const next = readPlainEditorState(editor)
    if (
      next.text === lastTelemetryText &&
      next.cursorPosition === lastTelemetryCursor &&
      next.selectionLength === lastTelemetrySelectionLength
    ) {
      return
    }

    emit(
      'document-frame',
      createDocumentFrame(
        lastTelemetryText,
        next.text,
        next.cursorPosition,
        next.selectionLength,
        telemetryBasePending,
      ),
    )
    telemetryBasePending = false
    lastTelemetryText = next.text
    lastTelemetryCursor = next.cursorPosition
    lastTelemetrySelectionLength = next.selectionLength
  },
  onFocus: () => {
    isFocused.value = true
    emit('focus')
  },
  onBlur: () => {
    isFocused.value = false
    emit('blur')
  },
})

watch(() => props.modelValue, (value) => {
  const isSame = editor.value?.getHTML() === value
  if (!isSame) {
    suppressTelemetry = true
    editor.value?.commands.setContent(value, { emitUpdate: false })
    if (editor.value) {
      const state = readPlainEditorState(editor.value)
      lastTelemetryText = state.text
      lastTelemetryCursor = state.cursorPosition
      lastTelemetrySelectionLength = state.selectionLength
      telemetryBasePending = true
    }
    suppressTelemetry = false
  }
})

watch(() => props.disabled, (val) => {
  editor.value?.setEditable(!val)
})

const getSelectionDetails = (editorInstance: any) => {
  if (!editorInstance) return { cursor: 0, selectionLength: 0 }
  try {
    const { anchor, head } = editorInstance.state.selection
    const start = Math.min(anchor, head)
    const end = Math.max(anchor, head)
    const cursor = editorInstance.state.doc.textBetween(0, start, '\n').length
    const selectionLength = editorInstance.state.doc.textBetween(0, end, '\n').length - cursor
    return { cursor, selectionLength }
  } catch (err) {
    return { cursor: 0, selectionLength: 0 }
  }
}

onBeforeUnmount(() => {
  editor.value?.destroy()
})
</script>

<template>
  <div class="rich-editor-wrapper" :class="{ 'is-disabled': disabled, 'is-focused': isFocused }">
    <div v-if="editor && !disabled" class="editor-toolbar">
      <button type="button" @click="editor.chain().focus().toggleBold().run()" :class="{ 'is-active': editor.isActive('bold') }">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>
      </button>
      <button type="button" @click="editor.chain().focus().toggleItalic().run()" :class="{ 'is-active': editor.isActive('italic') }">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>
      </button>
      <button type="button" @click="editor.chain().focus().toggleStrike().run()" :class="{ 'is-active': editor.isActive('strike') }">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><path d="M16 6C16 6 14.5 4 12 4C9.5 4 8 6 8 6"/><path d="M8 18C8 18 9.5 20 12 20C14.5 20 16 18 16 18"/></svg>
      </button>
      <div class="divider"></div>
      <button type="button" @click="editor.chain().focus().toggleHeading({ level: 1 }).run()" :class="{ 'is-active': editor.isActive('heading', { level: 1 }) }">
        H1
      </button>
      <button type="button" @click="editor.chain().focus().toggleHeading({ level: 2 }).run()" :class="{ 'is-active': editor.isActive('heading', { level: 2 }) }">
        H2
      </button>
      <button type="button" @click="editor.chain().focus().toggleHeading({ level: 3 }).run()" :class="{ 'is-active': editor.isActive('heading', { level: 3 }) }">
        H3
      </button>
    </div>
    
    <div 
      class="editor-content-container" 
      @keydown="(e) => emit('keydown', e, lastSelectionBeforeEvent)"
      @paste="(e) => emit('paste', e, lastSelectionBeforeEvent)"
    >
      <editor-content :editor="editor" />
    </div>
  </div>
</template>

<style>
.rich-editor-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  border-radius: 0.5rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  overflow: hidden;
}

.rich-editor-wrapper.is-focused {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.1);
}

.rich-editor-wrapper.is-disabled {
  background: var(--color-background);
  opacity: 0.8;
}

.editor-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.25rem;
  padding: 0.5rem;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background);
}

.editor-toolbar button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 0.375rem;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 600;
  transition: all 0.1s ease;
}

.editor-toolbar button:hover {
  background: var(--color-border);
  color: var(--color-text-primary);
}

.editor-toolbar button.is-active {
  background: var(--color-primary-light);
  color: var(--color-primary);
}

.editor-toolbar .divider {
  width: 1px;
  height: 1.25rem;
  background: var(--color-border);
  margin: 0 0.25rem;
}

.editor-content-container {
  flex: 1;
  overflow-y: auto;
  cursor: text;
}

.ProseMirror {
  padding: 1.5rem 2rem;
  min-height: 100%;
  outline: none;
  font-family: var(--font-sans);
  font-size: 1rem;
  line-height: 1.75;
  color: var(--color-text-primary);
}

.ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  float: left;
  color: var(--color-text-muted);
  pointer-events: none;
  height: 0;
}

/* Tiptap standard styles matching github markdown */
.ProseMirror > * + * {
  margin-top: 0.75em;
}

.ProseMirror h1 { font-size: 1.75rem; font-weight: 700; margin-top: 1.5rem; }
.ProseMirror h2 { font-size: 1.375rem; font-weight: 600; margin-top: 1.25rem; }
.ProseMirror h3 { font-size: 1.125rem; font-weight: 600; margin-top: 1rem; }
/* The editor itself no longer creates links/lists/blockquote/hr, but these
   .ProseMirror styles are global and also render the read-only template pane and
   the analysis/replay views, which may contain such nodes in existing content. */
.ProseMirror a { color: var(--color-primary); text-decoration: underline; }
.ProseMirror ul { padding-left: 1.5rem; list-style-type: disc; }
.ProseMirror ol { padding-left: 1.5rem; list-style-type: decimal; }
.ProseMirror blockquote {
  border-left: 3px solid var(--color-primary);
  padding: 0.5rem 1rem;
  background: var(--color-primary-light);
  color: var(--color-text-secondary);
  border-radius: 0 0.375rem 0.375rem 0;
}
.ProseMirror hr {
  border: none;
  border-top: 2px solid var(--color-border);
  margin: 2rem 0;
}
</style>

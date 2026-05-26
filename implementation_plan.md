# Implementation Plan — Editor & Template UX + paste/count fixes

## Scope (6 tasks)

### 1. Emoji character count (자) counts as 2+
- **Cause:** `wordCount` in `StudentEditor.vue` uses `string.length` (UTF-16 code units) → an emoji is a surrogate pair = 2 units (ZWJ/skin-tone sequences even more).
- **Fix:** count by grapheme using `Intl.Segmenter('ko', { granularity: 'grapheme' })` (fallback `[...text].length`). Add a small `countGraphemes()` helper; use it in `wordCount`.
- Files: `flagia-frontend/src/views/StudentEditor.vue`.

### 2. Remove lists and lines from the editor
- Disable in StarterKit: `bulletList`, `orderedList`, `listItem`, `horizontalRule` (the "—" divider button = "lines"). **Keep** headings, bold/italic/strike, blockquote.
- Remove the corresponding toolbar buttons + the now-dead list/hr CSS.
- Files: `flagia-frontend/src/components/RichTextEditor.vue`.

### 3. Don't hyperlink typed (or pasted) URLs
- **Cause:** TipTap v3 StarterKit bundles the `Link` extension with autolink on.
- **Fix:** `StarterKit.configure({ link: false })` → URLs stay plain text. Remove `.ProseMirror a` styling.
- Files: `flagia-frontend/src/components/RichTextEditor.vue`.

### 4. Two-pane template layout (replaces "view template" button/modal)
- When `assignment.template_text` exists: render a **read-only left pane** showing the template (scrollable `v-html`, same styling as the old modal) beside the editor on the right.
- When no template: keep the current single-pane editor.
- Remove the `📄 템플릿 보기` button and the Template View modal (`showTemplateView`).
- Responsive: side-by-side on `lg+`, stacked (template collapsible/above) on small screens.
- Files: `flagia-frontend/src/views/StudentEditor.vue`.

### 5. Remove "저장하고 과제 목록으로" button
- The `← 뒤로` button + the `onBeforeRouteLeave` guard already persist the draft, so the extra button is redundant.
- Remove the button (and the now-unused `saveAndExit`). Leave guard unchanged.
- Files: `flagia-frontend/src/views/StudentEditor.vue`.

### 6. Make copy/paste FROM the page legal (not penalized)
- **Rule (chosen: track copy/cut events):** a paste is "internal/legal" only if its text matches something the student copied/cut from this page during the session.
- **Frontend:** document-level `copy`/`cut` listeners capture `window.getSelection()` text into a bounded `copiedSnippets` list (covers both the editor and the template pane). In `handlePaste`, tag `meta.internal = true` when the pasted text matches a copied snippet (exact / containment, normalized whitespace).
- **Engine:** in `flagiaEngine.ts`, exclude `meta.internal` pastes from `totalPasteCount`, `totalPastedLength`, the paste-laundering `pasteTimes`, and `pastedShare`. They still appear in the replay timeline, labeled as 내부(허용) so teachers see them but they don't dock the score.
- Files: `flagia-frontend/src/views/StudentEditor.vue`, `flagia-backend/src/engine/flagiaEngine.ts` (+ replay label in `SubmissionAnalysis.vue`).

## Verify & deploy
- `vite` build FE, `tsc` build BE.
- Deploy triggers regrade → internal pastes on existing submissions become un-penalized (scores for those may rise). Expected.

## Out of scope
Changing the engine's char-count math (only the displayed 자 counter is graphemes-fixed); template editing by students.

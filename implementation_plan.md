# Implementation Plan — Exact Korean/IME Writing Replay

## Root cause

- The current replay treats 2-second plain-text snapshots as the source of truth
  whenever any snapshot is present.
- This guarantees eventual text correctness but necessarily produces visible
  2-second jumps, places the cursor at the end of every frame, and discards
  selection and rich-text structure.
- Raw `keydown` events cannot restore the missing states reliably because Korean
  IMEs may expose composition keys as `Process` or `Unidentified`; the completed
  Hangul syllable exists only in the editor transaction/input result.
- The existing Hangul automaton and proportional final-text reveal are therefore
  best-effort legacy fallbacks, not a path to exact replay.

## Architecture

### 1. Capture authoritative editor frames

- Extend `RichTextEditor.vue` to emit a telemetry-only document-change event
  after each user-originated ProseMirror transaction.
- Each frame carries the editor's actual post-transaction HTML, canonical plain
  text, plain-text cursor/selection offsets, timestamp, and a telemetry version.
- Ignore programmatic `setContent` updates so loading, reconnecting, or external
  model synchronization cannot create false writing events.
- Coalesce only redundant frames with identical document and selection state;
  do not time-sample Korean composition into multi-second chunks.

### 2. Persist through the existing event pipeline

- Have `StudentEditor.vue` enqueue the authoritative frames in the existing
  `event_batch` buffer and retain the current batch acknowledgement, reconnect,
  beacon, and final-flush behavior.
- Keep periodic snapshots as a low-frequency recovery checkpoint and preserve
  existing `keydown`, paste, focus, and leave telemetry for scoring/audit
  compatibility.
- Treat document frames as replay-only evidence in the analysis engine so this
  change does not alter integrity scores.
- Add bounded payload and frame validation at WebSocket ingestion while reusing
  the current submission/session authorization.

### 3. Replay exact frames

- Update `SubmissionAnalysis.vue` to prefer authoritative document frames for
  new sessions, rendering the latest frame at the selected replay timestamp
  with its recorded cursor/selection.
- Preserve the current snapshot path for intermediate-generation submissions
  and the Hangul automaton/final-text reveal only for legacy submissions.
- Reconcile the last replay frame with the submitted final document so the end
  of the timeline cannot omit a last-second edit.
- Preserve current paste/blur/focus logs and metrics independently from text
  rendering.

## Files in scope

- `flagia-frontend/src/components/RichTextEditor.vue`
- `flagia-frontend/src/views/StudentEditor.vue`
- `flagia-frontend/src/views/SubmissionAnalysis.vue`
- `flagia-backend/src/websocket.ts`
- `flagia-backend/src/engine/flagiaEngine.ts` only for event typing/exclusion
- Focused replay/capture tests and `walkthrough.md`

## Verification

### Automated

- Deterministic replay fixtures for:
  - `안녕하세요` typed through composition updates
  - compound vowels/final consonants such as `괜찮습니다`
  - Backspace within an active syllable
  - cursor insertion and ranged replacement in the middle of Korean text
  - mixed Korean, English, emoji, paste, Enter, and formatting
  - reconnect and submit during the final composition/edit
- Assert that every replay checkpoint exactly matches the captured editor text,
  cursor, and selection.
- Assert legacy snapshot and no-snapshot submissions retain their current
  fallback behavior.
- Run frontend type-check/build, backend build, focused protocol tests, and
  `git diff --check`.

### Visual walkthrough

- Record a Korean typing session and compare the student editor with the replay
  at normal and accelerated speeds.
- Capture evidence for composition, correction, mid-document insertion, seek,
  pause/resume, and final-frame fidelity in `walkthrough.md`.

## Acceptance criteria

- Korean syllables appear in replay at the same committed editor states and
  positions seen by the student, without 2-second chunking.
- Cursor movement, selection replacement, deletion, paste, paragraphs, emoji,
  and supported formatting replay without changing the final text.
- The replay's final frame equals the submitted document.
- Existing integrity scoring and older submissions remain compatible.

---

# Implementation Plan — App shell cleanup, dark theme, and full i18n

## Product decisions

- Remove the white mobile header and its duplicate Flagia logo.
- Preserve mobile navigation with a compact floating menu trigger that opens the existing sidebar drawer.
- Remove the **Usage guide** navigation item and delete its modal and state.
- Keep account details in Settings, replace **Security & integrity** with:
  - Theme: Light / Dark
  - Language: 한국어 / English
- Support Korean and English across the full user-facing application.
- Dark mode changes neutral white/gray surfaces, borders, shadows, and text only. Flagia purple and the green/amber/red integrity colors retain their semantic identity.

## Architecture

### 1. Theme foundation

- Add a small `usePreferences` composable as the single source of truth for theme and locale.
- Persist both choices in `localStorage`.
- Apply `data-theme="light|dark"` and the active `lang` to `<html>` before/at application startup to avoid a flash of the wrong theme or language.
- Extend the existing CSS design tokens with a complete dark neutral palette.
- Replace hardcoded neutral Tailwind classes and CSS colors (`bg-white`, gray/slate surfaces, neutral borders/text/shadows) with semantic tokens.
- Keep explicit semantic/brand colors unchanged, including primary purple, score flags, danger states, and intentional document/replay contrast.

Files:

- `flagia-frontend/src/composables/usePreferences.ts` (new)
- `flagia-frontend/src/main.ts`
- `flagia-frontend/src/style.css`
- All Vue views/components containing hardcoded neutral colors

### 2. Internationalization foundation

- Add Vue I18n v11 in Composition API mode, following the official Vue I18n integration for Vue 3.
- Create typed Korean and English message catalogs organized by feature rather than one flat string list.
- Make Korean the default and English the fallback; restore the persisted user choice on startup.
- Localize labels, headings, buttons, placeholders, validation, empty/loading/error states, confirmations, accessibility labels, status names, dynamic interpolation, and date/number output.
- Update `document.documentElement.lang` when the language changes.
- Keep user-authored content, names, assignment titles, classroom names, and saved feedback untouched.

Files:

- `flagia-frontend/src/i18n/index.ts` (new)
- `flagia-frontend/src/i18n/locales/ko.ts` (new)
- `flagia-frontend/src/i18n/locales/en.ts` (new)
- `flagia-frontend/src/main.ts`
- `flagia-frontend/src/App.vue`
- All files under `flagia-frontend/src/views/`
- `flagia-frontend/src/components/RichTextEditor.vue`
- `flagia-frontend/src/composables/useApi.ts`
- `flagia-frontend/package.json` and lockfile

### 3. API and realtime error localization

- Stop relying on Korean backend prose as the only API error identifier.
- Add stable error codes to user-visible REST and WebSocket error payloads while retaining the current Korean message for backward compatibility.
- Translate known error codes in the frontend and use a localized generic fallback for unknown/network failures.
- Send the active locale with REST requests so the contract is ready for locale-aware clients without coupling core business logic to display copy.

Files:

- `flagia-backend/src/routes/auth.ts`
- `flagia-backend/src/routes/assignments.ts`
- `flagia-backend/src/routes/classrooms.ts`
- `flagia-backend/src/routes/submissions.ts`
- `flagia-backend/src/middleware/auth.ts`
- `flagia-backend/src/websocket.ts`
- Frontend API and WebSocket consumers

### 4. App shell and settings

- Delete the mobile white header and duplicate logo.
- Add an accessible floating mobile menu trigger, with visible focus and pressed states, that disappears while the drawer is open.
- Remove the Usage guide item, guide modal, and associated state.
- Rename Settings copy appropriately and replace the security section with clear segmented/select controls for Theme and Language.
- Apply theme and language changes immediately without reload.
- Ensure the sidebar, overlay, modals, forms, editor, analysis/replay UI, landing page, and authentication screens work in both themes.

Files:

- `flagia-frontend/src/App.vue`
- `flagia-frontend/src/style.css`
- Relevant view-scoped styles

## Verification

### Automated

- Frontend type-check and production build.
- Backend TypeScript production build.
- Translation parity check: Korean and English catalogs must expose the same key tree.
- Repository scan for remaining user-facing Korean literals outside the Korean locale catalog and for hardcoded neutral colors that bypass theme tokens; document intentional exceptions.

### Visual and interaction QA

- Test light/dark and Korean/English combinations on:
  - Landing and authentication
  - Teacher assignment management
  - Student assignments
  - Classrooms and classroom details
  - Student editor
  - Submission analysis/replay
  - Settings modal and mobile sidebar
- Verify persistence after reload and no initial theme flash.
- Verify mobile sidebar access after removing the header.
- Verify focus visibility and readable contrast in both themes.
- Create `walkthrough.md` with screenshots demonstrating desktop and mobile results in both themes/languages.

## Acceptance criteria

- No white logo bar remains.
- The sidebar contains no Usage guide entry.
- Settings exposes only account information plus Theme and Language preferences; the security section is gone.
- Light/dark changes every neutral application surface consistently without recoloring brand/status semantics.
- Every frontend-owned user-facing string is available in Korean and English.
- API/realtime failures shown to users are localized through stable error codes.
- Preferences persist across sessions.
- Frontend and backend builds pass, and the walkthrough contains verified screenshots.

---

## Previous plan retained for reference

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

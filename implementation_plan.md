# 언어 분석 안내 문구 정리 — 2026-10-18

상태: 사용자 승인 완료(`ㄱ`), 구현 및 로컬 검증 완료. 사용자가 지정한 아홉 문구만 정리한 후속 변경이다. 한국어·영어 분석 완료/미평가 화면과 프런트엔드 빌드를 확인했다. 화면 증거는 `walkthrough.md`에 기록했다. 후속 요청 `푸시 ㄱ`에 따라 이번 문구 변경을 별도 커밋하고 푸시한다.

## 변경 범위

- `flagia-frontend/src/i18n/linguistic.ts`: 한국어·영어에서 미평가 추가 설명, 판정 한계 설명, 0점 하한 설명, 모델 출력 해석 설명, 특징 기여도 설명, 초기 임계값 보정 안내를 제거한다.
- 부분 삭제 후 남길 문구는 다음 세 문장이다.
  - `언어 분석 정책에 따라 {points}점이 차감되었습니다.`
  - `유지된 문장의 부정·수량·조건 관련 변화 후보를 전사 필터에 보완 반영합니다.`
  - `긴 작성 기록에서 서로 이어지는 구간을 골라 분석한 결과입니다.`
- `flagia-frontend/src/components/LinguisticPanel.vue`: 삭제된 여섯 안내 문단을 렌더링하는 요소도 제거해 빈 여백이나 번역 키가 남지 않게 한다. 남겨 둔 세 문장은 계속 표시한다.
- `walkthrough.md`: 로컬 가상 제출물의 변경 후 화면을 기록한다. 기존 미커밋 UI 작업은 보존한다.

## 검증

- 프런트엔드 타입 검사와 프로덕션 빌드.
- 한국어·영어의 분석 완료/미평가 화면에서 삭제 문구와 빈 안내 박스가 없는지 확인.
- 로컬 가상 제출물 스크린샷을 기능 검증용으로 명시한다.
- 점수 계산, 분석 모델, 임계값, 저장된 분석 데이터는 변경하지 않는다. 후속 푸시 요청에 따라 별도 커밋·푸시 및 자동 배포 결과를 확인한다.

---

# 현재 구현 범위 — 언어 분석 추가

2026년 10월 18일 대화 기준. 아래 범위와 점수 정책이 뒤의 과거 확장안을 대체한다. 사용자는 언어 분석 감점을 처음부터 실제 최종 점수에 반영하기로 결정했다. 상태: 구현 및 로컬 검증 완료. 실제 제출 환경의 탐지 성능은 추가 검증 대상이다.

## 범위와 분석 흐름

- 기존 다섯 지표와 가중치, 전사 필터를 기반으로 유지한다. 이번 패치에서 키 수집·IME 대조·타이밍 지표 전반을 개편하거나 일곱 지표 체계로 전환하지 않는다.
- 한국어 논설문·보고서 등 산문을 우선 지원한다. 다른 언어·장르, 짧거나 분석이 어려운 글은 언어 분석 미평가로 표시한다. 최소 길이는 길이별 평가로 정한다.
- AI 본문과 재서술을 탐지 대상으로 삼고, 단순 맞춤법 교정은 제외한다. 개요 참고는 별도 유형으로 평가한다.
- 한국어 형태·구문 특징 분류기 A와 한국어 문맥 분류기 B를 추가한다. 공개 한국어 자료로 시작하고 실제 Flagia 환경 자료로 검증한다.
- 기존 문서 프레임에서 실제 의미 수정을 분석해 전사 필터를 개선한다. 오타나 백스페이스만으로 자연 작성의 강한 근거를 부여하지 않고, 수정이 없다는 이유만으로 추가 감점하지 않는다. 이 의미 수정 근거를 언어 감점에서 다시 사용하지 않는다.
- 제출 후 서버 내부에서 비동기 분석하고 화면에 진행 상태를 표시한다. 본문을 외부 추론 API로 전송하지 않는 구성을 기본으로 한다.

## 최종 점수 정책

`기존 최종 점수`는 다섯 지표 및 전사 필터를 반영한 0~100점이다. 새 점수는 `max(0, 기존 최종 점수 - 언어 감점)`이다. 분석 결과를 표시만 하는 검증 기간을 두지 않고, 분석 완료 시 감점을 바로 반영한다.

| 언어 분석 조건 | 감점 |
|---|---:|
| A가 검토 기준 이하 | 0 |
| A가 검토 기준 초과, B는 검토 기준 이하 | 15 |
| A가 검토 기준 초과이고 강한 기준 이하, B도 검토 기준 초과 | 35 |
| A가 강한 기준 초과, B도 검토 기준 초과 | 65 |
| 지원 범위 밖·자료 부족·모델 실패 | 없음, 언어 분석 미평가 |

15·35·65는 초기 운영 정책값이며 AI 사용 확률이 아니다. 검토·강한 임계값의 연구상 오탐률 목표는 각각 1%·0.1%이며, 실제 검증 전에는 달성했다고 표시하지 않는다. 감점의 즉시 적용 결정은 보정 자료나 모델 없이 임계값·결과를 임의로 만들어도 된다는 뜻이 아니다.

STANDARD는 70점 이상 GREEN, 40점 이상 70점 미만 AMBER, 40점 미만 RED로 유지한다. 다른 모드는 기존 가중치와 분류 경계를 보존하고 동일한 언어 감점 정책을 적용한다. 색상은 AI 사용 확정 표현으로 표시하지 않는다.

## 구현과 검증 계획

1. 공개 자료의 사용 조건·라벨·장르를 확인하고 작성자·출처·생성기별 분리 및 학습·보정·독립 평가 자료를 구성한다. 모델·전처리·임계값 버전을 함께 고정한다.
2. 형태 분석과 특징 추출, 문맥 모델 추론, 의미 수정 분석을 내부 분석 모듈로 연결한다. 서버 자원과 처리 시간을 측정해 실행 구성을 정한다.
3. 분석 엔진에 감점과 최종 점수 계산을 연결하고 모델·임계값·근거·평가 상태를 저장한다. 캐시 버전을 갱신하고 중복 분석 및 실패 재시도를 처리한다.
4. 분석 화면에 기존 점수, 언어 감점, 최종 점수, 근거, 진행 및 미평가 상태를 표시한다. 기존 권한과 한국어·영어 번역 구조를 따른다.
5. 기존 엔진·재생·프로토콜 회귀 검사와 양쪽 빌드를 수행한다. 0·15·35·65 감점, 점수 하한, 분류 경계, 미평가·실패, 중복 감점, 구버전 캐시를 검증한다. 정상 원문·허용 교정·자기 글 재입력·AI 재입력·재서술 자료에서 전체 결합 판정의 오탐과 탐지율을 보고한다. UI 검증 캡처는 `walkthrough.md`에 남긴다.

수정 대상은 백엔드 분석 엔진·제출 분석 경로·내부 모델 실행 모듈과 프런트엔드 제출 분석 화면이다. 데이터베이스 스키마 변경이 필요하면 migration과 schema-only dump를 함께 갱신한다. 2026년 10월 18일 사용자의 “구현하자”로 이 범위의 구현이 승인되었다.

## 구현 결과

- 형태·구문 분류기와 한국어 문맥 분류기를 실제 학습하고 오프라인 추론, 의미 수정 후보 분석, 전사 보완 및 0·15·35·65점 감점을 연결했다. 엔진 버전은 5다.
- 제출 시 기존 결과를 먼저 저장하고 비동기 분석 완료 후 점수와 목록용 열을 함께 갱신한다. 학생 상세 정보 제한, 실패 시 미평가·재분석, 캐시 갱신 및 이전 작업의 덮어쓰기 방지를 구현했다. 스키마 변경은 없다.
- 학습 234편, 보정 128편 중 정상 글 29편, 독립 주제 평가 146편 중 정상 글 34편이다. 언어 감점 분기에서 정상 글 오탐 0/34, AI 글 검출 66/112이며 정상 글 띄어쓰기 교정 대조군은 0/34였다. 이 결과는 실제 입력 이력 전체의 오탐률 보증이 아니다.
- 의미 수정은 안정된 문장에 나타나는 부정·수량·수치·일부 조건/인과 표지 변화의 후보를 보수적으로 분석하는 초기 구현이다. 완전한 논증 이해나 깊은 인간 재서술 탐지는 검증하지 않았다.
- 양쪽 빌드, 기존 엔진·재생·프로토콜 검사, 새 점수·추론·비동기 제출 통합 검사 및 화면 검증을 통과했다. 실제 SQL 서버 대신 메모리 SQL 어댑터로 제출 통합 경로를 검사했다.
- 모델 파일과 가상환경은 로컬에서 준비했고 Git에서 제외한다. 재현 절차는 [운영 문서](flagia-backend/linguistic/OPERATIONS.md), 수치 근거는 [평가 기록](flagia-backend/linguistic/model-evaluation.json), 화면은 [검증 기록](walkthrough.md)에 있다.

## 운영 배포 계획 — 사용자 승인 후 진행

2026년 10월 18일 사용자가 커밋·푸시·배포와 운영 검증을 승인했다. 기존 GitHub Actions → EC2 릴리스 구조를 사용한다. 기존의 관련 없는 삭제·의존성 변경은 커밋에서 제외한다.

1. 공개 저장소에 모델 가중치를 커밋하지 않는다. Linux 배포 환경에서 같은 자료·설정으로 모델을 준비하고 검증한 뒤, 코드·Python 분석 모듈과 함께 기존 비공개 SSH 전송으로 EC2에 전달한다. Linux에서 생성된 모델 버전과 평가 결과는 릴리스 내부에 보존한다.
2. EC2의 Python과 호환되는 실행 환경을 준비하고 모델 무결성과 실제 추론을 확인한 뒤에만 현재 릴리스를 전환한다. 준비 실패 시 기존 서비스는 계속 실행한다.
3. 기존 제출물 재분석 CLI도 새 언어 분석 파이프라인을 사용한다. 재분석 전 백업을 만들고, 분석 실패를 성공으로 처리하지 않는다.
4. 공개 health 응답에서 릴리스·엔진·모델 버전을 확인할 수 있게 한다. 프런트엔드, API, 인증 경계, 새 언어 분석의 실제 실행·저장·권한을 운영에서 검증한다. 검증용 데이터는 식별 가능한 별도 자료로 만들고 정리한다.

---

# Implementation Plan — Correlated RR/Divergence Copytyping Detection

## Root cause

- The fake-edit detector currently treats revision ratio (RR) and content
  divergence as independent gates: `RR >= 1.25` and `divergence < 5%`.
- That creates a hard cliff. A student can generate enough persistent abandoned
  words to reach slightly above 5%, even when the amount of claimed editing
  implied by RR should have produced substantially more genuine divergence.
- The reported submission demonstrates the gap: RR `1.43` indicates
  considerable extra input, but divergence is only `5.6%`; the fixed 5% gate
  suppresses the entire structural penalty.

## Architecture

### 1. Model the RR/divergence relationship

- Replace the fixed `RR >= 1.25 && divergence < 0.05` decision with a pure,
  bounded correlation-risk function.
- Raise the base expected-divergence tolerance modestly from 5% to 7%.
- Treat RR as the amount of claimed editing and derive a smoothly increasing
  expected-divergence floor from it: higher RR must be accompanied by more
  genuinely abandoned/reworded content to receive revision credit.
- Calculate risk from the normalized shortfall between observed divergence and
  the RR-dependent expectation. Avoid a second binary cliff by tapering the
  penalty continuously to zero as observed divergence approaches expectation.
- Escalate to RED only when the joint evidence is strong: correlation risk is at
  least 40% and RR is at least 1.40. Cap qualifying scores at 39 so the score and
  status remain consistent instead of applying a status-only override.
- Keep the existing safeguards: require snapshots and sufficient typing effort,
  exclude paste-dominated work, filter transient Korean IME/typo churn, and
  preserve the separate template-copying and no-snapshot fallback paths.
- Bound the curve conservatively so low-RR linear writing is not automatically
  treated as fake editing and very high RR cannot create an unlimited penalty.

### 2. Make the decision auditable

- Add the RR-dependent expected divergence and the resulting correlation risk
  to the existing transcription breakdown.
- Keep the final score reconciliation through `scoreAdjustments`.
- Bump the analysis version so cached version-3 results cannot mask the new
  engine behavior; update the analysis route's cache-version check accordingly.

### 3. Add deterministic regression coverage

- Add focused engine fixtures for:
  - the observed boundary class (`RR ≈ 1.43`, divergence `≈ 5.6%`) being
    recognized as suspicious;
  - the same divergence with barely elevated RR receiving little or no penalty;
  - high RR with proportionally high genuine divergence remaining unflagged;
  - fake delete-and-retype activity producing stronger risk as RR rises while
    divergence stays flat;
  - Korean IME fragments and short-lived typos remaining excluded;
  - no-snapshot, template-copy, paste-dominated, and honest-writing paths
    retaining their intended behavior.
- Use synthetic text/events only; do not commit the student's submission text or
  identifying data as a fixture.

## Files in scope

- `flagia-backend/src/engine/flagiaEngine.ts`
- `flagia-backend/src/engine/flagiaEngine_test.ts` (new focused regression test)
- `flagia-backend/src/routes/submissions.ts`
- `flagia-backend/package.json` only if a focused test script is needed
- Generated backend `dist` output from the normal production build

## Verification

- Run the focused correlation fixtures and backend production build.
- Run a read-only shadow analysis of the identified production submission with
  the new engine and confirm the correlation basis, penalty, and status without
  modifying production data.
- Compare representative historical/synthetic honest and suspicious cases to
  check that the curve improves this false negative without creating a broad
  false-positive jump.
- Run `git diff --check` and inspect the final diff for unrelated changes and
  sensitive data.

## Acceptance criteria

- RR and divergence influence one continuous, explainable correlation risk.
- The `RR 1.43 / divergence 5.6%` boundary class no longer escapes solely by
  crossing a fixed 5% cutoff and is classified RED when its correlation risk is
  at least 40%.
- Higher RR requires proportionally more genuine divergence to avoid the
  fake-edit penalty.
- Honest high-divergence revision, Korean IME churn, template, paste, and legacy
  no-snapshot behavior remain correctly classified.
- Existing component totals and structural adjustments still reconcile exactly
  with the final Flagia score.

---

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

# Flagia 입력과 언어 분석 평가 개선 계획

작성일: 2026년 10월 17일. 상태: 설계 검토안. 애플리케이션 구현은 별도 승인 이후 진행한다.

2026년 10월 18일 언어학 중심 패치 조사: [한국어 언어학적 필터 조사와 운영 기준](linguistic_filter_research.md). 언어 분석의 우선순위와 판정 임계값은 이 조사안을 우선 검토하며, 아래 고정 배점·백분위 구간은 검증 전 초기안으로 유지한다.

기존 다섯 평가 기준 중 타이핑 리듬과 수정 비율을 강화하고, 입력과 본문 일관성 및 언어학적 분석을 독립 기준으로 추가한다. 전사 필터는 이 기준들이 제공하는 근거를 조합해 작성 패턴을 설명한다. 같은 근거를 기본 점수와 전사 감점에 중복 반영하지 않는다.

최종 결과는 관측된 작성 과정의 부합도, 평가 가능 범위, 구체적인 이상 정황을 함께 제공한다. AI 사용 확률이나 AI 미사용 인증으로 표현하지 않는다. 아래 가중치와 임계값은 초기 설정이며, 검증 자료에 맞춰 버전별로 조정한다.

## 현재 구조와 개선이 필요한 원인

| 현재 확인한 구조 | 개선이 필요한 이유 |
|---|---|
| `StudentEditor.vue`의 실제 수집 경로는 해시 계산을 기다린 후 순번과 시각을 정하고 여러 이벤트에 같은 IKI 계산을 사용한다. | 입력 발생 시점과 비동기 처리 시점을 분리하고, 키 입력 간격이 다른 종류의 이벤트로 끊기지 않도록 해야 한다. |
| 실제 편집기는 keydown 및 문서 패치를 수집하지만 keyup, beforeinput, input, composition의 연결 정보를 충분히 남기지 않는다. | 키 누름과 문자 변화 사이의 인과관계 및 조합 상태를 추적하기 어렵다. 별도 composable의 존재를 실제 사용 경로의 기능으로 간주하지 않는다. |
| 문서 패치는 각 편집 트랜잭션 뒤에 기록되고, 스냅샷은 2초마다 본문이 바뀐 경우 기록된다. 패치는 현재 주로 재생용이다. | 점수 분석도 패치를 사용해야 2초 이내의 수정과 실제 편집 범위를 확인할 수 있다. |
| 전체 CV와 키 종류에 근거한 고정 멈춤 규칙을 사용한다. | 키쌍, 문맥, 작성 단계별 분포 차이를 잃고 IME의 Process 키에서 문맥을 알기 어렵다. |
| RR은 실제 keydown 수와 한글을 보정한 예상 입력 수를 비교한다. | 단축키, 조합 중 교체, 실행 취소, 실제 내용 수정이 같은 양적 활동에 섞일 수 있다. |
| 내용 차이는 주로 중간 스냅샷에서 사라진 단어를 세며, RR에 따른 예상 차이와 비교한다. | 짧은 부정·수량·인과 변경을 놓치고, 많은 오타 수정이 적은 내용 변화로 이어지는 정상 사례를 잘못 해석할 수 있다. |
| 현재 활성 경로의 currentHash는 본문 앞부분의 해시이고 서버의 체인 검증은 주석 처리돼 있다. | 현재 기록을 검증된 변조 방지 체인으로 설명할 수 없다. 수신 기록 보존과 최초 이벤트의 진실성도 구분해야 한다. |
| 분석 결과와 캐시가 버전 4를 기준으로 처리되고 화면은 높은 점수를 좋은 상태로 표현한다. | 새로운 위험 점수의 방향, 기존 자료의 제한, 캐시 및 표시 호환성을 명시해야 한다. |

## 공통 수집과 분석 구조

작성기에서 발생 시각과 순번을 동기적으로 확정한 뒤, 패치와 입력 이벤트를 순서대로 서버에 전송한다. 서버는 기록을 보존하고, 정규화한 편집 이력에서 각 평가 기준에 필요한 특징을 추출한다. 언어 분석은 제출 또는 명시적 재분석 시 비동기로 실행하며 키 입력 수집을 막지 않는다.

| 기록 정보 | 용도 |
|---|---|
| 세션 ID, 이벤트 순번, 이벤트 ID, 트랜잭션 ID | 중복·재전송·순서·문서 변경 연결 |
| 원래 이벤트의 시각, 단조 증가 시각, 서버 수신 시각 | 입력 간격과 수신 지연의 구분. 세션 간 브라우저 시각을 직접 빼지 않는다. |
| key, code, modifier, repeat, keydown과 keyup | 문자 입력·단축키·길게 누르기·키쌍 간격 구분 |
| beforeinput, inputType, input, composition ID와 상태 | 삽입·삭제·조합·붙여넣기·자동 교정·실행 취소 구분 |
| 변경 전후 선택 범위, 문서 패치, 기준 문서와 체크포인트 | 편집 재현과 본문 변화 대조 |
| 입력 원인 후보, 연결된 이벤트 ID, 연결 신뢰도 | 다대다 관계와 원인 불명·관측 불충분 구분 |
| 입력 방식, 수집 지원 범위, 복구·불러오기 표시 | 지원하지 않는 환경과 정상적인 문서 복원을 평가에서 구분 |

- 편집 위치와 패치 적용은 기존 UTF-16 좌표를 유지한다. 글자 수는 grapheme 단위로 집계하고 언어 비교용 정규화는 원본과의 위치 대응을 보존한 별도 표현에서 수행한다.
- 조합 중 문자열을 확정 본문 삽입·삭제·수정량으로 중복 집계하지 않는다. 조합 종료와 뒤따르는 input, 트랜잭션의 중복도 제거한다.
- 기존 키·문서 패치·스냅샷은 원본으로 보존하고 분석용 편집 이력을 별도로 만든다. 기존 재생을 분석용 정규화로 바꾸지 않는다.
- beforeinput이 없다는 사실만으로 부정 입력을 판단하지 않는다. 실제 편집기 트랜잭션·후속 input·체크포인트로 보완하고 원인을 알 수 없으면 연결 신뢰도를 낮춘다.
- 문서 복구 및 프로그램에 의한 정상 변경도 명시적 출처를 가진 기준 상태로 기록한다. 클라이언트가 선언한 출처만으로 승인 처리하지 않고 서버의 해당 복구·불러오기 동작과 대조한다.
- 서버는 배치 중복 방지, 순번 공백, 재접속, 저장 경쟁, 최종 제출 시 잔여 배치를 검증한다. 서버에 수신된 기록과 해시를 고정해 사후 변경을 확인하되 실제 손가락 입력의 증명으로 설명하지 않는다.

## 1 타이핑 리듬 강화

### 목적과 분석 방법

기존 1번 기준을 전체 CV 중심에서 키쌍·언어적 경계·연속 입력의 분포를 함께 보는 방식으로 바꾼다. CV는 계속 표시하되 별도 중복 가중치를 주지 않는다.

| 분석 항목 | 수집과 계산 | 초기 사용 조건 |
|---|---|---|
| 반복 키쌍 | 실제 content keydown 사이 간격과 관측 가능한 keyup으로 누름 시간을 계산한다. code는 키 식별에 사용하되 물리 장치 인증으로 취급하지 않는다. | 키쌍별 10회 이상인 키쌍이 5종 이상. keyup 누락은 누름 시간 특징만 미평가한다. |
| 경계별 전환 시간 | 확정된 편집 본문에 입력을 연결해 어절 내부·어절 사이·절·문장·문단 전환을 구분한다. 새 글 작성과 기존 구간 수정은 분리한다. | 비교할 경계별 10회 이상. 문맥 연결이 불확실한 이벤트는 제외한다. |
| 연속 입력과 반복성 | 입력 묶음의 길이, 간격의 자기상관, 반복 지연, CV를 함께 계산한다. 단축키·자동 반복·조합 상태를 별도 처리한다. | 유효 입력 200회 이상. 입력 묶음 분리 기준은 검증된 환경별 분포에서 정한다. |

기준 자료는 동일 언어·입력 방식·과제 유형으로 구분한다. 검증된 개인 자료가 충분하면 개인 기준을 사용하고, 부족하면 해당 환경에서 검증된 집단 기준을 사용한다. 현재 의심 세션을 자기 기준으로 학습하지 않는다. 다초 멈춤을 원본에서 삭제하지 않고 리듬·작성 전환·이탈로 구분해 보존한다.

### 점수와 검증

새 리듬 기준의 내부 배점은 키쌍 8, 경계 전환 9, 연속 입력 8로 합계 25다. 기준 자료 대비 이탈 정도의 백분위로 위험도를 계산한다. 일정한 타이핑이나 문장 중간 멈춤 하나로 전사를 판정하지 않는다.

완료 조건은 다른 종류 이벤트가 keydown 간격을 바꾸지 않고, 비동기 해시·배치 처리 지연이 원래 시각과 순번을 바꾸지 않으며, 동일 이벤트를 배치 크기나 재전송 방식만 바꿔 보내도 특징값이 같은 것이다. 문맥을 반영한 모델이 전체 CV만 사용한 모델보다 같은 정상 오탐률에서 개선되는지도 비교한다.

## 2 수정 비율 강화

### 목적과 분석 방법

기존 2번 기준의 RR은 진단용으로 보존한다. 새 점수는 확정된 편집 묶음을 분류해 실제 추가·삭제·교체·재입력과 조합·실행 취소를 구분한다.

| 편집 분류 | 처리 |
|---|---|
| 한글 조합 중 변화 | 하나의 조합 이력으로 보존하고 확정된 결과를 한 번 집계한다. |
| 삭제와 재입력 | 삭제한 구간과 재입력 구간을 연결하고 동일 내용 복원인지 확인한다. |
| 선택 영역 교체 | 선택된 기존 내용과 교체된 새 내용을 한 수정 묶음으로 계산한다. |
| 실행 취소와 다시 실행 | 문서 변화를 기록하되 새 구상이나 독립 수정으로 횟수를 부풀리지 않는다. |
| 단축키·이동·서식 | 문자 수정량과 분리한다. 위치 이동은 후속 수정의 문맥 정보로 보존한다. |
| 오타·표현·의미 수정 | 실제 편집량은 여기서 계산하고 의미 분류 결과는 4번의 공통 언어 분석에서 받는다. |

계산값은 기존 RR, 확정 글자 추가·삭제량, 수정 대상 비율, 동일 내용 재입력 비율, 수정 묶음 수, 수정량 대비 의미 변화량이다. 동일 구간을 A→B→A로 반복해도 새 수정 공로가 무한히 누적되지 않게 한다. 붙여넣은 구간의 수정과 직접 입력한 구간의 수정을 구분하고 출처 이력을 유지한다.

### 점수와 검증

배점은 10이다. 수정량이 많다는 이유로 자동 가점하지 않고, 수정량과 실제 변화의 관계가 동일 조건의 기준에서 얼마나 이례적인지 평가한다. 수정이 거의 없는 경우 이 항목은 미평가하며 낮은 RR만으로 강한 의심을 만들지 않는다. 의미 분석을 사용할 수 없을 때 RR만으로 이 10점을 대체하지 않고 별도 진단값으로 보여준다.

완료 조건은 한글 조합 확정이 삭제·재작성으로 부풀려지지 않고, 실행 취소·다시 실행·같은 내용 반복 입력이 수정량과 의미 변화량에 구분되며, 일부러 넣은 오타 몇 번만으로 점수가 좋아지지 않는 것이다.

## 3 새 기준인 입력과 본문 변화 대조

### 목적과 분석 방법

기존 다섯 항목과 별개인 여섯 번째 기준이다. 브라우저 이벤트와 편집기 트랜잭션을 묶어 기록된 입력이 본문 변화를 설명하는지 확인한다. 시간상 가깝다는 이유만으로 원인을 확정하지 않고 이벤트 종류·선택 범위·조합 범위·키·문서 상태를 함께 사용한다.

각 편집의 판정은 다음 네 상태로 구분한다.

| 상태 | 의미와 처리 |
|---|---|
| 설명됨 | 관측된 삽입·조합·붙여넣기·삭제·실행 취소·승인된 복구로 설명된다. |
| 관측 불충분 | 이벤트 누락 또는 지원하지 않는 입력 방식 때문에 대조할 수 없다. 평가 가능 범위를 낮춘다. |
| 원인 불명 | 수집은 정상으로 관측되지만 연결할 입력 원인이 없다. 불일치 후보로 남긴다. |
| 모순 확인 | 지원되는 입력 환경에서 실제 키·선택·조합 상태와 본문 변화가 맞지 않거나 문서 재현이 맞지 않는다. |

두벌식 키와 자모 대조는 지원이 확인된 환경에서만 수행한다. Process만 관측되거나 키보드 배열을 모르면 문자별 대조를 강제하지 않는다. 한자·음성·예측·자동 교정도 정상 경로로 구분하거나 미평가한다. isTrusted는 진단 필드로만 사용한다.

### 점수와 검증

배점은 설명되지 않는 최종 글자 비율 12, 대조 가능한 편집의 모순 비율 12, 문서 체크포인트 재현 실패율 6으로 합계 30이다. 승인된 불러오기·인용·제시문은 불명 삽입에 포함하지 않는다. 분모가 0이면 미평가하고, 관측 불충분을 모순 비율의 분자로 옮기지 않는다.

| 위험도 | 설명되지 않는 글자 비율 | 키와 편집 모순 비율 | 체크포인트 재현 실패율 |
|---|---|---|---|
| 0 | 0 | 0 | 0 |
| 25 | 0 초과 0.1% 이하 | 0 초과 0.5% 이하 | 0 초과 1% 이하 |
| 50 | 0.1% 초과 1% 이하 | 0.5% 초과 2% 이하 | 1% 초과 5% 이하 |
| 75 | 1% 초과 5% 이하 | 2% 초과 10% 이하 | 5% 초과 10% 이하 |
| 100 | 5% 초과 | 10% 초과 | 10% 초과 |

설명되지 않는 글자는 최종 본문에 남은 출처 이력으로 세고, 반복 입력으로 분모를 부풀리지 않는다. 국소 삽입도 별도 구간 태그로 표시하되 짧은 구간의 큰 비율을 전체 위험도로 즉시 대체하지 않는다. 기술적인 불일치는 AI 사용 확정이 아닌 입력 기록 검토 사유로 표시한다.

완료 조건은 한글·혼합 언어·이모지·중간 삽입·선택 교체·붙여넣기·undo/redo·복구에서 체크포인트가 정확히 재현되고, 실제 키와 무관한 내용 치환은 위치와 원인 후보를 표시하며, 수집기 누락은 별도 상태로 남는 것이다.

## 4 새 기준인 언어학적 분석

### 목적과 분석 방법

일곱 번째 기준이다. 현재와 최종 문서의 차이를 포함해 실제로 발생한 의미 수정과 그 시점의 입력을 분석한다. 글의 논리적 정답·문장 품질·어려운 어휘 자체를 출처 점수로 사용하지 않는다.

| 분석 단계 | 처리와 결과 |
|---|---|
| 문장과 수정 구간 정렬 | 확정 본문을 어절·절·문장으로 나누고 위치 이동과 동일 문장의 이력을 연결한다. |
| 수정 종류 분류 | 조합·오타·표현·정보 추가·구조·부정·수량·인과·주장 변경을 구분한다. |
| 내용과 지연 연결 | 해당 시점까지 보이는 문맥에서 어휘·구문·새 주장·조건·반론 도입 특징을 계산하고, 입력 방식과 키쌍의 운동적 차이를 통제한 지연과 연결한다. |
| 문장 사이 수정 연결 | 전제나 주장이 바뀌었을 때 관련 근거·조건·결론·지시어에 어떤 후속 편집이 발생했는지 그래프로 남긴다. |
| 불확실성 처리 | 분류가 불확실한 구간은 미평가하고 수정 전후 문장을 근거로 보존한다. 모델이 추정한 사고 목적을 관측 사실처럼 표시하지 않는다. |

의미 변화 단위의 초기값은 조합·오타·서식 0, 의미 유지 표현 수정 1, 정보·구조 수정 2, 핵심 주장·조건·부정·수량·인과 변경 3이다. 변화 단위가 클수록 자연 작성이라고 가점하지 않는다. 2번 수정 비율 분석의 입력 특징과 검토 화면에만 사용한다. 짧은 부정·수량 변경이 단순 오타로 사라지지 않도록 문자 길이보다 의미 유형을 먼저 확인한다.

내용과 지연의 관계는 가능한 구간에서 상관 및 조건부 예측 오차를 계산하고, 같은 조건의 기준 분포와 비교한다. 양의 상관이 반드시 존재해야 한다는 규칙은 두지 않는다. 최종본의 미래 문맥을 작성 당시의 지식으로 간주하지 않고, 최종본은 이후의 수정 경로 비교에 사용한다.

### 모델 선택과 성능

한국어 형태소·구문 분석 및 문장 표현으로 시작해 규칙으로 확인 가능한 수정 유형을 먼저 다룬다. 문장 의미 비교와 논증 관계 추론은 교체 가능한 모듈로 둔다. 한국어 주석 자료에서 유형별 정확도와 신뢰도를 확인하기 전에는 해당 분류를 점수에 반영하지 않는다. 모델의 임의 확률값 하나를 신뢰도로 취급하지 않는다.

본문을 외부 서비스로 전송하는 분석은 기본 경로에 넣지 않는다. 로컬 또는 관리되는 백엔드 실행의 성능·자원 비용을 측정한 후 모델을 선정한다. 전문 분석은 제출 후 처리하고, 바뀐 문장만 재분석하며, 본문 해시·모델 버전에 따라 결과를 재사용한다. 분석 대기·부분 완료·실패는 정상 점수와 구분해 표시한다.

### 점수와 검증

배점은 내용과 입력 지연 관계 15, 문장 사이 수정 연결 10으로 합계 25다. 수정량 대비 의미 변화 10점은 2번 기준이 소유한다. 같은 의미 변화 특징을 전사 필터에서 다시 감점하지 않는다.

초기 표본은 내용과 지연에 분석 단위 30개, 수정량 관계에 확실한 수정 묶음 10개, 문장 사이 연결에 영향을 주는 수정 5개다. 수정이 없으면 수정 관련 항목만 미평가한다. 예제에서 '모든→일부', '원인이다→관련이 있다', '있다→없다'를 의미 변화로 인식하고, 동의어 교체·오타·조합 확정과 구분해야 한다.

텍스트만, 입력만, 두 점수의 단순 합, 시점별 공동 분석을 동일 자료에서 비교한다. 사람의 실제 AI 글 재서술과 AI가 생성한 의미 수정 연쇄를 포함한다. 언어 모델의 도움으로 충분히 생각하며 고친 글은 의미적으로 자연스러울 수 있으므로 해당 결과로 AI 미사용을 선언하지 않는다.

## 5 전사 필터 개선

### 역할과 패턴 분류

전사 필터는 여섯 번째나 일곱 번째 점수를 추가하는 모듈이 아니라 기존·신규 기준의 결과를 해석하는 결합 규칙이다. 전사는 이미 있는 글을 옮기는 행위이며 AI 글뿐 아니라 자기 글·남의 글·제시문도 포함한다.

| 패턴 | 결합할 근거 | 결과 |
|---|---|---|
| 거의 그대로 옮겨 쓴 흐름 | 문맥별 입력 특징, 내용과 지연 관계, 수정 흐름 | 충분한 표본과 기준 자료가 있을 때 전사 검토 태그 |
| 수정 흔적 반복 | 동일 구간 삭제·복원, 높은 RR, 내용 변화와의 관계 | 반복 구간을 제시하고 편집 패턴 검토 태그 |
| 붙여넣은 뒤 수정 | 실제 외부 입력의 남은 분량과 해당 구간의 편집 이력 | 외부 입력 및 후속 수정 태그. 오타 몇 번으로 출처를 지우지 않는다. |
| 제시문 재현 | 제공된 문서와 직접 입력한 본문의 겹침 | 재현 사실을 표시하고 과제 규칙에 따라 처리. AI 전사로 이름 붙이지 않는다. |
| 기록 부족 | 오래된 세션, 조합 또는 키 정보 부재 | 평가 가능 범위를 표시하고 저 RR로 강한 판정을 대체하지 않는다. |

전사 정황이 강하다는 태그의 초기 조건은 문맥별 입력 영역과 수정·언어 영역이 각각 위험도 60 이상이고 관련 항목의 최소 표본을 충족하는 것이다. 이 조건은 단순한 비정상 타자만으로 전사를 판정하지 않기 위한 설계값이며 검증 후 조정한다.

### 중복 반영 방지와 검증

모든 근거는 ID, 해당 구간, 측정값, 기준 버전, 평가 가능 여부, 점수 소유 항목을 갖는다. 전사 필터는 같은 ID를 참조하고 별도 감점을 더하지 않는다. 기존 엔진의 전사 점수 상한·추가 감점은 버전 4에 보존하며 새 엔진 점수와 동시에 적용하지 않는다.

화면에는 태그명, 근거가 된 구간, 반대 증거 및 평가 한계를 표시한다. 자기 예전 글 받아쓰기와 AI 글 받아쓰기를 시험 자료에서 분리해 '전사 검출'을 'AI 출처 판별'과 혼동하지 않는지 확인한다. 낮은 RR만 가진 정상 작성자나 작은 오타 몇 건만으로 강한 태그가 생겨서는 안 된다.

## 6 종합 점수와 판정 개편

### 일곱 기준의 가중치

| 기준 | 배점 | 교차 확인용 영역 |
|---|---:|---|
| 1 타이핑 리듬 | 25 | B 입력 패턴 |
| 2 수정 비율과 의미 변화 관계 | 10 | C 수정과 언어 |
| 3 외부 콘텐츠 | 4 | D 보조 |
| 4 집중도 | 3 | D 보조 |
| 5 작성 시간 | 3 | D 보조 |
| 6 입력과 본문 일관성 | 30 | A 일관성 |
| 7 언어학적 분석 | 25 | C 수정과 언어 |
| 합계 | 100 | A 30, B 25, C 35, D 10 |

기존 3·4·5번의 관측 대상은 유지한다. 새 통합 가중치로 바꾸되, 외부 콘텐츠는 최종 본문에 남은 미승인 외부 입력의 비율을 사용하고, 집중도와 속도는 과제·입력환경에 맞는 기준이 검증되기 전에는 기존 점수를 기계적으로 이식하지 않는다. 기존 원시 수치는 계속 표시한다.

기준 분포의 이탈 백분위가 95 이하이면 위험도 0, 95 초과 97.5 이하면 25, 97.5 초과 99 이하면 50, 99 초과 99.5 이하면 75, 99.5 초과면 100이다. 방향과 특징의 결합 방식은 항목별로 고정하고 기준 집단 전체에서 계산한 세션 단위 이탈 분포와 비교한다. 여러 특징의 최고 백분위를 무제한으로 선택하지 않는다.

미승인 외부 입력 비율의 위험도는 5% 이하 0, 5% 초과 15% 이하 25, 15% 초과 30% 이하 50, 30% 초과 50% 이하 75, 50% 초과 100이다. 이 값은 외부 유입 정황이지 AI 출처 확정이 아니다.

### 평가 가능 범위와 계산

최소 전체 표본은 확정 본문 200글자와 유효 키 입력 400회다. 항목은 지원되는 입력 방식, 충분한 기록, 최소 표본, 필요한 기준 자료와 분석기가 모두 있을 때 평가한다. 없으면 0점이나 만점 대신 미평가다.

- Q = 평가한 세부 항목의 배점 합계. 0에서 100 사이의 평가 가능 범위다.
- R = 합계(평가한 세부 항목 배점 × 위험도) / Q. Q가 0이면 R은 null이다.
- 과정 부합도 S = 100 − R. 기존 화면처럼 높은 값이 좋은 방향으로 표시할 때 사용하는 값이다.
- Q와 모델의 예측 확률, 통계적 오차 범위는 다른 값이다. Q를 정확도나 인간 확률로 표시하지 않는다.
- 분류는 반올림 전 R을 사용한다. 반올림은 표시할 때만 한다.

최소 표본이 부족하거나 Q가 80 미만이면 종합 분류는 보류한다. 확인된 입력 불일치는 분류 보류 중에도 별도 표시한다. C 영역에서 평가 가능한 배점이 15 미만이면 언어를 결합한 종합 분류는 보류한다. 수정이 없는 경우에도 다른 충분한 항목이 있으면 평가할 수 있다.

### 최종 분류

| 조건 | 결과 |
|---|---|
| 전체 표본 또는 Q 또는 C 영역 표본 조건 미달 | 판정 보류 |
| 0 ≤ R < 25 | GREEN 관측 과정 부합 |
| 25 ≤ R < 50 | AMBER 추가 확인 권장 |
| 50 ≤ R < 75 | ORANGE 이상 정황 다수 |
| 75 ≤ R ≤ 100 | RED 강한 이상 정황 |

ORANGE와 RED에는 A·B·C 중 최소 두 영역의 위험도가 각각 60 이상이어야 한다는 추가 조건을 적용한다. 영역 위험도도 평가한 항목 배점으로 나눈 평균이다. 영역 배점의 절반 이상이 평가돼야 교차 확인에 사용할 수 있다. 조건을 충족하지 못하면 R을 바꾸지 않고 AMBER 특정 영역 이상으로 표시한다. 2번 수정 비율과 7번 언어 분석은 같은 C 영역이므로 서로 독립인 두 증거로 세지 않는다.

분류 순서는 평가 가능 범위 확인, R 계산, 점수 구간 결정, 교차 확인 조건 적용이다. 입력 기록 불일치·미승인 외부 유입·전사 검토 등 사실·패턴 태그는 색상과 분리한다. RED를 AI 사용 확정으로 표시하지 않는다.

### 결과 표시와 호환성

결과에는 일곱 기준의 점수와 평가 가능 여부, Q, S 및 R의 방향, 종합 분류, 전사 태그, 근거 구간, 분석 버전·기준 자료·모델·과제 규칙 버전을 포함한다. 학생·교사별 기존 열람 권한을 유지한다. 점수 기여분은 최종 합계와 정확히 일치해야 한다.

기존 버전 4 점수와 새 점수는 구별해 저장·표시한다. 새 분석 버전은 구현 시 별도로 배정한다. 과거 기록에 새 이벤트가 없으면 입력 정보를 추정해 채우지 않고 제한된 항목만 평가한다. 기존 기록을 자동으로 새 점수로 덮어쓰지 않는다. 캐시 키에는 분석·모델·기준·과제 규칙 버전을 포함한다.

## 구현 순서와 완료 조건

| 단계 | 작업 | 완료 조건 |
|---|---|---|
| 1 | 입력 수집과 공통 편집 이력 | 키 시각·순서 보존, IME·undo/redo 중복 제거, 제출·재접속 재현 |
| 2 | 입력과 본문 대조 및 수정량 계산 | 정상 입력과 관측 부족 분리, 치환·누락 위치 표시, 수정량 과대 집계 방지 |
| 3 | 리듬 특징과 기준 자료 | 기존 CV 대비 비교, 입력환경별 검증, 최소 표본·미평가 동작 |
| 4 | 의미 수정 주석과 언어 분석 | 한국어 의미 수정 분류 검증, 입력과 의미의 시점 정렬, 모델 자원 측정 |
| 5 | 전사 규칙과 새 점수의 병행 분석 | 기존 결과를 보존하고 새 결과만 비교, 중복 점수 없음, 합계와 분류 재현 |
| 6 | 검증 후 화면 적용 | 오탐·누락·보류·처리시간 검토, 권한 및 기존 자료 호환, 화면 증거 |

기능별 새 모델의 검증이 끝나지 않으면 해당 항목은 실험 상태로 표시하고 실제 분류에 포함하지 않는다. 기준 자료 없이 임의의 사람 타이핑 분포를 가정해 정식 점수를 생성하지 않는다.

## 구현 대상 파일

| 영역 | 기존 대상과 예정 역할 |
|---|---|
| 수집 | `flagia-frontend/src/views/StudentEditor.vue`, `src/components/RichTextEditor.vue`의 실제 이벤트 경로와 순서·조합 연결 |
| 패치와 재생 | `flagia-frontend/src/utils/replayFrames.ts`, `tests/replayFrames.test.ts`의 패치 좌표·체크포인트·구버전 호환 |
| 서버 수신 | `flagia-backend/src/websocket.ts`, `src/telemetryValidation.ts`의 이벤트 스키마·배치 순서·한도·중복 검증 |
| 분석 | `flagia-backend/src/engine/flagiaEngine.ts` 및 새 편집 이력·일관성·리듬·언어·전사·집계 모듈 |
| 제출과 캐시 | `flagia-backend/src/services/submissionFinalizer.ts`, `src/routes/submissions.ts`의 비동기 분석 상태·버전·캐시 |
| 표시 | `flagia-frontend/src/views/SubmissionAnalysis.vue`와 한국어·영어 번역의 일곱 기준·보류·근거 표시 |
| 검증 기록 | 관련 테스트 및 `walkthrough.md`에 실제 구현 후 화면 증거 |

가능하면 기존 이벤트 및 분석 JSON 저장 경로를 확장한다. 별도 데이터베이스 스키마 변경이 필요해지면 승인된 구현 범위에 migration과 schema-only `mysql_dump.sql` 갱신을 포함한다. 모델 패키지·기준 자료는 버전과 해시로 식별하고, 자격증명이나 작성자 원문을 테스트·문서에 넣지 않는다.

## 검증 계획

### 정상 및 입력 경로 검증

- Windows와 macOS의 지원 대상 브라우저에서 실제 한국어 IME 기록을 확인한다. 자동으로 만든 composition 이벤트만으로 실제 입력기 검증을 대체하지 않는다.
- 복합 모음·받침 이동·조합 중 Backspace·선택 교체·영한 혼합·이모지·붙여넣기·drop·undo/redo·자동 교정·문서 복구·조합 중 제출을 다룬다.
- 배치 지연·역순 도착·중복·재접속·다중 저장 요청·종료 직전 제출에서 원본 이벤트와 최종 문서가 보존되는지 확인한다.
- 원인 불명 입력, 의도적 텍스트 치환, 프로그램 본문 변경, 전체 또는 일부 기록 위조를 분리해 시험한다. 일관된 거짓 기록을 브라우저 기록만으로 모두 검출했다고 주장하지 않는다.

### 판별 효과 검증

같은 참가자가 즉석 창작, 자기 과거 글 재입력, 다른 사람 글 재입력, AI 글 재입력, AI 글 재서술, AI 개요를 참고한 직접 작성, 실제 의미 수정, 의도적 오타·수정 반복을 수행한 자료를 확보한다. 입력 방법과 언어·과제 조건을 기록하고 참가자·문항·세션·시점이 평가 자료로 누출되지 않게 분리한다.

정상 오탐률, 유형별 탐지율, 전사와 AI 사용의 혼동, 보류율, 평가 범위, 신뢰구간을 함께 보고한다. 최종 오탐률의 분모는 보류를 제외한 건수와 전체 정상 건수 양쪽을 명시한다. 새 임계값은 개발 자료에서 조정하고 별도 평가 자료로 확인한다. ORANGE·RED의 초기 운영 목표는 정상 오탐률 1% 이하이며, 표본 불확실성도 함께 검토한다. 목표를 달성하지 못하면 실험 결과로 남기고 자동 강한 판정에 적용하지 않는다.

### 성능과 제품 검증

수집·패치 생성 시간, 이벤트 용량, 배치 저장 시간, 언어 분석의 평균 및 상위 지연, 동시 처리 시 자원 사용을 측정한다. 동기 입력 처리의 초기 목표는 지원 기기에서 p95 5ms 이하로 두고 대형 문서에서도 타자 손실·눈에 띄는 지연이 없는지 확인한다. 언어 분석의 처리시간 목표는 모델 실측 후 정한다.

프런트엔드와 백엔드 빌드 및 기존 재생·엔진·프로토콜 회귀 검사를 수행한다. 분류 경계 25·50·75, Q 경계 80, 분모 0, 일부 항목 미평가, 비정상 수치, 모델 실패, 구버전 캐시, 중복 근거를 별도 검사한다. 실제 화면에서는 일곱 기준·평가 보류·점수 합계·근거 구간·버전·언어·권한을 확인하고 `walkthrough.md`에 캡처를 남긴다.

## 근거 자료

- [W3C Input Events Level 2](https://www.w3.org/TR/input-events-2/): 조합 중 교체, 입력 종류, 편집 의도와 실제 변화의 구분. 브라우저별 실제 지원 검증이 필요하다.
- [W3C WebDriver](https://www.w3.org/TR/webdriver/#actions): 자동화 입력도 trusted 이벤트를 발생시킬 수 있어 isTrusted를 사람 입력의 증명으로 사용할 수 없다.
- [Hall 등의 멈춤 분석 연구](https://link.springer.com/article/10.1007/s11145-022-10284-4): 단일 멈춤 임계값보다 언어 단위 전환과 조건별 분포를 분석할 근거.
- [CLC 프리프린트](https://arxiv.org/html/2603.00177v1): 내용 복잡도와 입력 지연의 결합 제안. 85~95%는 통합 대조 실험 성능이 아닌 분석적 추정이다.
- [ScholaWrite](https://minnesotanlp.github.io/scholawrite/): 의미·구조 수정 주석과 반복 작성 연구. 인간 고유의 수정 신호나 판별기 회피 성능을 보장하지 않는다.
- [베트남어 입력 행동 조작 연구](https://arxiv.org/html/2610.07700v1): 학습하지 않은 작성 행동과 조작에 대한 일반화 검증의 필요성. 한국어 성능 근거로 사용하지 않는다.

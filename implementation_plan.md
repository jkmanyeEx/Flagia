# Implementation Plan — Classroom Feature

## Goal
Teachers create **classrooms**; students **join**; teachers create **assignments inside a classroom**; members **do them**. Each classroom has a join code with a **publicity** setting (public = listed/discoverable & code shown openly; private = unlisted, code shared manually).

## Approved decisions
- Join code **always exists** for every classroom. `is_public` only controls discoverability/listing, not whether a code exists.
- **Both models coexist**: `assignments.classroom_id` is nullable. Existing standalone assignments (with their own join codes) keep working unchanged.

## Database (apply to live `flagia` DB + update `mysql_dump.sql`)
```sql
CREATE TABLE classrooms (
  id VARCHAR(36) PRIMARY KEY,
  teacher_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  join_code VARCHAR(8) NOT NULL UNIQUE,
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_classrooms_teacher (teacher_id),
  INDEX idx_classrooms_public (is_public)
) ENGINE=InnoDB;

CREATE TABLE classroom_members (
  id VARCHAR(36) PRIMARY KEY,
  classroom_id VARCHAR(36) NOT NULL,
  student_id VARCHAR(36) NOT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_classroom_student (classroom_id, student_id),
  FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_cm_student (student_id)
) ENGINE=InnoDB;

ALTER TABLE assignments
  ADD COLUMN classroom_id VARCHAR(36) NULL AFTER teacher_id,
  ADD CONSTRAINT fk_assignments_classroom FOREIGN KEY (classroom_id)
      REFERENCES classrooms(id) ON DELETE CASCADE;
```
Also fix the stale dump (wrong DB name `flagia_db`, missing `join_code`).

## Backend
**New `src/routes/classrooms.ts`** (mounted at `/api/classrooms`):
- `POST /` (teacher) — create `{name, description, isPublic}`, generate unique join_code.
- `GET /` — teacher: own classrooms (+member/assignment counts); student: classrooms they belong to.
- `GET /:id` — owner teacher or member: classroom info + members + its assignments.
- `POST /join/:code` (student) — join by code; idempotent.
- `PATCH /:id` (teacher) — rename / toggle `isPublic`.
- `DELETE /:id` (teacher) — delete (cascade assignments+members).

NOTE: No public directory / browse list. Students always join via code.
`is_public` only controls whether the join code is displayed openly (public)
or hidden until the teacher shares it (private).

**`src/routes/assignments.ts`**:
- `POST /` — accept optional `classroomId`; verify teacher owns it; persist.
- `GET /` (student) — `LEFT JOIN submissions`; return assignments where: standalone+has submission, OR in a classroom the student is a member of. Include `classroom_id`, classroom name, `my_submission_id`, `my_status`.
- `GET /` (teacher) — include `classroom_id` + classroom name.

**`src/routes/submissions.ts`** — `POST /`: if the assignment has a `classroom_id`, require membership before creating a submission (403 otherwise). Standalone assignments unchanged.

Register the router in `index.ts`.

## Frontend
- **`Classrooms.vue`** (`/classrooms`, role-aware): teacher = list + "새 학급" create modal (name, description, publicity toggle); student = joined list + "코드로 참여" + browse public classrooms.
- **`ClassroomDetail.vue`** (`/classrooms/:id`, role-aware): header with join code (copy) + publicity toggle (teacher); assignment list; teacher "새 과제" creates with `classroomId`; student clicks an assignment → `/editor/:assignmentId`. Teacher sees member list.
- Reuse existing assignment-create form fields and submission-row rendering patterns from `TeacherDashboard.vue`.
- **Router**: add `/classrooms` and `/classrooms/:id`.
- **Navbar (`App.vue`)**: add "학급" item (🏫) for both roles; extend `activeNav` to cover it.

## Verify & deploy
- `tsc` build backend, `vite` build frontend.
- Manual API smoke test (create classroom → join → create assignment → list as student).
- No regrade needed (engine untouched).
- `pm2 restart flagia-backend flagia-frontend`.

## Out of scope (unless requested)
Kicking members, classroom-level analytics dashboards, assignment move between classrooms.

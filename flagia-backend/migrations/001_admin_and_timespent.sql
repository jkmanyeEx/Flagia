-- ============================================================================
-- Migration 001: ADMIN role + resumable-timer column + drop legacy `continuable`
-- ----------------------------------------------------------------------------
-- Idempotent and safe to run multiple times. The backend also runs the same
-- steps automatically on boot (see src/migrate.ts); this file is a manual
-- fallback for applying directly against a database the app can't migrate
-- itself (e.g. via a DB admin tool).
--
-- Run against the production DB:
--   mysql -u <user> -p <database> < migrations/001_admin_and_timespent.sql
-- ============================================================================

-- 1) users.role must include ADMIN. MODIFY is idempotent (no-op if already set).
ALTER TABLE users
  MODIFY COLUMN role ENUM('TEACHER','STUDENT','ADMIN') NOT NULL DEFAULT 'STUDENT';

-- 2) submissions.time_spent_sec — cumulative active writing seconds (resumable timer).
SET @add_tss := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE submissions ADD COLUMN time_spent_sec INT NOT NULL DEFAULT 0 COMMENT ''Cumulative active writing seconds across sessions (excludes time away from the site)'' AFTER status',
    'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'submissions' AND COLUMN_NAME = 'time_spent_sec'
);
PREPARE s FROM @add_tss; EXECUTE s; DEALLOCATE PREPARE s;

-- 3) Drop the abandoned assignments.continuable column if a prior build added it.
SET @drop_cont := (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE assignments DROP COLUMN continuable',
    'DO 0')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assignments' AND COLUMN_NAME = 'continuable'
);
PREPARE s FROM @drop_cont; EXECUTE s; DEALLOCATE PREPARE s;
